import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const postgresUrl = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Usage = { inputTokens: number; outputTokens: number; totalTokens: number } | null;

function queryJson(sql: string): Record<string, unknown> | null {
  const args = [
    postgresUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-At',
    '-c',
    sql,
  ];
  let result = spawnSync('psql', args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    result = spawnSync('docker', [
      'exec',
      'supabase_db_keco-studio',
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      ...args.slice(1),
    ], { encoding: 'utf8' });
  }
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr ?? result.error?.message ?? '').trim()}`);
  }
  const output = (result.stdout ?? '').trim();
  return output ? JSON.parse(output) as Record<string, unknown> : null;
}

describeDb('AI usage accounting real Postgres behavior', () => {
  let fx: ProjectFixture;
  const eventKeys = new Set<string>();

  beforeAll(async () => {
    fx = await buildProjectFixture();
  });

  afterEach(() => {
    if (eventKeys.size === 0) return;
    const keys = [...eventKeys].map(key => `'${key}'`).join(', ');
    queryJson(`delete from public.ai_usage_events where event_key in (${keys})`);
    eventKeys.clear();
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  });

  function event(overrides: Partial<{
    eventKey: string;
    actorUserId: string;
    provider: string;
    requestKind: string;
    outcome: string;
    usage: Usage;
    metadata: Record<string, unknown>;
  }> = {}) {
    const eventKey = overrides.eventKey ?? randomUUID();
    eventKeys.add(eventKey);
    return {
      eventKey,
      context: {
        actorUserId: overrides.actorUserId ?? fx.owner.id,
        projectId: fx.projectId,
        feature: 'ledger_test',
        operation: 'record_usage',
        correlationId: `ledger-${eventKey}`,
      },
      requestKind: overrides.requestKind ?? 'chat_completion',
      provider: overrides.provider ?? 'deepseek',
      model: 'deepseek-chat',
      attempt: 1,
      providerRequestId: `request-${eventKey}`,
      outcome: overrides.outcome ?? 'succeeded',
      usage: overrides.usage === undefined
        ? { inputTokens: 10, outputTokens: 11, totalTokens: 21 }
        : overrides.usage,
      startedAt: '2026-09-15T00:00:00.000Z',
      finishedAt: '2026-09-15T00:00:01.000Z',
      metadata: overrides.metadata ?? { fixture: 'ai_usage_accounting' },
    };
  }

  async function record(payload = event()) {
    return fx.owner.client.rpc('record_ai_usage_event', { p_event: payload });
  }

  async function summary() {
    const result = await fx.svc.rpc('keco_admin_ai_usage_summary');
    if (result.error || !result.data || typeof result.data !== 'object') {
      throw new Error(`usage summary failed: ${result.error?.code ?? ''} ${result.error?.message ?? ''}`);
    }
    return result.data as Record<string, unknown>;
  }

  it('records an event once when the same event key is retried', async () => {
    const payload = event();
    expect((await record(payload)).error).toBeNull();
    expect((await record(payload)).error).toBeNull();

    const row = queryJson(
      `select json_build_object('count', count(*)) from public.ai_usage_events where event_key = '${payload.eventKey}'`,
    );
    expect(row).toEqual({ count: 1 });
  });

  it('derives the authenticated actor and rejects supplied foreign identities', async () => {
    const foreignContext = await record(event({ actorUserId: fx.outsider.id }));
    expect(foreignContext.error).not.toBeNull();

    const payload = { ...event(), user_id: fx.outsider.id };
    const suppliedUserId = await record(payload);
    expect(suppliedUserId.error).not.toBeNull();
    expect(queryJson(
      `select json_build_object('count', count(*)) from public.ai_usage_events where event_key = '${payload.eventKey}'`,
    )).toEqual({ count: 0 });
  });

  it('persists unknown usage with every token field null', async () => {
    const payload = event({ usage: null, outcome: 'provider_error' });
    expect((await record(payload)).error).toBeNull();

    expect(queryJson(
      `select json_build_object('input', input_tokens, 'output', output_tokens, 'total', total_tokens, 'status', usage_status) from public.ai_usage_events where event_key = '${payload.eventKey}'`,
    )).toEqual({ input: null, output: null, total: null, status: 'unknown' });
  });

  it('rounds aggregate DeepSeek tokens once and excludes non-billable events', async () => {
    const billable = [
      event({ usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }),
      event({ usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } }),
    ];
    const excluded = [
      event({ provider: 'minimax', usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }),
      event({ provider: 'pixellab', requestKind: 'provider_generation', usage: null }),
      event({ requestKind: 'embedding', usage: { inputTokens: 90, outputTokens: 0, totalTokens: 90 } }),
    ];
    for (const payload of [...billable, ...excluded]) expect((await record(payload)).error).toBeNull();

    await expect(summary()).resolves.toEqual(expect.objectContaining({
      deepseekTokens: 21,
      credits: 7,
      unknownEventCount: 0,
      users: expect.objectContaining({
        [fx.owner.id]: expect.objectContaining({ deepseekTokens: 21, credits: 7 }),
      }),
    }));
  });

  it('retains deleted-user usage in account totals but removes it from current-user totals', async () => {
    const payload = event({ actorUserId: fx.outsider.id, usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6 } });
    const recorded = await fx.outsider.client.rpc('record_ai_usage_event', { p_event: payload });
    expect(recorded.error).toBeNull();
    expect((await fx.svc.auth.admin.deleteUser(fx.outsider.id)).error).toBeNull();

    expect(await summary()).toEqual(expect.objectContaining({
      deepseekTokens: 6,
      credits: 2,
      users: {},
    }));
    expect(queryJson(
      `select json_build_object('userId', user_id) from public.ai_usage_events where event_key = '${payload.eventKey}'`,
    )).toEqual({ userId: null });
  });

  it.each([
    ['metadata over 4 KiB', { metadata: { payload: 'x'.repeat(4097) } }],
    ['fractional token usage', { usage: { inputTokens: 1.5, outputTokens: 2, totalTokens: 4 } }],
    ['invalid outcome', { outcome: 'pending' }],
    ['total smaller than token components', { usage: { inputTokens: 10, outputTokens: 11, totalTokens: 20 } }],
  ])('rejects %s without a ledger row', async (_name, overrides) => {
    const payload = event(overrides);
    expect((await record(payload)).error).not.toBeNull();
    expect(queryJson(
      `select json_build_object('count', count(*)) from public.ai_usage_events where event_key = '${payload.eventKey}'`,
    )).toEqual({ count: 0 });
  });

  it('exposes only the recorder to authenticated callers and direct append access to service workers', async () => {
    const browserInsert = await fx.owner.client.from('ai_usage_events').insert({ event_key: randomUUID() });
    expect(browserInsert.error).not.toBeNull();
    expect((await fx.owner.client.rpc('keco_admin_ai_usage_summary')).error).not.toBeNull();

    const serviceEventKey = randomUUID();
    eventKeys.add(serviceEventKey);
    const serviceInsert = await fx.svc.from('ai_usage_events').insert({
      event_key: serviceEventKey,
      user_id: fx.owner.id,
      project_id: fx.projectId,
      feature: 'ledger_test',
      operation: 'service_worker',
      request_kind: 'provider_generation',
      provider: 'pixellab',
      model: null,
      correlation_id: `ledger-${serviceEventKey}`,
      job_id: null,
      artifact_id: null,
      attempt: 1,
      provider_request_id: null,
      outcome: 'succeeded',
      usage_status: 'unknown',
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
      provider_credits: null,
      pricing_rule_version: null,
      started_at: '2026-09-15T00:00:00.000Z',
      finished_at: '2026-09-15T00:00:01.000Z',
      metadata: {},
    });
    expect(serviceInsert.error).toBeNull();
    expect((await fx.svc.from('ai_usage_events').select('event_key').eq('event_key', serviceEventKey)).data)
      .toEqual([{ event_key: serviceEventKey }]);
  });

  it('publishes the intended table and RPC privileges in the database catalog', () => {
    expect(queryJson(`
      select json_build_object(
        'authenticatedInsert', has_table_privilege('authenticated', 'public.ai_usage_events', 'insert'),
        'authenticatedSelect', has_table_privilege('authenticated', 'public.ai_usage_events', 'select'),
        'serviceInsert', has_table_privilege('service_role', 'public.ai_usage_events', 'insert'),
        'serviceSelect', has_table_privilege('service_role', 'public.ai_usage_events', 'select'),
        'authenticatedRecorder', has_function_privilege('authenticated', 'public.record_ai_usage_event(jsonb)', 'execute'),
        'authenticatedSummary', has_function_privilege('authenticated', 'public.keco_admin_ai_usage_summary()', 'execute'),
        'serviceSummary', has_function_privilege('service_role', 'public.keco_admin_ai_usage_summary()', 'execute')
      )
    `)).toEqual({
      authenticatedInsert: false,
      authenticatedSelect: false,
      serviceInsert: true,
      serviceSelect: true,
      authenticatedRecorder: true,
      authenticatedSummary: false,
      serviceSummary: true,
    });
  });
});
