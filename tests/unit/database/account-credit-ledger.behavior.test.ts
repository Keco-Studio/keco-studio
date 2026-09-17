import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
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
  const args = [postgresUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-c', sql];
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

describeDb('account credit ledger real Postgres behavior', () => {
  let fx: ProjectFixture;
  const eventKeys = new Set<string>();
  const referenceKeys = new Set<string>();

  beforeAll(async () => {
    fx = await buildProjectFixture();
  });

  afterEach(() => {
    if (eventKeys.size > 0) {
      const keys = [...eventKeys].map(key => `'${key}'`).join(', ');
      queryJson(`delete from public.ai_usage_events where event_key in (${keys})`);
      eventKeys.clear();
    }
    if (referenceKeys.size > 0) {
      const keys = [...referenceKeys].map(key => `'${key}'`).join(', ');
      queryJson(`delete from public.credit_ledger_entries where reference_key in (${keys})`);
      referenceKeys.clear();
    }
  });

  afterAll(async () => {
    if (fx) await teardownProjectFixture(fx);
  });

  function event(overrides: Partial<{
    eventKey: string;
    actorUserId: string;
    provider: string;
    requestKind: string;
    usage: Usage;
  }> = {}) {
    const eventKey = overrides.eventKey ?? randomUUID();
    eventKeys.add(eventKey);
    return {
      eventKey,
      context: {
        actorUserId: overrides.actorUserId ?? fx.owner.id,
        projectId: fx.projectId,
        feature: 'credit_ledger_test',
        operation: 'record_usage',
        correlationId: `credit-${eventKey}`,
      },
      requestKind: overrides.requestKind ?? 'chat_completion',
      provider: overrides.provider ?? 'deepseek',
      model: 'deepseek-chat',
      attempt: 1,
      providerRequestId: `request-${eventKey}`,
      outcome: 'succeeded',
      usage: overrides.usage === undefined
        ? { inputTokens: 10, outputTokens: 11, totalTokens: 21 }
        : overrides.usage,
      startedAt: '2026-09-15T00:00:00.000Z',
      finishedAt: '2026-09-15T00:00:01.000Z',
      metadata: { fixture: 'account_credit_ledger' },
    };
  }

  async function record(client: SupabaseClient, payload = event()) {
    return client.rpc('record_ai_usage_event', { p_event: payload });
  }

  async function grant(userId: string, creditDelta: number, reason = 'test allocation') {
    const referenceKey = randomUUID();
    referenceKeys.add(referenceKey);
    return fx.svc.from('credit_ledger_entries').insert({
      user_id: userId,
      credit_delta: creditDelta,
      reason,
      reference_key: referenceKey,
    });
  }

  async function ownSummary(client: SupabaseClient) {
    const result = await client.rpc('account_credit_summary');
    if (result.error || !result.data || typeof result.data !== 'object') {
      throw new Error(`account credit summary failed: ${result.error?.code ?? ''} ${result.error?.message ?? ''}`);
    }
    return result.data as Record<string, unknown>;
  }

  async function adminSummary() {
    const result = await fx.svc.rpc('keco_admin_credit_summary');
    if (result.error || !result.data || typeof result.data !== 'object') {
      throw new Error(`admin credit summary failed: ${result.error?.code ?? ''} ${result.error?.message ?? ''}`);
    }
    return result.data as Record<string, unknown>;
  }

  it('rounds aggregate DeepSeek usage once while excluding unpriced events', async () => {
    expect((await grant(fx.owner.id, 100_000_000)).error).toBeNull();
    for (const payload of [
      event({ usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }),
      event({ usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } }),
      event({ usage: null }),
      event({ provider: 'minimax', usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }),
      event({ requestKind: 'embedding', usage: { inputTokens: 90, outputTokens: 0, totalTokens: 90 } }),
      event({ provider: 'pixellab', requestKind: 'provider_generation', usage: null }),
    ]) expect((await record(fx.owner.client, payload)).error).toBeNull();

    expect(await ownSummary(fx.owner.client)).toEqual(expect.objectContaining({
      allocated: 100_000_000,
      used: 7,
      remaining: 99_999_993,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 1,
    }));
  });

  it('combines grants and corrections before calculating a non-exhausted balance', async () => {
    expect((await grant(fx.owner.id, 100)).error).toBeNull();
    expect((await grant(fx.owner.id, -20, 'test correction')).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();

    expect(await ownSummary(fx.owner.client)).toEqual(expect.objectContaining({
      allocated: 80,
      used: 7,
      remaining: 73,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 0,
    }));
  });

  it('reports exhausted allocations as zero remaining and positive overage', async () => {
    expect((await grant(fx.owner.id, 5)).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();

    expect(await ownSummary(fx.owner.client)).toEqual(expect.objectContaining({
      allocated: 5,
      used: 7,
      remaining: 0,
      overage: 2,
    }));
  });

  it('rejects duplicate allocation references', async () => {
    const referenceKey = randomUUID();
    referenceKeys.add(referenceKey);
    const entry = {
      user_id: fx.owner.id,
      credit_delta: 10,
      reason: 'duplicate guard',
      reference_key: referenceKey,
    };
    expect((await fx.svc.from('credit_ledger_entries').insert(entry)).error).toBeNull();
    expect((await fx.svc.from('credit_ledger_entries').insert(entry)).error).not.toBeNull();
  });

  it('fails closed when an account allocation becomes negative', async () => {
    expect((await grant(fx.owner.id, -1, 'invalid net allocation')).error).toBeNull();
    expect((await fx.owner.client.rpc('account_credit_summary')).error).not.toBeNull();
    expect((await fx.svc.rpc('keco_admin_credit_summary')).error).not.toBeNull();
  });

  it('isolates own-user summaries while including grant and usage identities in admin totals', async () => {
    expect((await grant(fx.owner.id, 100)).error).toBeNull();
    expect((await grant(fx.outsider.id, 200)).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();
    expect((await record(fx.outsider.client, event({ actorUserId: fx.outsider.id, usage: { inputTokens: 6, outputTokens: 9, totalTokens: 15 } }))).error).toBeNull();
    expect((await record(fx.admin.client, event({
      actorUserId: fx.admin.id,
      provider: 'minimax',
      usage: { inputTokens: 6, outputTokens: 9, totalTokens: 15 },
    }))).error).toBeNull();

    expect(await ownSummary(fx.owner.client)).toEqual(expect.objectContaining({
      allocated: 100,
      used: 7,
      remaining: 93,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 0,
    }));
    expect(await adminSummary()).toEqual(expect.objectContaining({
      allocated: 300,
      used: 12,
      remaining: 288,
      overage: 0,
      deepseekTokens: 36,
      incompleteCount: 0,
      users: expect.objectContaining({
        [fx.owner.id]: expect.objectContaining({ allocated: 100, used: 7 }),
        [fx.outsider.id]: expect.objectContaining({ allocated: 200, used: 5 }),
        [fx.admin.id]: expect.objectContaining({
          allocated: 0,
          used: 0,
          remaining: 0,
          overage: 0,
          deepseekTokens: 0,
          incompleteCount: 0,
        }),
      }),
    }));
  });

  it('denies unauthenticated and browser access to private ledger and admin summary', async () => {
    expect((await anonClient().rpc('account_credit_summary')).error).not.toBeNull();
    expect((await fx.owner.client.rpc('keco_admin_credit_summary')).error).not.toBeNull();
    expect((await fx.owner.client.from('credit_ledger_entries').select()).error).not.toBeNull();
    expect((await fx.owner.client.from('credit_ledger_entries').insert({
      user_id: fx.owner.id,
      credit_delta: 1,
      reason: 'browser denial',
      reference_key: randomUUID(),
    })).error).not.toBeNull();
  });

  it('publishes only the intended ledger and RPC privileges', () => {
    expect(queryJson(`
      select json_build_object(
        'authenticatedSelect', has_table_privilege('authenticated', 'public.credit_ledger_entries', 'select'),
        'authenticatedInsert', has_table_privilege('authenticated', 'public.credit_ledger_entries', 'insert'),
        'serviceSelect', has_table_privilege('service_role', 'public.credit_ledger_entries', 'select'),
        'serviceInsert', has_table_privilege('service_role', 'public.credit_ledger_entries', 'insert'),
        'serviceUpdate', has_table_privilege('service_role', 'public.credit_ledger_entries', 'update'),
        'serviceDelete', has_table_privilege('service_role', 'public.credit_ledger_entries', 'delete'),
        'authenticatedOwnSummary', has_function_privilege('authenticated', 'public.account_credit_summary()', 'execute'),
        'authenticatedAdminSummary', has_function_privilege('authenticated', 'public.keco_admin_credit_summary()', 'execute'),
        'serviceAdminSummary', has_function_privilege('service_role', 'public.keco_admin_credit_summary()', 'execute')
      )
    `)).toEqual({
      authenticatedSelect: false,
      authenticatedInsert: false,
      serviceSelect: true,
      serviceInsert: true,
      serviceUpdate: false,
      serviceDelete: false,
      authenticatedOwnSummary: true,
      authenticatedAdminSummary: false,
      serviceAdminSummary: true,
    });
  });
});
