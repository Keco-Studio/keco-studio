import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ ...jest.requireActual('@/lib/services/authorizationService'), getUserProjectRole: jest.fn(), verifyProjectAccess: jest.fn() }));
jest.mock('@/lib/game-design-system/sourceSnapshots', () => ({ resolveGameDesignSourceSnapshots: jest.fn() }));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  ...jest.requireActual('@/lib/services/gameDesignSystemService'),
  getGameDesignSystem: jest.fn(), getGameDesignSystemDetail: jest.fn(), getGameDesignSystemVersion: jest.fn(),
  copyGameDesignSystem: jest.fn(), setProjectGameDesignSystem: jest.fn(),
  createGameDesignSystemGenerationJob: jest.fn(), findGameDesignSystemGenerationJobByIdempotencyKey: jest.fn(),
}));
jest.mock('@/lib/services/gddGenerationService', () => ({ createGddGenerationJob: jest.fn() }));
jest.mock('@/lib/agent/data-access', () => ({ getLibraryProperties: jest.fn().mockResolvedValue([]) }));
jest.mock('@/lib/agent/llm-client', () => ({ streamLlm: jest.fn() }));
jest.mock('@/lib/agent/tool-execution-stream', () => ({ executeAgentTool: jest.fn() }));
jest.mock('@/lib/agent/conversation-store', () => ({
  loadConversationHistory: jest.fn().mockResolvedValue([]), getConversation: jest.fn().mockResolvedValue(null),
  saveMessage: jest.fn().mockResolvedValue({ id: 'message-1' }), touchConversation: jest.fn(),
  sanitizeMessagesForLlm: (messages: unknown[]) => messages,
}));
jest.mock('@/lib/agent/confirmation', () => ({ savePendingAction: jest.fn() }));
jest.mock('@/lib/agent/embedding-config', () => ({ AGENT_RETRIEVAL_ENABLED: false }));
jest.mock('@/lib/agent/trace-store', () => ({
  TurnTraceCollector: jest.fn().mockImplementation(() => ({
    turnId: 'turn-1', recordLlmCall: jest.fn(), recordToolCall: jest.fn(), recordConfirmation: jest.fn(),
  })), persistAgentTrace: jest.fn(),
}));

import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { getUserProjectRole, verifyProjectAccess } from '@/lib/services/authorizationService';
import { resolveGameDesignSourceSnapshots } from '@/lib/game-design-system/sourceSnapshots';
import { buildLegacyRuleSet, buildCompatibilityGameDesignDocument } from '@/lib/game-design-system/ruleSchema';
import {
  copyGameDesignSystem, createGameDesignSystemGenerationJob, findGameDesignSystemGenerationJobByIdempotencyKey,
  getGameDesignSystem, getGameDesignSystemDetail, getGameDesignSystemVersion, setProjectGameDesignSystem,
  type GameDesignSystem, type GameDesignSystemVersion,
} from '@/lib/services/gameDesignSystemService';
import { createGddGenerationJob } from '@/lib/services/gddGenerationService';
import { GDD_GENERATION_WARNING } from '@/lib/agent/game-design-system-tool-service';
import { listGameDesignSystemsTool } from '@/lib/agent/tools/list-game-design-systems';
import { readGameDesignSystemTool } from '@/lib/agent/tools/read-game-design-system';
import { copyGameDesignSystemTool } from '@/lib/agent/tools/copy-game-design-system';
import { generateGameDesignSystemTool } from '@/lib/agent/tools/generate-game-design-system';
import { applyGameDesignSystemTool } from '@/lib/agent/tools/apply-game-design-system';
import { generateGddTool } from '@/lib/agent/tools/generate-gdd';
import { getGenerationStatusTool } from '@/lib/agent/tools/get-generation-status';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { resolveAllowedTool } from '@/lib/agent/tools';
import { runAgentTurn } from '@/lib/agent/core';
import { streamLlm } from '@/lib/agent/llm-client';
import { executeAgentTool } from '@/lib/agent/tool-execution-stream';
import { savePendingAction } from '@/lib/agent/confirmation';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), designSystemId = id(2), versionId = id(3), userId = id(4), jobId = id(5);
const applyArgs = { projectId, designSystemId, versionId };
const gddArgs = { projectId, mode: 'professional' as const, idempotencyKey: id(6) };
const generationArgs = { idempotencyKey: id(6), input: { title: ' Rules ', genres: [' RPG '],
  artStyle: { presetId: 'pixel-art', presetVersion: 2, customization: { referenceGames: [] } } } };
