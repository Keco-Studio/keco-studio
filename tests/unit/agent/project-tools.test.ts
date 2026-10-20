import type { SupabaseClient } from '@supabase/supabase-js';
import { listAccountProjects, findAccessibleProject, createAccountProject } from '@/lib/agent/project-tool-service';
import { listProjectsTool } from '@/lib/agent/tools/list-projects';
import { createProjectTool } from '@/lib/agent/tools/create-project';
import { selectProjectTool } from '@/lib/agent/tools/select-project';
import { parseAgentNavigationDestination } from '@/components/agent/types';
import { createAgentChatRuntime, getScopedAgentRuntime, resetAgentChatRuntimeStoreForTests, selectScopedAgentRuntime } from '@/components/agent/agentChatRuntimeStore';
import type { ToolContext } from '@/lib/agent/types';

const streamLlm = jest.fn();
const executeAgentTool = jest.fn();
const saveMessage = jest.fn();
jest.mock('@/lib/agent/data-access', () => ({ getLibraryProperties: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/agent/llm-client', () => ({ streamLlm }));
jest.mock('@/lib/agent/tool-execution-stream', () => ({ executeAgentTool }));
jest.mock('@/lib/agent/conversation-store', () => ({
  loadConversationHistory: jest.fn().mockResolvedValue([]),
  getConversation: jest.fn().mockResolvedValue(null),
  saveMessage,
  touchConversation: jest.fn(),
  sanitizeMessagesForLlm: (messages: unknown[]) => messages,
}));
jest.mock('@/lib/agent/embedding-config', () => ({ AGENT_RETRIEVAL_ENABLED: false }));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn().mockImplementation(() => ({
    turnId: 'turn-1', recordLlmCall: jest.fn(), recordToolCall: jest.fn(), recordConfirmation: jest.fn(),
  })),
  persistAgentTrace: jest.fn(),
}));

import { runAgentTurn } from '@/lib/agent/core';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

type Row = {
  id: string; name: string; description: string | null; created_at: string;
  userId: string; accepted: boolean; role: string;
};

function fakeSupabase(rows: Row[], rpc = jest.fn()) {
  const calls: Array<[string, unknown, unknown?]> = [];
  const from = jest.fn(() => {
    let selected = rows.slice();
    let max = Infinity;
    const query = {
      select(_columns: string) { return this; },
      eq(column: string, value: unknown) {
        calls.push(['eq', column, value]);
        selected = selected.filter((row) => column === 'membership.user_id' ? row.userId === value : row.id === value);
        return this;
      },
      not(column: string) {
        calls.push(['not', column]);
        selected = selected.filter((row) => row.accepted);
        return this;
      },
      ilike(_column: string, value: string) {
        const literal = value.replace(/\\([\\%_])/g, '$1');
        selected = selected.filter((row) => row.name.toLowerCase() === literal.toLowerCase());
        return this;
      },
      order(column: string, options: { ascending: boolean }) {
        selected.sort((a, b) => {
          const diff = String(a[column as keyof Row]).localeCompare(String(b[column as keyof Row]));
          return options.ascending ? diff : -diff;
        });
        return this;
      },
      limit(value: number) { max = value; return this; },
      or(value: string) {
        calls.push(['or', value]);
        const match = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(value);
        if (match) selected = selected.filter((row) => row.created_at < match[1] ||
          (row.created_at === match[2] && row.id < match[3]));
        return this;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(resolve({ data: selected.slice(0, max).map((row) => ({
          id: row.id, name: row.name, description: row.description, created_at: row.created_at,
          membership: [{ role: row.role }],
        })), error: null }));
      },
    };
    return query;
  });
  return { client: { from, rpc } as unknown as SupabaseClient, calls, rpc };
}

function row(id: string, name: string, role = 'editor', userId = 'user-1', accepted = true, date = '2026-09-24T00:00:00.000Z'): Row {
  return { id, name, description: 'd'.repeat(300), created_at: date, role, userId, accepted };
}

