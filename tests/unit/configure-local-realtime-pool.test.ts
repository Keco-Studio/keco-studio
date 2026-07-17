import { describe, expect, it } from '@jest/globals';

import {
  configureLocalRealtimePool,
  type PoolConfiguratorDependencies,
} from '../../scripts/lib/localRealtimePool';

const DB_CONTAINER = 'supabase_db_keco-studio';
const REALTIME_CONTAINER = 'supabase_realtime_keco-studio';

type FixtureOptions = {
  storedPool?: number | null;
  livePool?: number;
  dbLabel?: string;
  realtimeLabel?: string;
  dbRunning?: boolean;
  realtimeRunning?: boolean;
  terminationBecomesReady?: boolean;
  sqlError?: Error;
};

function createFixture(options: FixtureOptions = {}) {
  let storedPool = options.storedPool === undefined ? null : options.storedPool;
  let livePool = options.livePool ?? 3;
  const commands: string[][] = [];
  const sql: string[] = [];
  const waits: number[] = [];

  const run: PoolConfiguratorDependencies['run'] = async (args) => {
    commands.push([...args]);

    if (args[0] === 'inspect') {
      const container = args.at(-1);
      const isDatabase = container === DB_CONTAINER;
      const running = isDatabase
        ? options.dbRunning ?? true
        : options.realtimeRunning ?? true;
      const label = isDatabase
        ? options.dbLabel ?? 'keco-studio'
        : options.realtimeLabel ?? 'keco-studio';
      return `${running}|${label}\n`;
    }

    if (args[0] === 'exec') {
      const statement = args.at(-1) ?? '';
      sql.push(statement);
      if (options.sqlError) {
        throw options.sqlError;
      }

      const appliesUpdate = statement.includes('jsonb_set');
      const terminatesStalePool = statement.includes('pg_terminate_backend');
      const changed = appliesUpdate && storedPool !== 10;
      if (appliesUpdate) {
        storedPool = 10;
      }
      if (terminatesStalePool && (options.terminationBecomesReady ?? true)) {
        livePool = 0;
      }

      return `${changed ? 1 : 0}|${storedPool ?? 'null'}|${livePool}\n`;
    }

    throw new Error(`Unexpected Docker arguments: ${args.join(' ')}`);
  };

  const wait: PoolConfiguratorDependencies['wait'] = async (milliseconds) => {
    waits.push(milliseconds);
  };

  return { commands, run, sql, wait, waits };
}