let system: GameDesignSystem;
let version: GameDesignSystemVersion;
let ctx: ToolContext;
let tables: Record<string, Array<Record<string, unknown>>>;
let calls: Array<unknown[]>;
let service: SupabaseClient;
let actor: SupabaseClient;

function fakeClient() {
  return { from: jest.fn((table: string) => {
    calls.push(['from', table]);
    let rows = [...(tables[table] ?? [])];
    const query = {
      select(columns: string) { calls.push(['select', table, columns]); return this; },
      eq(column: string, value: unknown) { calls.push(['eq', table, column, value]); rows = rows.filter((row) => row[column] === value); return this; },
      order(column: string, options: { ascending: boolean }) {
        calls.push(['order', table, column, options]);
        return this;
      },
      range(start: number, end: number) { calls.push(['range', table, start, end]); rows = rows.slice(start, end + 1); return this; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ data: rows, error: null })); },
    };
    return query;
  }), rpc: jest.fn().mockResolvedValue({ data: [], error: null }) } as unknown as SupabaseClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  const rules = buildLegacyRuleSet({ genres: ['RPG'], philosophies: [], body: '# Rules\nBe readable.' });
  version = { id: versionId, system_id: designSystemId, version_number: 1, parent_version_id: null,
    rules, document: buildCompatibilityGameDesignDocument(rules, { title: 'Rules' }),
    artStyle: null, artStyleReadError: null, rendered_markdown: '# Rules', source_snapshots: [], conflicts: [],
    diff: {} as never, content_hash: 'hash', created_by: userId, created_at: '2026-09-24' };
  system = { id: designSystemId, owner_id: userId, source: 'user', title: 'Rules', summary: 'Summary',
    genres: ['RPG'], philosophies: [], suitable_for: null, body: 'private body', provenance: { pastedMarkdown: 'private provenance' },
    status: 'draft', current_version_id: versionId, migration_status: 'ready', generation_job_id: null,
    created_at: '2026-09-24', updated_at: '2026-09-24' };
  tables = {
    game_design_systems: [system], game_design_system_versions: [version],
    project_game_design_systems: [{ project_id: projectId, design_system_id: designSystemId, version_id: versionId }],
    projects: [{ id: projectId, name: 'Test Project' }],
    game_design_system_generation_jobs: [{ id: jobId, owner_id: userId, status: 'queued', phase: 'collecting', input: 'secret' }],
    gdd_generation_jobs: [{ id: jobId, owner_id: userId, project_id: projectId, status: 'queued', phase: 'collecting', input: 'secret' }],
  };
  calls = [];
  actor = fakeClient(); service = fakeClient();
  ctx = { userId, conversationId: id(9), workspace: 'game-design-systems', supabase: actor };
  jest.mocked(getSupabaseServiceRoleClient).mockReturnValue(service);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'admin', isOwner: false });
  jest.mocked(verifyProjectAccess).mockRejectedValue(new Error('No access'));
  jest.mocked(resolveGameDesignSourceSnapshots).mockResolvedValue([]);
  jest.mocked(getGameDesignSystem).mockImplementation(async () => system);
  jest.mocked(getGameDesignSystemVersion).mockImplementation(async () => version);
  jest.mocked(getGameDesignSystemDetail).mockImplementation(async () => ({ ...system, current_version: version, versions: [version] }));
  jest.mocked(copyGameDesignSystem).mockImplementation(async () => ({ ...system, id: id(99) }));
  jest.mocked(findGameDesignSystemGenerationJobByIdempotencyKey).mockResolvedValue(null);
  jest.mocked(createGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, status: 'queued', input: { private: 'secret' } } as never);
  jest.mocked(createGddGenerationJob).mockResolvedValue({ id: jobId, status: 'queued', maps: ['private'], input: { private: 'secret' } } as never);
});

