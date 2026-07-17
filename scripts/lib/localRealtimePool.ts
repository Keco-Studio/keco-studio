const PROJECT_ID = 'keco-studio';
const TENANT_ID = 'realtime-dev';
const POOL_SIZE = 10;
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
const REALTIME_CONTAINER = `supabase_realtime_${PROJECT_ID}`;

const POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 1_000;
const INSPECT_FORMAT =
  '{{.State.Running}}|{{index .Config.Labels "com.supabase.cli.project"}}';
const SQL_GUARD_ERRORS = {
  LOCAL_REALTIME_GUARD_TENANT: 'Expected exactly one local Realtime tenant',
  LOCAL_REALTIME_GUARD_EXTENSION:
    'Expected exactly one local postgres_cdc_rls extension',
  LOCAL_REALTIME_GUARD_SETTINGS_OBJECT:
    'Local Realtime extension settings must be an object',
  LOCAL_REALTIME_GUARD_DB_POOL_NUMERIC: 'Local Realtime db_pool must be numeric',
} as const;

export type PoolConfiguratorDependencies = {
  run: (dockerArguments: readonly string[]) => Promise<string>;
  wait: (milliseconds: number) => Promise<void>;
  checkOnly?: boolean;
};

type ContainerState = {
  running: boolean;
  projectLabel: string;
};

type PoolState = {
  changed: boolean;
  storedPool: number | null;
  livePool: number;
};

const validationSql = `
DO $guard$
DECLARE
  tenant_count integer;
  extension_count integer;
BEGIN
  SELECT count(*) INTO tenant_count
  FROM _realtime.tenants
  WHERE external_id = '${TENANT_ID}';

  IF tenant_count <> 1 THEN
    RAISE EXCEPTION 'LOCAL_REALTIME_GUARD_TENANT';
  END IF;

  SELECT count(*) INTO extension_count
  FROM _realtime.extensions
  WHERE tenant_external_id = '${TENANT_ID}'
    AND type = 'postgres_cdc_rls';

  IF extension_count <> 1 THEN
    RAISE EXCEPTION 'LOCAL_REALTIME_GUARD_EXTENSION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _realtime.extensions
    WHERE tenant_external_id = '${TENANT_ID}'
      AND type = 'postgres_cdc_rls'
      AND jsonb_typeof(settings) IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'LOCAL_REALTIME_GUARD_SETTINGS_OBJECT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _realtime.extensions
    WHERE tenant_external_id = '${TENANT_ID}'
      AND type = 'postgres_cdc_rls'
      AND settings ? 'db_pool'
      AND jsonb_typeof(settings->'db_pool') <> 'number'
  ) THEN
    RAISE EXCEPTION 'LOCAL_REALTIME_GUARD_DB_POOL_NUMERIC';
  END IF;
END
$guard$;
`;

const applySql = `
BEGIN;
${validationSql}
WITH updated AS (
  UPDATE _realtime.extensions
  SET settings = jsonb_set(settings, '{db_pool}', '${POOL_SIZE}'::jsonb, true)
  WHERE tenant_external_id = '${TENANT_ID}'
    AND type = 'postgres_cdc_rls'
    AND settings->'db_pool' IS DISTINCT FROM '${POOL_SIZE}'::jsonb
  RETURNING settings->>'db_pool' AS stored_pool
), pool_state AS (
  SELECT
    EXISTS (SELECT 1 FROM updated) AS changed,
    COALESCE(
      (SELECT stored_pool FROM updated),
      (
        SELECT settings->>'db_pool'
        FROM _realtime.extensions
        WHERE tenant_external_id = '${TENANT_ID}'
          AND type = 'postgres_cdc_rls'
      )
    ) AS stored_pool
)
SELECT
  CASE WHEN pool_state.changed THEN 1 ELSE 0 END
  || '|' || COALESCE(pool_state.stored_pool, 'null')
  || '|' || (
    SELECT count(*)
    FROM pg_stat_activity
    WHERE application_name = 'realtime_connect'
  )
FROM pool_state;
COMMIT;
`;

const checkSql = `
BEGIN;
${validationSql}
SELECT
  '0'
  || '|' || COALESCE(settings->>'db_pool', 'null')
  || '|' || (
    SELECT count(*)
    FROM pg_stat_activity
    WHERE application_name = 'realtime_connect'
  )
FROM _realtime.extensions
WHERE tenant_external_id = '${TENANT_ID}'
  AND type = 'postgres_cdc_rls';
COMMIT;
`;

