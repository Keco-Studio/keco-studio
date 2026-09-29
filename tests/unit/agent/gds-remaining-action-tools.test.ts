import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/services/gameDesignSystemService', () => ({
  createAgentStructuredGameDesignSystem: jest.fn(), createGameDesignSystemGenerationJob: jest.fn(),
  getGameDesignSystem: jest.fn(), getGameDesignSystemGenerationJob: jest.fn(),
  getGameDesignSystemVersion: jest.fn(),
  IdempotencyConflictError: class IdempotencyConflictError extends Error {},
}));
jest.mock('@/lib/services/gameDesignSystemWriteService.server', () => ({
  createPublicGameDesignSystemVersion: jest.fn(),
  PublicGameDesignSystemVersionError: class PublicGameDesignSystemVersionError extends Error {
    publicMessage: string;
    constructor(code: string) { super(code); this.publicMessage = code; }
  },
}));
jest.mock('@/lib/server/supabaseServiceRole', () => ({ getSupabaseServiceRoleClient: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/services/gddGenerationService', () => ({
  getPublicGddGenerationJob: jest.fn(), cancelGddGenerationJob: jest.fn(),
}));
jest.mock('@/lib/gameDesignSystemGeneration', () => ({ hashResolvedGenerationInput: jest.fn(() => 'input-hash') }));
jest.mock('@/lib/game-design-system/sourceSnapshots', () => ({ resolveGameDesignSourceSnapshots: jest.fn() }));

import { createAgentStructuredGameDesignSystem, createGameDesignSystemGenerationJob, getGameDesignSystem,
  getGameDesignSystemGenerationJob, getGameDesignSystemVersion } from '@/lib/services/gameDesignSystemService';
import { resolveGameDesignSourceSnapshots } from '@/lib/game-design-system/sourceSnapshots';
import { createPublicGameDesignSystemVersion } from '@/lib/services/gameDesignSystemWriteService.server';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getPublicGddGenerationJob, cancelGddGenerationJob } from '@/lib/services/gddGenerationService';
import { createGameDesignSystemTool } from '@/lib/agent/tools/create-game-design-system';
import { createGameDesignSystemVersionTool } from '@/lib/agent/tools/create-game-design-system-version';
import { unbindGameDesignSystemTool } from '@/lib/agent/tools/unbind-game-design-system';
import { retryGameDesignSystemGenerationTool } from '@/lib/agent/tools/retry-game-design-system-generation';
import { cancelGddGenerationTool } from '@/lib/agent/tools/cancel-gdd-generation';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const userId = id(1), systemId = id(2), versionId = id(3), projectId = id(4), jobId = id(5);
let ctx: ToolContext;
let binding: { design_system_id: string; version_id: string; updated_at: string } | null;
let deleteCalls: Array<[string, unknown]>;

function actor() {
  return { from: jest.fn(() => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return this; }, delete() { deleteCalls.push(['delete', true]); return this; },
      eq(column: string, value: unknown) { filters.push([column, value]); return this; },
      async maybeSingle() {
        const matches = binding && filters.every(([column, value]) => column === 'project_id' || binding![column as keyof typeof binding] === value);
        if (deleteCalls.length && matches) deleteCalls.push(['deleted', projectId]);
        return { data: matches ? (deleteCalls.length ? { project_id: projectId } : binding) : null, error: null };
      },
    };
    return query;
  }) } as unknown as SupabaseClient;
}

beforeEach(() => {
  jest.clearAllMocks();
  binding = { design_system_id: systemId, version_id: versionId, updated_at: '2026-09-28T00:00:00Z' };
  deleteCalls = [];
  ctx = { userId, workspace: 'game-design-systems', conversationId: id(9), supabase: actor() };
  jest.mocked(getSupabaseServiceRoleClient).mockReturnValue(actor());
  jest.mocked(getGameDesignSystem).mockResolvedValue({ id: systemId, title: 'Rules', source: 'user', owner_id: userId,
    current_version_id: versionId } as never);
  jest.mocked(getUserProjectRole).mockResolvedValue({ isOwner: true, role: 'admin' });
  jest.mocked(resolveGameDesignSourceSnapshots).mockResolvedValue([]);
});

it('creates a structured draft with the same service inputs as the UI', async () => {
  const rules = { schemaVersion: 1, genres: ['RPG'], philosophies: [], suitableFor: 'Teams',
    rules: [{ id: 'rule-one', kind: 'principle', title: 'Clarity', statement: 'Keep the loop clear',
      appliesWhen: 'Always', severity: 'required' }], tableGuidance: [] };
  jest.mocked(createAgentStructuredGameDesignSystem).mockResolvedValue({ id: systemId, title: 'Rules', status: 'draft',
    current_version_id: versionId, updated_at: 'today' } as never);
  const result = await createGameDesignSystemTool.execute({ title: 'Rules', rules, idempotencyKey: id(8) }, ctx);
  expect(result).toMatchObject({ success: true, data: { designSystemId: systemId, currentVersionId: versionId } });
  expect(createAgentStructuredGameDesignSystem).toHaveBeenCalledWith(expect.anything(), userId,
    expect.objectContaining({ title: 'Rules', rules, idempotencyKey: id(8) }));
});