const tools = [listGameDesignSystemsTool, readGameDesignSystemTool, copyGameDesignSystemTool,
  generateGameDesignSystemTool, applyGameDesignSystemTool, generateGddTool, getGenerationStatusTool];

describe('GDS account tools', () => {
  it.each(tools)('registers $name only in GDS workspace', (tool) => {
    expect(resolveAllowedTool(tool.name, 'game-design-systems')).toBe(tool);
    expect(resolveAllowedTool(tool.name, 'studio')).toBeUndefined();
    expect(resolveAllowedTool(tool.name, 'projects')).toBeUndefined();
  });

  it('limits the database page to default 20/max 50 plus one and uses a stable tie breaker', async () => {
    tables.game_design_systems = Array.from({ length: 55 }, (_, n) => ({ ...system, id: id(100 + n), title: 't'.repeat(500), summary: 's'.repeat(2000) }));
    const first = await listGameDesignSystemsTool.execute({}, ctx);
    expect(first.data).toMatchObject({ systems: expect.any(Array), hasMore: true, nextOffset: 20 });
    expect((first.data as { systems: unknown[] }).systems).toHaveLength(20);
    const capped = await listGameDesignSystemsTool.execute({ limit: 900 }, ctx);
    expect((capped.data as { systems: unknown[] }).systems).toHaveLength(50);
    const last = await listGameDesignSystemsTool.execute({ offset: 50 }, ctx);
    expect((last.data as { systems: unknown[] }).systems).toHaveLength(5);
    expect(last.data).toMatchObject({ hasMore: false, nextOffset: null });
    expect(calls).toContainEqual(['range', 'game_design_systems', 0, 20]);
    expect(calls).toContainEqual(['range', 'game_design_systems', 0, 50]);
    expect(calls).toContainEqual(['order', 'game_design_systems', 'id', { ascending: true }]);
    expect(actor.rpc).toHaveBeenCalledWith('list_latest_readable_game_design_system_versions', { p_system_ids: tables.game_design_systems.slice(0, 20).map((row) => row.id) });
    const firstSummary = (first.data as { systems: Array<{ title: string; summary: string }> }).systems[0];
    expect(firstSummary.title).toHaveLength(160); expect(firstSummary.summary).toHaveLength(600);
    expect(JSON.stringify(first)).not.toContain('private');
  });

  it('bounds version history and markdown, redacting private source excerpts with the real server policy', async () => {
    system.owner_id = id(88);
    version.rendered_markdown = 'm'.repeat(20000);
    version.source_snapshots = [
      { kind: 'document', projectId: id(80), resourceId: id(81), label: 'Private', excerpt: 'private-project-excerpt', contentHash: 'hash', byteCount: 100, truncated: false },
      { kind: 'legacy_markdown', label: 'Private import', excerpt: 'private-owner-excerpt', contentHash: 'hash', byteCount: 100, truncated: false },
    ];
    const result = await readGameDesignSystemTool.execute({ designSystemId }, ctx);
    expect(result.success).toBe(true);
    expect(getGameDesignSystemDetail).toHaveBeenCalledWith(actor, designSystemId, { versionLimit: 20 });
    expect(verifyProjectAccess).toHaveBeenCalledWith(actor, id(80));
    expect((result.data as { version: { markdown: string; truncated: boolean } }).version.markdown).toHaveLength(16000);
    expect(result.data).toMatchObject({ version: { truncated: true, sources: [{ label: 'Private' }, { label: 'Private import' }] } });
    expect(JSON.stringify(result)).not.toContain('private-project-excerpt');
    expect(JSON.stringify(result)).not.toContain('private-owner-excerpt');
    expect(JSON.stringify(result)).not.toContain('private provenance');
  });

  it('retains bounded readable excerpts and rejects mismatched selected versions', async () => {
    jest.mocked(verifyProjectAccess).mockResolvedValue();
    version.source_snapshots = Array.from({ length: 40 }, () => ({ kind: 'document', projectId, label: 'Source', excerpt: 'a'.repeat(900), contentHash: 'hash', byteCount: 900, truncated: false }));
    const result = await readGameDesignSystemTool.execute({ designSystemId, versionId }, ctx);
    expect((result.data as { version: { sources: unknown[] } }).version.sources).toHaveLength(20);
    expect(result.data).toMatchObject({ version: { sources: expect.arrayContaining([{ kind: 'document', projectId, resourceId: undefined, label: 'Source', excerpt: 'a'.repeat(500), truncated: true }]) } });
    expect((await readGameDesignSystemTool.execute({ designSystemId, versionId: id(77) }, ctx)).success).toBe(false);
  });

  it('does not read service-role version content before the actor-visible system/version check', async () => {
    tables.game_design_system_versions = [{ ...version, system_id: id(99) }];
    expect((await readGameDesignSystemTool.execute({ designSystemId, versionId }, ctx)).success).toBe(false);
    expect(getGameDesignSystemVersion).not.toHaveBeenCalled();
    expect(calls).toContainEqual(['eq', 'game_design_system_versions', 'id', versionId]);
    expect(calls).toContainEqual(['eq', 'game_design_system_versions', 'system_id', designSystemId]);
  });

  it.each(['official', 'user'] as const)('copies %s source through the domain without a project context', async (source) => {
    system.source = source;
    expect((await copyGameDesignSystemTool.execute({ designSystemId }, ctx)).success).toBe(true);
    expect(copyGameDesignSystem).toHaveBeenCalledWith(service, system, userId);
    expect(copyGameDesignSystemTool.permissionScope).toBe('account');
  });

  it('denies foreign nonofficial copies and invisible systems', async () => {
    system.owner_id = id(80);
    expect((await copyGameDesignSystemTool.execute({ designSystemId }, ctx)).success).toBe(false);
    jest.mocked(getGameDesignSystem).mockResolvedValue(null);
    expect((await copyGameDesignSystemTool.execute({ designSystemId }, ctx)).success).toBe(false);
    expect(copyGameDesignSystem).not.toHaveBeenCalled();
  });

  it('normalizes input, preserves hash/key idempotency, and only enqueues a GDS job', async () => {
    jest.mocked(createGameDesignSystemGenerationJob).mockImplementationOnce(async () => {
      calls.push(['enqueue']);
      return { id: jobId, status: 'queued' } as never;
    });
    const result = await generateGameDesignSystemTool.execute(generationArgs, ctx);
    expect(result).toEqual({ success: true, displayHint: 'text', data: { jobType: 'game-design-system', jobId, status: 'queued' } });
    expect(createGameDesignSystemGenerationJob).toHaveBeenCalledWith(service, userId,
      expect.objectContaining({ title: 'Rules', genres: ['RPG'], artStyle: expect.objectContaining({ presetId: 'pixel-art' }) }),
      { idempotencyKey: id(6), inputHash: expect.any(String) });
    expect(calls.slice(calls.findIndex((call) => call[0] === 'enqueue') + 1)).toEqual([]);
    const prior = jest.mocked(createGameDesignSystemGenerationJob).mock.calls[0][2];
    jest.mocked(findGameDesignSystemGenerationJobByIdempotencyKey).mockResolvedValue({ id: jobId, status: 'queued', input: prior } as never);
    expect((await generateGameDesignSystemTool.execute(generationArgs, ctx)).data).toEqual(result.data);
    expect(createGameDesignSystemGenerationJob).toHaveBeenCalledTimes(1);
    expect((await generateGameDesignSystemTool.execute({ ...generationArgs, input: { ...generationArgs.input, title: 'Changed' } }, ctx)).error).toContain('different payload');
  });

  it('fails unauthenticated generation and invalid domain input before enqueue', async () => {
    expect((await generateGameDesignSystemTool.execute(generationArgs, { ...ctx, userId: '' })).success).toBe(false);
    expect((await generateGameDesignSystemTool.execute({ ...generationArgs, input: { ...generationArgs.input, artStyle: {} } }, ctx)).success).toBe(false);
    expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();
  });

  it('has no HTTP wrappers, worker imports, polling, or generation wait in the adapter', () => {
    const files = ['game-design-system-tool-service.ts', ...[
      'list-game-design-systems', 'read-game-design-system', 'copy-game-design-system',
      'generate-game-design-system', 'apply-game-design-system', 'generate-gdd', 'get-generation-status',
    ].map((name) => `tools/${name}.ts`)];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/agent', file), 'utf8');
      expect(source).not.toMatch(/processNext|\/worker['"]|gameDesignSystemClient|fetch\(|setInterval|setTimeout/);
    }
  });
});

describe('explicit project writes', () => {
  it.each([
    ['admin', false, true], ['editor', false, false], ['viewer', false, false], ['viewer', true, true],
  ] as const)('apply checks fresh target access for %s owner=%s', async (role, isOwner, allowed) => {
    jest.mocked(getUserProjectRole).mockResolvedValue({ role, isOwner });
    const result = await applyGameDesignSystemTool.execute(applyArgs, { ...ctx, projectId: id(88), userRole: 'admin' });
    expect(result.success).toBe(allowed);
    expect(getUserProjectRole).toHaveBeenCalledWith(actor, projectId, userId);
    expect(setProjectGameDesignSystem).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) expect(setProjectGameDesignSystem).toHaveBeenCalledWith(actor, projectId, designSystemId, versionId, userId);
  });

  it('rejects missing/ambiguous project ID, foreign version, hidden system, and conflicts', async () => {
    for (const args of [{ designSystemId, versionId }, { ...applyArgs, projectId: 'Duplicate name' }, { ...applyArgs, projectName: 'Name' }, { ...applyArgs, versionId: id(99) }]) {
      expect((await applyGameDesignSystemTool.execute(args, ctx)).success).toBe(false);
    }
    jest.mocked(getGameDesignSystem).mockResolvedValueOnce(null);
    expect((await applyGameDesignSystemTool.execute(applyArgs, ctx)).success).toBe(false);
    version.conflicts = [{ ruleId: 'rule', reason: 'Conflict' }];
    expect((await applyGameDesignSystemTool.execute(applyArgs, ctx)).success).toBe(false);
    expect(setProjectGameDesignSystem).not.toHaveBeenCalled();
  });

  it('denies apply after target access is revoked despite the current context admin role', async () => {
    jest.mocked(getUserProjectRole).mockRejectedValue(new Error('Revoked'));
    expect((await applyGameDesignSystemTool.execute(applyArgs, { ...ctx, userRole: 'admin' })).success).toBe(false);
    expect(setProjectGameDesignSystem).not.toHaveBeenCalled();
  });

  it.each(['admin', 'editor', 'viewer'] as const)('GDD checks %s access and seals pin/mode/warning', async (role) => {
    jest.mocked(getUserProjectRole).mockResolvedValue({ role, isOwner: false });
    const result = await generateGddTool.prepareConfirmation!(gddArgs, ctx);
    expect(result.success).toBe(role !== 'viewer');
    if (result.success) {
      expect(result.args).toEqual({ ...gddArgs, designSystemId, versionId, warning: GDD_GENERATION_WARNING });
      expect(result.preview).toEqual(result.args);
      expect(GDD_GENERATION_WARNING).toContain('up to three paid map images');
      jest.mocked(createGddGenerationJob).mockImplementationOnce(async () => {
        calls.push(['enqueue']);
        return { id: jobId, status: 'queued' } as never;
      });
      expect(await generateGddTool.execute(result.args, ctx)).toEqual({ success: true, displayHint: 'text', data: { jobType: 'gdd', jobId, status: 'queued' } });
      expect(calls.slice(calls.findIndex((call) => call[0] === 'enqueue') + 1)).toEqual([]);
      expect(createGddGenerationJob).toHaveBeenCalledTimes(1);
      expect(createGddGenerationJob).toHaveBeenCalledWith(service, expect.objectContaining({ ownerId: userId, projectId, designSystemId, versionId, idempotencyKey: id(6), inputHash: expect.any(String), input: expect.objectContaining({ mode: 'professional', resourceMode: 'async', versionId }) }));
    } else expect(createGddGenerationJob).not.toHaveBeenCalled();
  });

  it('always confirms even Auto/legacy modes and rejects unsealed execution', async () => {
    for (const meta of [{ autoExecute: true }, { autoExecute: false }, { skipConfirmation: true }]) expect(needsConfirmation(generateGddTool, meta)).toBe(true);
    expect((await generateGddTool.execute(gddArgs, ctx)).success).toBe(false);
    expect(createGddGenerationJob).not.toHaveBeenCalled();
  });

  it('rechecks permission and pinned version after approval before enqueue', async () => {
    const prepared = await generateGddTool.prepareConfirmation!(gddArgs, ctx);
    if (!prepared.success) throw new Error('prepare failed');
    tables.project_game_design_systems[0].version_id = id(66);
    tables.game_design_system_versions.push({ ...version, id: id(66) });
    jest.mocked(getGameDesignSystemVersion).mockResolvedValueOnce({ ...version, id: id(66) });
    expect((await generateGddTool.execute(prepared.args, ctx)).error).toContain('changed');
    tables.project_game_design_systems[0].version_id = versionId;
    jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'viewer', isOwner: false });
    expect((await generateGddTool.execute(prepared.args, ctx)).success).toBe(false);
    expect(createGddGenerationJob).not.toHaveBeenCalled();
  });
});