const terminateStalePoolSql = `
BEGIN;
${validationSql}
WITH activity_snapshot AS MATERIALIZED (
  SELECT pid
  FROM pg_stat_activity
  WHERE application_name = 'realtime_connect'
    AND pid <> pg_backend_pid()
), pool_state AS MATERIALIZED (
  SELECT
    settings->>'db_pool' AS stored_pool,
    (
      SELECT count(*)
      FROM activity_snapshot
    ) AS live_pool
  FROM _realtime.extensions
  WHERE tenant_external_id = '${TENANT_ID}'
    AND type = 'postgres_cdc_rls'
), stale_pids AS MATERIALIZED (
  SELECT activity.pid
  FROM activity_snapshot AS activity
  CROSS JOIN pool_state
  WHERE pool_state.stored_pool = '${POOL_SIZE}'
    AND pool_state.live_pool > 0
    AND pool_state.live_pool <> ${POOL_SIZE}
), terminated AS MATERIALIZED (
  SELECT pg_terminate_backend(pid) AS terminated
  FROM stale_pids
), termination_result AS (
  SELECT count(*) FILTER (WHERE terminated) AS terminated_count
  FROM terminated
)
SELECT CASE
  WHEN terminated_count > 0 THEN 'terminated'
  ELSE 'skipped'
END
FROM termination_result;
COMMIT;
`;

function parseContainerState(output: string, container: string): ContainerState {
  const line = output.trim();
  const [running, projectLabel, ...extra] = line.split('|');
  if (!running || !projectLabel || extra.length > 0) {
    throw new Error(`Could not verify local Supabase container: ${container}`);
  }

  return {
    running: running === 'true',
    projectLabel,
  };
}

async function inspectContainer(
  run: PoolConfiguratorDependencies['run'],
  container: string
): Promise<ContainerState> {
  const output = await run(['inspect', '--format', INSPECT_FORMAT, container]);
  return parseContainerState(output, container);
}

function assertProjectLabel(state: ContainerState): void {
  if (state.projectLabel !== PROJECT_ID) {
    throw new Error('Refusing to configure a non-keco-studio Supabase container');
  }
}

async function requireRunningContainer(
  run: PoolConfiguratorDependencies['run'],
  container: string
): Promise<ContainerState> {
  const state = await inspectContainer(run, container);
  assertProjectLabel(state);
  if (!state.running) {
    throw new Error(`Required local Supabase container is not running: ${container}`);
  }
  return state;
}

function parsePoolState(output: string): PoolState {
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const match = lines.at(-1)?.match(/^(0|1)\|(null|-?\d+(?:\.\d+)?)\|(\d+)$/);
  if (!match) {
    throw new Error('Could not verify local Realtime pool state');
  }

  return {
    changed: match[1] === '1',
    storedPool: match[2] === 'null' ? null : Number(match[2]),
    livePool: Number(match[3]),
  };
}

async function queryPoolState(
  run: PoolConfiguratorDependencies['run'],
  update: boolean
): Promise<PoolState> {
  const output = await executeSql(run, update ? applySql : checkSql);
  return parsePoolState(output);
}

async function executeSql(
  run: PoolConfiguratorDependencies['run'],
  sql: string
): Promise<string> {
  let output: string;
  try {
    output = await run([
      'exec',
      '-e',
      'PGPASSWORD=postgres',
      DB_CONTAINER,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]);
  } catch (error) {
    throw new Error(getSafeSqlErrorMessage(error));
  }
  return output;
}

function getSafeSqlErrorMessage(error: unknown): string {
  const errorText = [
    error instanceof Error ? error.message : '',
    typeof error === 'object' && error !== null && 'stderr' in error
      ? String(error.stderr)
      : '',
  ].join('\n');

  for (const [code, message] of Object.entries(SQL_GUARD_ERRORS)) {
    const diagnostic = new RegExp(`ERROR:\\s+${code}(?:\\s|;|$)`, 'i');
    if (diagnostic.test(errorText)) {
      return message;
    }
  }

  return 'Failed to query local Realtime pool';
}

function poolIsReady(pool: PoolState): boolean {
  return (
    pool.storedPool === POOL_SIZE &&
    (pool.livePool === 0 || pool.livePool === POOL_SIZE)
  );
}

async function waitForPool(
  run: PoolConfiguratorDependencies['run'],
  wait: PoolConfiguratorDependencies['wait']
): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const pool = await queryPoolState(run, false);
    if (poolIsReady(pool)) {
      return;
    }

    if (attempt < POLL_ATTEMPTS - 1) {
      await wait(POLL_INTERVAL_MS);
    }
  }

  throw new Error('Timed out waiting for local Realtime pool');
}

export async function configureLocalRealtimePool(
  dependencies: PoolConfiguratorDependencies
): Promise<{ restarted: boolean }> {
  const { run, wait, checkOnly = false } = dependencies;

  await requireRunningContainer(run, DB_CONTAINER);
  await requireRunningContainer(run, REALTIME_CONTAINER);

  const pool = await queryPoolState(run, !checkOnly);
  if (checkOnly) {
    if (!poolIsReady(pool)) {
      throw new Error('Local Realtime pool verification failed');
    }
    return { restarted: false };
  }

  if (poolIsReady(pool)) {
    return { restarted: false };
  }

  await executeSql(run, terminateStalePoolSql);
  await waitForPool(run, wait);
  return { restarted: false };
}