it('confirms version replacement and calls the atomic idempotent writer', async () => {
  const params = { designSystemId: systemId, idempotencyKey: id(8), request: {
    parentVersionId: versionId, expectedCurrentVersionId: versionId, artStyle: null } };
  expect(createGameDesignSystemVersionTool.confirmationPolicy).toBe('always');
  expect(await createGameDesignSystemVersionTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: true, preview: { designSystemId: systemId, expectedCurrentVersionId: versionId } });
  jest.mocked(createPublicGameDesignSystemVersion).mockResolvedValue({ id: id(7), version_number: 2,
    parent_version_id: versionId } as never);
  expect(await createGameDesignSystemVersionTool.execute(params, ctx))
    .toMatchObject({ success: true, data: { versionId: id(7) } });
  expect(createPublicGameDesignSystemVersion).toHaveBeenCalledWith(expect.anything(), {
    systemId, actorId: userId, idempotencyKey: id(8), request: params.request,
  });
  jest.mocked(getGameDesignSystem).mockResolvedValue({ id: systemId, source: 'user', owner_id: userId,
    current_version_id: id(7) } as never);
  expect(await createGameDesignSystemVersionTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: false, error: 'VERSION_STALE' });
});

it('exposes the complete version schema so the model does not guess rule field names', () => {
  const request = (createGameDesignSystemVersionTool.parameters.properties as Record<string, any>).request;
  const rules = request.properties.rules;
  const rule = rules.properties.rules.items;
  const tableGuidance = rules.properties.tableGuidance.items;

  expect(rule.properties.kind.enum).toEqual(['principle', 'constraint', 'pattern', 'anti_pattern', 'check']);
  expect(tableGuidance.required).toEqual(['table', 'purpose', 'fields']);
  expect(tableGuidance.properties.name).toBeUndefined();
  expect(request.anyOf).toEqual(expect.arrayContaining([
    { required: ['document'] },
    { required: ['rules'] },
    { required: ['artStyle'] },
  ]));
});

it('seals and conditionally removes an exact binding after role recheck', async () => {
  const prepared = await unbindGameDesignSystemTool.prepareConfirmation!({ projectId }, ctx);
  expect(prepared).toMatchObject({ success: true, args: { expectedDesignSystemId: systemId,
    expectedVersionId: versionId }, preview: { title: 'Rules' } });
  binding!.version_id = id(7);
  expect(await unbindGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  binding!.version_id = versionId;
  expect(await unbindGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { unbound: true } });
  expect(deleteCalls).toContainEqual(['deleted', projectId]);
  jest.mocked(getUserProjectRole).mockResolvedValue({ isOwner: false, role: 'editor' });
  expect(await unbindGameDesignSystemTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('Only project owners') });
});

it('retries only the actor-owned failed generation job with an idempotency key', async () => {
  jest.mocked(getGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, owner_id: userId,
    status: 'failed', input: { title: 'Rules', sourceSnapshots: [] } } as never);
  jest.mocked(createGameDesignSystemGenerationJob).mockResolvedValue({ id: id(7), status: 'queued' } as never);
  const params = { jobId, idempotencyKey: 'retry-unique-key' };
  expect(await retryGameDesignSystemGenerationTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: true, preview: { jobId, consequence: expect.stringContaining('paid') } });
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: true, data: { previousJobId: jobId, jobId: id(7) } });
  expect(createGameDesignSystemGenerationJob).toHaveBeenCalledWith(expect.anything(), userId,
    { title: 'Rules', sourceSnapshots: [] }, { idempotencyKey: params.idempotencyKey, inputHash: 'input-hash' });
  jest.mocked(getGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, owner_id: id(99),
    status: 'failed' } as never);
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: false, error: 'Generation job not found.' });
});

it('rejects retry when a prior source is inaccessible or changed', async () => {
  const source = { kind: 'document' as const, projectId, resourceId: id(6),
    label: 'Brief', updatedAt: 'today', contentHash: 'a'.repeat(64),
    excerpt: 'Private design', byteCount: 14, truncated: false };
  jest.mocked(getGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, owner_id: userId,
    status: 'failed', input: { title: 'Rules', sourceSnapshots: [source] } } as never);
  const params = { jobId, idempotencyKey: 'retry-unique-key' };
  jest.mocked(resolveGameDesignSourceSnapshots).mockResolvedValue([source]);
  expect(await retryGameDesignSystemGenerationTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: true });

  jest.mocked(resolveGameDesignSourceSnapshots).mockRejectedValue(new Error('Project access denied'));
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
  expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();

  jest.mocked(resolveGameDesignSourceSnapshots).mockResolvedValue([{ ...source, contentHash: 'b'.repeat(64) }]);
  expect(await retryGameDesignSystemGenerationTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
});