describe('one-shot job status', () => {
  it.each(['gdd', 'game-design-system'] as const)('checks owner and returns only bounded %s status with one read', async (jobType) => {
    const result = await getGenerationStatusTool.execute({ jobType, jobId }, ctx);
    expect(result).toEqual({ success: true, displayHint: 'text', data: { jobType, jobId, status: 'queued', phase: 'collecting' } });
    expect(service.from).toHaveBeenCalledTimes(1);
    expect(calls).toContainEqual(['eq', jobType === 'gdd' ? 'gdd_generation_jobs' : 'game_design_system_generation_jobs', 'owner_id', userId]);
    expect(createGddGenerationJob).not.toHaveBeenCalled(); expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();
  });

  it.each(['gdd', 'game-design-system'] as const)('denies another owner for %s', async (jobType) => {
    tables[jobType === 'gdd' ? 'gdd_generation_jobs' : 'game_design_system_generation_jobs'][0].owner_id = id(77);
    expect((await getGenerationStatusTool.execute({ jobType, jobId }, ctx)).success).toBe(false);
  });

  it('requires jobType and fresh GDD project access', async () => {
    expect((await getGenerationStatusTool.execute({ jobId }, ctx)).success).toBe(false);
    jest.mocked(getUserProjectRole).mockRejectedValue(new Error('Revoked'));
    expect((await getGenerationStatusTool.execute({ jobType: 'gdd', jobId }, ctx)).success).toBe(false);
  });
});