function context(client: SupabaseClient): ToolContext {
  return { userId: 'user-1', conversationId: 'conversation-1', workspace: 'projects', supabase: client };
}

describe('account project tools', () => {
  it('pages accepted memberships in stable created_at/id order and bounds summaries', async () => {
    const { client, calls } = fakeSupabase([
      row(ids[0], 'One', 'admin'), row(ids[1], 'Two', 'viewer'), row(ids[2], 'Hidden', 'editor', 'user-2'),
      row('44444444-4444-4444-8444-444444444444', 'Pending', 'editor', 'user-1', false),
    ]);
    const first = await listAccountProjects(client, 'user-1', { limit: 1 });
    expect(first.projects).toEqual([{ id: ids[1], name: 'Two', description: 'd'.repeat(240), role: 'viewer', canRead: true, canWrite: false }]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await listAccountProjects(client, 'user-1', { cursor: first.nextCursor!, limit: 1 });
    expect(second.projects[0]).toMatchObject({ id: ids[0], role: 'admin', canWrite: true });
    expect(second.nextCursor).toBeNull();
    expect(calls).toContainEqual(['not', 'membership.accepted_at']);
    expect((await listProjectsTool.execute({}, context(client))).data).toMatchObject({ projects: expect.any(Array) });
  });

  it('uses default 20 and caps requested page size at 50', async () => {
    const rows = Array.from({ length: 55 }, (_, index) => row(`${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`, `Project ${index}`));
    const { client } = fakeSupabase(rows);
    expect((await listAccountProjects(client, 'user-1', {})).projects).toHaveLength(20);
    expect((await listAccountProjects(client, 'user-1', { limit: 500 })).projects).toHaveLength(50);
    await expect(listAccountProjects(client, 'user-1', { cursor: 'bad' })).rejects.toThrow('INVALID_CURSOR');
  });

  it('selects exact ID or unique case-insensitive name and rechecks membership', async () => {
    const { client } = fakeSupabase([
      row(ids[0], 'Alpha'), row(ids[1], 'Secret', 'admin', 'user-2'),
      row(ids[2], 'Pending', 'admin', 'user-1', false),
    ]);
    expect((await selectProjectTool.execute({ projectName: 'aLpHa' }, context(client))).navigation)
      .toEqual({ kind: 'project', projectId: ids[0] });
    expect((await selectProjectTool.execute({ projectId: ids[0] }, context(client))).navigation?.projectId).toBe(ids[0]);
    expect((await selectProjectTool.execute({ projectId: ids[1] }, context(client))).error).toBe('PROJECT_NOT_FOUND');
    expect((await selectProjectTool.execute({ projectId: ids[2] }, context(client))).error).toBe('PROJECT_NOT_FOUND');
    expect((await selectProjectTool.execute({ projectName: '/some/url' }, context(client))).navigation).toBeUndefined();
  });

  it('returns bounded candidate summaries for an ambiguous normalized name', async () => {
    const { client } = fakeSupabase([row(ids[0], 'Same'), row(ids[1], 'sAmE')]);
    const result = await selectProjectTool.execute({ projectName: 'same' }, context(client));
    expect(result).toMatchObject({ success: false, error: 'PROJECT_NAME_AMBIGUOUS', data: { candidates: expect.arrayContaining([
      expect.objectContaining({ id: ids[0] }), expect.objectContaining({ id: ids[1] }),
    ]) } });
    expect(result.navigation).toBeUndefined();
  });

  it('passes UUID idempotency to the RPC and maps changed-input conflict', async () => {
    const previous = new Map<string, string>();
    const rpc = jest.fn(async (_name, args) => {
      const canonical = JSON.stringify([args.p_name, args.p_description]);
      const prior = previous.get(args.p_idempotency_key);
      if (prior && prior !== canonical) return { data: null, error: { code: 'KM409', message: 'IDEMPOTENCY_CONFLICT' } };
      previous.set(args.p_idempotency_key, canonical);
      return { data: { project_id: ids[0], folder_id: ids[1] }, error: null };
    });
    const { client } = fakeSupabase([], rpc);
    const args = { name: ' Alpha ', description: ' text ', idempotencyKey: ids[2] };
    expect(await createProjectTool.execute(args, context(client))).toMatchObject({ success: true, data: { projectId: ids[0] } });
    expect(await createProjectTool.execute(args, context(client))).toMatchObject({ success: true, data: { projectId: ids[0] } });
    expect(rpc).toHaveBeenCalledWith('create_project_with_default_resource_idempotent', {
      p_name: 'Alpha', p_description: 'text', p_idempotency_key: ids[2],
    });
    expect((await createProjectTool.execute({ ...args, name: 'Changed' }, context(client))).error).toBe('IDEMPOTENCY_CONFLICT');
    expect(createProjectTool).toMatchObject({ category: 'write', permissionScope: 'account' });
  });

  it('rejects URL-like navigation and activates an isolated studio draft', () => {
    expect(parseAgentNavigationDestination({ kind: 'project', projectId: '/projects/abc' })).toBeNull();
    expect(parseAgentNavigationDestination({ kind: 'url', url: `/${ids[0]}` })).toBeNull();
    const destination = parseAgentNavigationDestination({ kind: 'project', projectId: ids[0], url: '/hostile' });
    expect(destination).toEqual({ kind: 'project', projectId: ids[0] });
    resetAgentChatRuntimeStoreForTests();
    const accountScope = { userId: 'user-1', workspace: 'projects' as const };
    const account = createAgentChatRuntime(accountScope);
    selectScopedAgentRuntime(accountScope, account.key);
    const studioScope = { userId: 'user-1', workspace: 'studio' as const, projectId: destination!.projectId };
    const draft = createAgentChatRuntime(studioScope);
    selectScopedAgentRuntime(studioScope, draft.key);
    expect(getScopedAgentRuntime(studioScope)?.conversationId).toBeUndefined();
    expect(getScopedAgentRuntime(accountScope)?.key).toBe(account.key);
  });
});

async function coreEvents(toolName: string, result: { success: boolean; navigation?: unknown }, workspace: ToolContext['workspace'] = 'projects') {
  streamLlm.mockImplementationOnce(() => (async function* () {
    yield { type: 'tool_call_delta', index: 0, id: 'call-1', name: toolName, arguments: '{}' };
    yield { type: 'finish', reason: 'tool_calls' };
  })()).mockImplementationOnce(() => (async function* () {
    yield { type: 'finish', reason: 'stop' };
  })());
  executeAgentTool.mockImplementation(async function* () { return result; });
  const events = [];
  for await (const event of runAgentTurn({
    conversationId: 'conversation-1', userMessage: 'test', conversationMeta: { autoExecute: true },
    toolContext: { ...context({} as SupabaseClient), workspace },
  })) events.push(event);
  return events;
}

describe('project core permission and navigation event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    saveMessage.mockResolvedValue({ id: 'message-1' });
  });

  it('executes account-scope creation without a project role', async () => {
    const events = await coreEvents('create_project', { success: true });
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', success: true }));
  });

  it('still denies project-bound writes when the role is absent', async () => {
    const events = await coreEvents('create_asset', { success: true }, 'studio');
    expect(executeAgentTool).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_result', success: false, error: 'Select a project before using this operation.',
    }));
  });

  it('emits only a verified typed project destination', async () => {
    const events = await coreEvents('select_project', {
      success: true, navigation: { kind: 'project', projectId: ids[0], url: '/hostile' },
    });
    expect(events).toContainEqual({ type: 'navigation_requested', destination: { kind: 'project', projectId: ids[0] } });
    expect(JSON.stringify(saveMessage.mock.calls)).not.toContain('/hostile');
    jest.clearAllMocks();
    const rejected = await coreEvents('select_project', {
      success: true, navigation: { kind: 'url', projectId: ids[0], url: '/hostile' },
    });
    expect(rejected.find((event) => event.type === 'navigation_requested')).toBeUndefined();
  });
});