it('rejects retry after base system ownership or version changes', async () => {
  const baseDocument = { gameBackground: 'Prior design' };
  const baseRules = { schemaVersion: 1, rules: [] };
  jest.mocked(getGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, owner_id: userId,
    status: 'failed', input: { title: 'Rules', sourceSnapshots: [], baseSystemId: systemId,
      baseVersionId: versionId, baseDocument, baseRules } } as never);
  const params = { jobId, idempotencyKey: 'retry-unique-key' };
  jest.mocked(getGameDesignSystem).mockResolvedValue({ id: systemId, source: 'user', owner_id: id(99),
    current_version_id: versionId } as never);
  expect(await retryGameDesignSystemGenerationTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
  jest.mocked(getGameDesignSystem).mockResolvedValue({ id: systemId, source: 'user', owner_id: userId,
    current_version_id: id(7) } as never);
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
  expect(getGameDesignSystemVersion).not.toHaveBeenCalled();
  expect(createGameDesignSystemGenerationJob).not.toHaveBeenCalled();
});

it('accepts an unchanged visible base version and rejects changed base content', async () => {
  const baseDocument = { gameBackground: 'Prior design' };
  const baseRules = { schemaVersion: 1, rules: [] };
  const input = { title: 'Rules', sourceSnapshots: [], baseSystemId: systemId,
    baseVersionId: versionId, baseDocument, baseRules };
  jest.mocked(getGameDesignSystemGenerationJob).mockResolvedValue({ id: jobId, owner_id: userId,
    status: 'failed', input } as never);
  jest.mocked(getGameDesignSystem).mockResolvedValue({ id: systemId, source: 'user', owner_id: userId,
    current_version_id: versionId } as never);
  jest.mocked(getGameDesignSystemVersion).mockResolvedValue({ id: versionId, system_id: systemId,
    document: baseDocument, rules: baseRules } as never);
  const baseClient = actor();
  ctx.supabase = { from: jest.fn((table: string) => table === 'game_design_system_versions'
    ? { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { id: versionId, system_id: systemId }, error: null }; } }
    : baseClient.from(table)) } as unknown as SupabaseClient;
  const params = { jobId, idempotencyKey: 'retry-unique-key' };
  expect(await retryGameDesignSystemGenerationTool.prepareConfirmation!(params, ctx))
    .toMatchObject({ success: true });
  jest.mocked(createGameDesignSystemGenerationJob).mockResolvedValue({ id: id(7), status: 'queued' } as never);
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: true, data: { jobId: id(7) } });
  expect(createGameDesignSystemGenerationJob).toHaveBeenCalledWith(expect.anything(), userId,
    input, expect.objectContaining({ idempotencyKey: params.idempotencyKey }));
  jest.mocked(getGameDesignSystemVersion).mockResolvedValue({ id: versionId, system_id: systemId,
    document: { gameBackground: 'Changed' }, rules: baseRules } as never);
  expect(await retryGameDesignSystemGenerationTool.execute(params, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('access changed') });
  expect(createGameDesignSystemGenerationJob).toHaveBeenCalledTimes(1);
});

it('cancels a GDD only after project role and exact job-project checks', async () => {
  jest.mocked(getPublicGddGenerationJob).mockResolvedValue({ id: jobId, project_id: projectId,
    status: 'running' } as never);
  jest.mocked(cancelGddGenerationJob).mockResolvedValue({ id: jobId, project_id: projectId,
    status: 'failed', phase: 'failed' } as never);
  const prepared = await cancelGddGenerationTool.prepareConfirmation!({ projectId, jobId }, ctx);
  expect(prepared).toMatchObject({ success: true, preview: { projectId, jobId, status: 'running' } });
  expect(await cancelGddGenerationTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: true, data: { jobId, projectId, status: 'failed' } });
  expect(cancelGddGenerationJob).toHaveBeenCalledWith(expect.anything(), jobId, 'running');
  jest.mocked(cancelGddGenerationJob).mockResolvedValue(null as never);
  expect(await cancelGddGenerationTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('changed after approval') });
  jest.mocked(getUserProjectRole).mockResolvedValue({ isOwner: false, role: 'viewer' });
  expect(await cancelGddGenerationTool.execute((prepared as { args: unknown }).args, ctx))
    .toMatchObject({ success: false, error: expect.stringContaining('editor or admin') });
});
