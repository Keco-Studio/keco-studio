import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingAction } from '@/lib/agent/confirmation';

const getSupabaseServiceRoleClient = jest.fn();

jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient }));

import {
  consumePendingAction,
  loadPendingAction,
  savePendingAction,
} from '@/lib/agent/confirmation';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

function pendingRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversation_id: CONVERSATION_ID,
    tool_name: 'propose_document_edit',
    args: { documentId: '44444444-4444-4444-8444-444444444444' },
    confirmation_mode: 'post_preview',
    status: 'pending',
    suspended_state: {
      messages: [],
      pendingToolCall: {
        id: 'call-1',
        function: { name: 'propose_document_edit', arguments: '{}' },
      },
    },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function action(id: string): Omit<PendingAction, 'status'> {
  const row = pendingRow(id);
  return {
    id,
    conversationId: CONVERSATION_ID,
    toolName: row.tool_name,
    args: row.args,
    confirmationMode: 'post_preview',
    suspendedState: row.suspended_state,
  };
}

function callerClient(ownerUserId: string | null = OWNER_ID) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: ownerUserId ? { user_id: ownerUserId } : null,
    error: null,
  });
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = maybeSingle;
  const from = jest.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, query, maybeSingle };
}

function fluentResult(result: { data: unknown; error: unknown }) {
  const query: Record<string, jest.Mock> = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.gt = jest.fn(() => query);
  query.update = jest.fn(() => query);
  query.maybeSingle = jest.fn().mockResolvedValue(result);
  return query;
}

describe('pending confirmation store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies conversation ownership before inserting with the service-role client', async () => {
    const caller = callerClient();
    const insert = jest.fn().mockResolvedValue({ error: null });
    const admin = { from: jest.fn(() => ({ insert })) };
    getSupabaseServiceRoleClient.mockReturnValue(admin);

    await savePendingAction(caller.client, action('save-owned'), OWNER_ID);

    expect(caller.from).toHaveBeenCalledWith('agent_conversations');
    expect(admin.from).toHaveBeenCalledWith('agent_pending_actions');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'save-owned',
      status: 'pending',
    }));
  });

  it('rejects save when the actor does not own the conversation', async () => {
    const caller = callerClient(OTHER_ID);
    const insert = jest.fn();
    const admin = { from: jest.fn(() => ({ insert })) };
    getSupabaseServiceRoleClient.mockReturnValue(admin);

    await expect(
      savePendingAction(caller.client, action('save-denied'), OWNER_ID)
    ).rejects.toThrow('Unable to save pending action.');
    expect(insert).not.toHaveBeenCalled();
  });

  it('loads through the service role only for the owning actor', async () => {
    const caller = callerClient();
    const query = fluentResult({ data: pendingRow('load-owned'), error: null });
    const admin = { from: jest.fn(() => query) };
    getSupabaseServiceRoleClient.mockReturnValue(admin);

    await expect(loadPendingAction(caller.client, 'load-owned', OWNER_ID)).resolves.toMatchObject({
      id: 'load-owned',
      status: 'pending',
    });
    expect(admin.from).toHaveBeenCalledWith('agent_pending_actions');
    expect(caller.from).toHaveBeenCalledWith('agent_conversations');
  });

  it.each([
    ['expired', { expires_at: new Date(Date.now() - 60_000).toISOString() }],
    ['approved', { status: 'approved' }],
    ['rejected', { status: 'rejected' }],
  ])('does not load %s rows', async (suffix, overrides) => {
    const caller = callerClient();
    const id = `not-pending-${suffix}`;
    const query = fluentResult({ data: pendingRow(id, overrides), error: null });
    getSupabaseServiceRoleClient.mockReturnValue({ from: jest.fn(() => query) });

    await expect(loadPendingAction(caller.client, id, OWNER_ID)).resolves.toBeNull();
  });

  it('never returns a cached action to a different actor', async () => {
    const ownerCaller = callerClient();
    const insert = jest.fn().mockResolvedValue({ error: null });
    getSupabaseServiceRoleClient.mockReturnValue({ from: jest.fn(() => ({ insert })) });
    await savePendingAction(ownerCaller.client, action('cache-isolated'), OWNER_ID);

    const otherCaller = callerClient(OTHER_ID);
    await expect(
      loadPendingAction(otherCaller.client, 'cache-isolated', OTHER_ID)
    ).resolves.toBeNull();
  });

  it('atomically consumes only a pending row and leaves a tombstone', async () => {
    const caller = callerClient();
    const loadQuery = fluentResult({ data: pendingRow('consume-once'), error: null });
    const consumedRow = pendingRow('consume-once', { status: 'approved' });
    const consumeQuery = fluentResult({ data: consumedRow, error: null });
    const admin = { from: jest.fn().mockReturnValueOnce(loadQuery).mockReturnValueOnce(consumeQuery) };
    getSupabaseServiceRoleClient.mockReturnValue(admin);

    await expect(
      consumePendingAction(caller.client, 'consume-once', OWNER_ID, 'approved')
    ).resolves.toBe(true);
    expect(consumeQuery.update).toHaveBeenCalledWith({ status: 'approved' });
    expect(consumeQuery.eq).toHaveBeenCalledWith('id', 'consume-once');
    expect(consumeQuery.eq).toHaveBeenCalledWith('status', 'pending');
    expect(admin.from).toHaveBeenCalledTimes(2);
  });

  it('fails a second consume while retaining the consumed cache tombstone', async () => {
    const caller = callerClient();
    const firstLoad = fluentResult({ data: pendingRow('consume-replay'), error: null });
    const firstUpdate = fluentResult({
      data: pendingRow('consume-replay', { status: 'rejected' }),
      error: null,
    });
    const admin = {
      from: jest.fn()
        .mockReturnValueOnce(firstLoad)
        .mockReturnValueOnce(firstUpdate),
    };
    getSupabaseServiceRoleClient.mockReturnValue(admin);

    await expect(
      consumePendingAction(caller.client, 'consume-replay', OWNER_ID, 'rejected')
    ).resolves.toBe(true);
    await expect(
      consumePendingAction(caller.client, 'consume-replay', OWNER_ID, 'rejected')
    ).resolves.toBe(false);
    expect(admin.from).toHaveBeenCalledTimes(2);
  });
});
