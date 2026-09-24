import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  anonClient,
  enforceRlsDbTestRun,
  localPostgresUrl,
  RLS_DB_TESTS_ENABLED,
  buildProjectFixture,
  teardownProjectFixture,
  type ProjectFixture,
} from './helpers/rlsTestClient';

jest.setTimeout(120_000);

enforceRlsDbTestRun(process.env.REQUIRE_RLS_DB_TESTS === '1', RLS_DB_TESTS_ENABLED);
const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;
const postgresUrl = localPostgresUrl();

type Usage = { inputTokens: number; outputTokens: number; totalTokens: number } | null;

function queryJson<T = Record<string, unknown>>(sql: string): T | null {
  const args = [postgresUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-c', sql];
  const result = spawnSync('psql', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr?.trim() || result.error?.message || 'no error details'}`);
  }
  const output = (result.stdout ?? '').trim();
  return output ? JSON.parse(output) as T : null;
}

type ExplainNode = {
  'Node Type'?: string;
  'Index Name'?: string;
  Plans?: ExplainNode[];
};

function flattenPlan(node: ExplainNode): ExplainNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
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
      model: 'deepseek-flash',
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

  it('charges three Credits per USD for priced DeepSeek usage while excluding unpriced events', async () => {
    expect((await grant(fx.owner.id, 100_000_000)).error).toBeNull();
    for (const payload of [
      event({ usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 } }),
      event({ usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 } }),
      event({ usage: null }),
      event({ provider: 'minimax', usage: { inputTokens: 90, outputTokens: 10, totalTokens: 100 } }),
      event({ requestKind: 'embedding', usage: { inputTokens: 90, outputTokens: 0, totalTokens: 90 } }),
      event({ provider: 'pixellab', requestKind: 'provider_generation', usage: null }),
    ]) expect((await record(fx.owner.client, payload)).error).toBeNull();

    const summary = await ownSummary(fx.owner.client);
    expect(summary).toEqual(expect.objectContaining({
      allocated: 100_000_000,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 1,
    }));
    expect(Number(summary.used)).toBeCloseTo(0.00002565, 12);
    expect(Number(summary.remaining)).toBeCloseTo(99_999_999.99997435, 6);
  });

  it('combines grants and corrections before calculating a non-exhausted balance', async () => {
    expect((await grant(fx.owner.id, 100)).error).toBeNull();
    expect((await grant(fx.owner.id, -20, 'test correction')).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();

    const summary = await ownSummary(fx.owner.client);
    expect(summary).toEqual(expect.objectContaining({
      allocated: 80,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 0,
    }));
    expect(Number(summary.used)).toBeCloseTo(0.0000243, 12);
    expect(Number(summary.remaining)).toBeCloseTo(79.9999757, 6);
  });

  it('keeps the remaining balance precise for fractional Credit charges', async () => {
    expect((await grant(fx.owner.id, 5)).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();

    const summary = await ownSummary(fx.owner.client);
    expect(summary).toEqual(expect.objectContaining({
      allocated: 5,
      overage: 0,
    }));
    expect(Number(summary.used)).toBeCloseTo(0.0000243, 12);
    expect(Number(summary.remaining)).toBeCloseTo(4.9999757, 6);
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
    const before = await adminSummary();
    expect((await grant(fx.owner.id, 100)).error).toBeNull();
    expect((await grant(fx.outsider.id, 200)).error).toBeNull();
    expect((await record(fx.owner.client, event())).error).toBeNull();
    expect((await record(fx.outsider.client, event({ actorUserId: fx.outsider.id, usage: { inputTokens: 6, outputTokens: 9, totalTokens: 15 } }))).error).toBeNull();
    expect((await record(fx.admin.client, event({
      actorUserId: fx.admin.id,
      provider: 'minimax',
      usage: { inputTokens: 6, outputTokens: 9, totalTokens: 15 },
    }))).error).toBeNull();

    const own = await ownSummary(fx.owner.client);
    expect(own).toEqual(expect.objectContaining({
      allocated: 100,
      overage: 0,
      deepseekTokens: 21,
      incompleteCount: 0,
    }));
    expect(Number(own.used)).toBeCloseTo(0.0000243, 12);
    expect(Number(own.remaining)).toBeCloseTo(99.9999757, 6);
    const after = await adminSummary();
    const allocated = Number(before.allocated) + 300;
    expect(after).toEqual(expect.objectContaining({
      allocated,
      deepseekTokens: Number(before.deepseekTokens) + 36,
      incompleteCount: before.incompleteCount,
      users: expect.objectContaining({
        [fx.owner.id]: expect.objectContaining({ allocated: 100 }),
        [fx.outsider.id]: expect.objectContaining({ allocated: 200 }),
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
    expect(Number(after.used) - Number(before.used)).toBeCloseTo(0.0000432, 12);
    expect(Number(after.remaining)).toBeCloseTo(allocated - Number(after.used), 6);
    expect(Number(after.overage)).toBeCloseTo(0, 12);
    const users = after.users as Record<string, Record<string, unknown>>;
    expect(Number(users[fx.owner.id].used)).toBeCloseTo(0.0000243, 12);
    expect(Number(users[fx.outsider.id].used)).toBeCloseTo(0.0000189, 12);
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

  it('uses user-scoped indexes for Credit inputs at representative scale', () => {
    const marker = `credit_index_${randomUUID().replaceAll('-', '')}`;
    try {
      queryJson(`
        insert into public.ai_usage_events (
          event_key, user_id, feature, operation, request_kind, provider,
          correlation_id, attempt, outcome, usage_status, input_tokens,
          output_tokens, total_tokens, pricing_rule_version, started_at,
          finished_at, metadata
        )
        select
          gen_random_uuid(),
          case when sample = 1 then '${fx.owner.id}'::uuid else null end,
          '${marker}',
          'explain_credit_summary',
          'chat_completion',
          'deepseek',
          '${marker}-' || sample,
          1,
          'succeeded',
          case when sample % 2 = 0 then 'unknown' else 'reported' end,
          case when sample % 2 = 0 then null else 1 end,
          case when sample % 2 = 0 then null else 1 end,
          case when sample % 2 = 0 then null else 2 end,
          case when sample % 2 = 0 then null else 1 end,
          '2026-09-15T00:00:00.000Z'::timestamptz,
          '2026-09-15T00:00:01.000Z'::timestamptz,
          '{"fixture":"account_credit_index"}'::jsonb
        from generate_series(1, 12000) as sample
      `);
      queryJson(`
        insert into public.credit_ledger_entries (
          user_id, credit_delta, reason, reference_key
        )
        select
          case when sample = 1 then '${fx.owner.id}'::uuid else '${fx.outsider.id}'::uuid end,
          1,
          'Credit index EXPLAIN fixture',
          '${marker}-ledger-' || sample
        from generate_series(1, 12000) as sample
      `);
      queryJson('analyze public.ai_usage_events');
      queryJson('analyze public.credit_ledger_entries');

      const usagePlan = queryJson<Array<{ Plan: ExplainNode }>>(`
        explain (format json)
        select
          coalesce(sum(event.total_tokens) filter (
            where event.pricing_rule_version = 1
          ), 0)::bigint as deepseek_tokens,
          count(*) filter (
            where event.provider = 'deepseek'
              and event.request_kind = 'chat_completion'
              and event.usage_status = 'unknown'
          )::bigint as incomplete_count
        from public.ai_usage_events as event
        where event.user_id = '${fx.owner.id}'::uuid
          and (
            event.pricing_rule_version = 1
            or (
              event.provider = 'deepseek'
              and event.request_kind = 'chat_completion'
              and event.usage_status = 'unknown'
            )
          )
      `);
      const ledgerPlan = queryJson<Array<{ Plan: ExplainNode }>>(`
        explain (format json)
        select coalesce(sum(entry.credit_delta), 0)::bigint
        from public.credit_ledger_entries as entry
        where entry.user_id = '${fx.owner.id}'::uuid
      `);
      const usageNodes = flattenPlan(usagePlan?.[0]?.Plan ?? {});
      const ledgerNodes = flattenPlan(ledgerPlan?.[0]?.Plan ?? {});

      expect(usageNodes.map(node => node['Index Name']))
        .toContain('ai_usage_events_credit_user_idx');
      expect(ledgerNodes.map(node => node['Index Name']))
        .toContain('credit_ledger_entries_user_id_idx');
      expect([...usageNodes, ...ledgerNodes].map(node => node['Node Type']))
        .not.toContain('Seq Scan');
    } finally {
      queryJson(`delete from public.ai_usage_events where feature = '${marker}'`);
      queryJson(`delete from public.credit_ledger_entries where reference_key like '${marker}-ledger-%'`);
      queryJson('analyze public.ai_usage_events');
      queryJson('analyze public.credit_ledger_entries');
    }
  });
});