describe('configureLocalRealtimePool', () => {
  it('updates and terminates a stale positive pool when db_pool is missing', async () => {
    const fixture = createFixture({ storedPool: null, livePool: 3 });

    const result = await configureLocalRealtimePool({
      run: fixture.run,
      wait: fixture.wait,
      checkOnly: false,
    });

    expect(result).toEqual({ restarted: false });
    expect(fixture.sql.some((statement) => statement.includes('pg_terminate_backend'))).toBe(
      true
    );
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
  });

  it('does not restart when stored and live pool sizes are ten', async () => {
    const fixture = createFixture({ storedPool: 10, livePool: 10 });

    const result = await configureLocalRealtimePool({
      run: fixture.run,
      wait: fixture.wait,
      checkOnly: false,
    });

    expect(result).toEqual({ restarted: false });
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
    expect(fixture.waits).toEqual([]);
  });

  it('terminates a stale positive pool when the stored value is ten', async () => {
    const fixture = createFixture({ storedPool: 10, livePool: 6 });

    const result = await configureLocalRealtimePool({
      run: fixture.run,
      wait: fixture.wait,
    });

    expect(result.restarted).toBe(false);
    const terminateSql = fixture.sql.find((statement) =>
      statement.includes('pg_terminate_backend')
    );
    expect(terminateSql).toContain('SELECT pg_terminate_backend(pid)');
    expect(terminateSql).toContain("application_name = 'realtime_connect'");
    expect(terminateSql).toContain('pid <> pg_backend_pid()');
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
  });

  it('accepts a lazy pool count of zero without terminating connections', async () => {
    const fixture = createFixture({ storedPool: null, livePool: 0 });

    const result = await configureLocalRealtimePool({
      run: fixture.run,
      wait: fixture.wait,
    });

    expect(result).toEqual({ restarted: false });
    expect(fixture.sql.some((statement) => statement.includes('pg_terminate_backend'))).toBe(
      false
    );
  });

  it('refuses containers with a different Supabase project label', async () => {
    const fixture = createFixture({ dbLabel: 'another-project' });

    await expect(
      configureLocalRealtimePool({ run: fixture.run, wait: fixture.wait })
    ).rejects.toThrow('Refusing to configure a non-keco-studio Supabase container');
    expect(fixture.sql).toEqual([]);
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
  });

  it('requires both local Supabase containers to be running', async () => {
    const fixture = createFixture({ realtimeRunning: false });

    await expect(
      configureLocalRealtimePool({ run: fixture.run, wait: fixture.wait })
    ).rejects.toThrow(
      'Required local Supabase container is not running: supabase_realtime_keco-studio'
    );
    expect(fixture.sql).toEqual([]);
  });

  it('checks without updating or restarting', async () => {
    const fixture = createFixture({ storedPool: 10, livePool: 10 });

    const result = await configureLocalRealtimePool({
      run: fixture.run,
      wait: fixture.wait,
      checkOnly: true,
    });

    expect(result).toEqual({ restarted: false });
    expect(fixture.sql).toHaveLength(1);
    expect(fixture.sql[0]).not.toContain('jsonb_set');
    expect(fixture.sql[0]).not.toMatch(/\bUPDATE\b/i);
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
  });

  it('accepts a lazy pool count of zero in check-only mode', async () => {
    const fixture = createFixture({ storedPool: 10, livePool: 0 });

    await expect(
      configureLocalRealtimePool({
        run: fixture.run,
        wait: fixture.wait,
        checkOnly: true,
      })
    ).resolves.toEqual({ restarted: false });
    expect(fixture.sql).toHaveLength(1);
    expect(fixture.sql[0]).not.toContain('pg_terminate_backend');
  });

  it('fails check-only when the stored pool is not ten without changing it', async () => {
    const fixture = createFixture({ storedPool: 5, livePool: 5 });

    await expect(
      configureLocalRealtimePool({
        run: fixture.run,
        wait: fixture.wait,
        checkOnly: true,
      })
    ).rejects.toThrow('Local Realtime pool verification failed');
    expect(fixture.sql).toHaveLength(1);
    expect(fixture.sql[0]).not.toContain('jsonb_set');
    expect(fixture.commands).not.toContainEqual(['restart', REALTIME_CONTAINER]);
  });

  it('fails check-only for a stale positive pool without terminating it', async () => {
    const fixture = createFixture({ storedPool: 10, livePool: 1 });

    await expect(
      configureLocalRealtimePool({
        run: fixture.run,
        wait: fixture.wait,
        checkOnly: true,
      })
    ).rejects.toThrow('Local Realtime pool verification failed');
    expect(fixture.sql).toHaveLength(1);
    expect(fixture.sql[0]).not.toContain('pg_terminate_backend');
  });

  it('uses guarded SQL that only reads and updates db_pool', async () => {
    const fixture = createFixture({ storedPool: null, livePool: 4 });

    await configureLocalRealtimePool({ run: fixture.run, wait: fixture.wait });

    const applySql = fixture.sql.find((statement) => statement.includes('jsonb_set'));
    expect(applySql).toBeDefined();
    expect(applySql).toContain("external_id = 'realtime-dev'");
    expect(applySql).toContain("tenant_external_id = 'realtime-dev'");
    expect(applySql).toContain("type = 'postgres_cdc_rls'");
    expect(applySql).toMatch(/tenant_count\s*<>\s*1/);
    expect(applySql).toMatch(/extension_count\s*<>\s*1/);
    expect(applySql).toContain("jsonb_typeof(settings) IS DISTINCT FROM 'object'");
    expect(applySql).toContain("jsonb_typeof(settings->'db_pool') <> 'number'");
    expect(applySql).toContain(
      "settings = jsonb_set(settings, '{db_pool}', '10'::jsonb, true)"
    );
    expect(applySql).not.toMatch(/select\s+(?:\w+\.)?settings(?:\s|,|$)/i);
    expect(applySql).not.toMatch(/settings\s*=\s*settings\s*\|\|/i);

    const psqlCommand = fixture.commands.find((args) => args[0] === 'exec');
    expect(psqlCommand?.slice(0, -1)).toEqual([
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
    ]);
  });

  it('times out when a terminated stale pool does not drain', async () => {
    const fixture = createFixture({
      storedPool: 7,
      livePool: 2,
      terminationBecomesReady: false,
    });

    await expect(
      configureLocalRealtimePool({ run: fixture.run, wait: fixture.wait })
    ).rejects.toThrow('Timed out waiting for local Realtime pool');
    expect(fixture.waits.length).toBeGreaterThan(0);
  });

  it('does not expose SQL command details when psql fails', async () => {
    const fixture = createFixture({
      sqlError: new Error('Command failed: psql -c SELECT settings FROM secrets'),
    });

    const promise = configureLocalRealtimePool({ run: fixture.run, wait: fixture.wait });
    await expect(promise).rejects.toThrow('Failed to query local Realtime pool');
    await expect(promise).rejects.not.toThrow('SELECT settings');
  });
});