async function coreEvents(toolName: string, args: unknown, context = ctx) {
  jest.mocked(streamLlm).mockImplementationOnce(() => (async function* () {
    yield { type: 'tool_call_delta' as const, index: 0, id: 'call-1', name: toolName, arguments: JSON.stringify(args) };
    yield { type: 'finish' as const, reason: 'tool_calls' };
  })()).mockImplementationOnce(() => (async function* () { yield { type: 'finish' as const, reason: 'stop' }; })());
  jest.mocked(executeAgentTool).mockImplementation(async function* () { return { success: true }; });
  const events = [];
  for await (const event of runAgentTurn({ conversationId: ctx.conversationId, userMessage: 'test', conversationMeta: { autoExecute: true }, toolContext: context })) events.push(event);
  return events;
}

describe('core explicit-target capability', () => {
  it.each(['apply_game_design_system', 'generate_game_design_system', 'copy_game_design_system'])('allows authenticated %s with no current project/role', async (name) => {
    const events = await coreEvents(name, applyArgs);
    expect(executeAgentTool).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', success: true }));
  });

  it('denies explicit-project capability without authentication', async () => {
    const events = await coreEvents('apply_game_design_system', applyArgs, { ...ctx, userId: '' });
    expect(executeAgentTool).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', success: false, error: 'Authentication required.' }));
  });

  it('Auto pauses GDD before execution and persists exact prepared arguments', async () => {
    const events = await coreEvents('generate_gdd', gddArgs);
    expect(executeAgentTool).not.toHaveBeenCalled();
    expect(createGddGenerationJob).not.toHaveBeenCalled();
    expect(savePendingAction).toHaveBeenCalledWith(actor, expect.objectContaining({ args: { ...gddArgs, designSystemId, versionId, warning: GDD_GENERATION_WARNING } }), userId);
    expect(events).toContainEqual(expect.objectContaining({ type: 'confirmation_request', args: { ...gddArgs, designSystemId, versionId, warning: GDD_GENERATION_WARNING } }));
  });
});
