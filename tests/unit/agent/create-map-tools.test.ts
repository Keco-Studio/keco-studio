import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import type { CreateMapMcpBackend, MapGenerationState, PublicMapWorkspace } from '@/lib/server/createMapMcpService';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from '../create-map/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/createMapPlanner', () => ({ createMapPlanV3: jest.fn() }));
jest.mock('@/lib/server/createMapDocumentSource', () => ({ readCreateMapDocumentSource: jest.fn() }));
jest.mock('@/lib/server/createMapMcpService', () => ({
  ...jest.requireActual('@/lib/server/createMapMcpService'), createMapMcpService: jest.fn(),
}));

import { createMapMcpService, CreateMapMcpError } from '@/lib/server/createMapMcpService';
import { signMapGenerationConfirmation, verifyMapGenerationConfirmation } from '@/lib/server/createMapGenerationConfirmation';
import { fingerprintMapPlanV3 } from '@/lib/gdd-generation/maps/plan';
import { listMapsTool } from '@/lib/agent/tools/list-maps';
import { readMapTool } from '@/lib/agent/tools/read-map';
import { createMapDraftTool } from '@/lib/agent/tools/create-map-draft';
import { generateMapImageTool } from '@/lib/agent/tools/generate-map-image';
import { getMapGenerationStatusTool } from '@/lib/agent/tools/get-map-generation-status';
import { retryMapGenerationTool } from '@/lib/agent/tools/retry-map-generation';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { resolveAllowedTool } from '@/lib/agent/tools';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx: ToolContext = { projectId: id(1), userId: id(2), conversationId: id(3), workspace: 'create-map', userRole: 'admin', supabase: {} as SupabaseClient };
const identity = { mapId: id(4), revisionId: id(5), revisionNumber: 1, saveVersion: 0 };
const statusArgs = { mapId: identity.mapId, revisionId: identity.revisionId, assetId: id(6) };
const generateArgs = { mapId: identity.mapId, revisionId: identity.revisionId, saveVersion: 0 };
const draftArgs = { description: 'A quiet mountain village', idempotencyKey: id(7) };
const tools = [listMapsTool, readMapTool, createMapDraftTool, generateMapImageTool, getMapGenerationStatusTool, retryMapGenerationTool];
let backend: jest.Mocked<CreateMapMcpBackend>;
let state: MapGenerationState;
let workspace: PublicMapWorkspace;
let service: ReturnType<typeof createMapMcpService>;
let now: number;

beforeEach(() => {
  jest.clearAllMocks();
  now = 1_700_000_000_000;
  const plan = makeValidMapPlanV3();
  state = {
    projectId: ctx.projectId!, mapId: identity.mapId, revisionId: identity.revisionId, saveVersion: 0, plan,
    asset: { id: id(6), status: 'planned', generationId: id(8), planFingerprint: fingerprintMapPlanV3(plan), attemptCount: 0,
      lastErrorCode: null, providerJobId: null, storagePath: null, sha256: null, width: null, height: null, hasTransparency: null, imageUrl: null },
  };
  workspace = { projectId: ctx.projectId!, identity, plan, scene: makeEmptyMapSceneV3(), sourceDocumentId: null, generation: state.asset, generationRevisionId: id(5) };
  backend = {
    getProjectRole: jest.fn().mockResolvedValue('admin'),
    listMaps: jest.fn().mockImplementation(async (_projectId, pagination) => {
      const rows = Array.from({ length: 55 }, (_, n) => ({
      id: id(100 + n), projectId: ctx.projectId, projectName: 'Project', name: `Map ${n}`, currentRevisionId: id(200 + n), schemaVersion: 3, updatedAt: '2026-09-24',
      }));
      const index = pagination?.cursor ? rows.findIndex((row) => row.id === pagination.cursor) : -1;
      if (pagination?.cursor && index < 0) throw new CreateMapMcpError('MAP_NOT_FOUND');
      return rows.slice(index + 1, index + 1 + (pagination?.limit ?? 50));
    }),
    readMap: jest.fn().mockResolvedValue(workspace),
    claimDraft: jest.fn().mockResolvedValue({ status: 'claimed', claimToken: id(7), source: undefined, sourceToken: null, references: { references: [], styleReference: null } }),
    createDraft: jest.fn().mockResolvedValue(workspace), releaseDraft: jest.fn(), updateDraft: jest.fn(),
    readRevision: jest.fn().mockResolvedValue({ saveVersion: 0, plan }),
    prepareAssetPlan: jest.fn().mockResolvedValue({ publishedRevisionId: id(5), nextDraftRevisionId: id(9), assetId: id(6), status: 'planned' }),
    findGeneration: jest.fn().mockImplementation(async () => state),
    readGeneration: jest.fn().mockImplementation(async (input) => {
      if (input.projectId !== state.projectId || input.mapId !== state.mapId || input.revisionId !== state.revisionId || input.assetId !== state.asset.id) throw new CreateMapMcpError('MAP_NOT_FOUND');
      return state;
    }),
    invokeProvider: jest.fn().mockImplementation(async () => { state.asset = { ...state.asset, status: 'queued', attemptCount: state.asset.attemptCount + 1 }; }),
  };
  const actual = jest.requireActual<typeof import('@/lib/server/createMapMcpService')>('@/lib/server/createMapMcpService');
  const signing = { secret: 'test-map-confirmation-secret', now: () => now };
  service = actual.createMapMcpService(ctx, {
    backend, randomUUID: () => id(8), now: () => now,
    signConfirmation: (binding) => signMapGenerationConfirmation(binding, signing),
    verifyConfirmation: (token, binding) => verifyMapGenerationConfirmation(token, binding, signing),
  });
  jest.mocked(createMapMcpService).mockReturnValue(service);
});

describe('Create Map agent tools', () => {
  it.each(tools)('$name requires project context before arguments or services', async (tool) => {
    await expect(tool.execute({}, { ...ctx, projectId: undefined })).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_REQUIRED' });
    if (tool.prepareConfirmation) await expect(tool.prepareConfirmation({}, { ...ctx, projectId: undefined })).rejects.toMatchObject({ code: 'PROJECT_CONTEXT_REQUIRED' });
    expect(createMapMcpService).not.toHaveBeenCalled();
  });

  it.each(tools)('registers $name only in Create Map', (tool) => {
    expect(resolveAllowedTool(tool.name, 'create-map')).toBe(tool);
    expect(resolveAllowedTool(tool.name, 'studio')).toBeUndefined();
  });

  it('bounds list results to 20 by default and 50 maximum, preserving pagination', async () => {
    const first = await listMapsTool.execute({}, ctx);
    expect(first.data).toMatchObject({ maps: expect.any(Array), nextCursor: id(119) });
    expect((first.data as { maps: unknown[] }).maps).toHaveLength(20);
    expect((await listMapsTool.execute({ limit: 900 }, ctx)).data).toMatchObject({ maps: expect.any(Array), nextCursor: id(149) });
    expect(((await listMapsTool.execute({ limit: 900 }, ctx)).data as { maps: unknown[] }).maps).toHaveLength(50);
    expect(((await listMapsTool.execute({ cursor: id(149) }, ctx)).data as { maps: unknown[] }).maps).toHaveLength(5);
    expect((await listMapsTool.execute({ cursor: id(999) }, ctx)).success).toBe(false);
    expect(backend.getProjectRole).toHaveBeenCalledWith(ctx.projectId, ctx.userId);
    expect(backend.listMaps).toHaveBeenCalledWith(ctx.projectId, { cursor: undefined, limit: 21 });
    expect(backend.listMaps).toHaveBeenCalledWith(ctx.projectId, { cursor: undefined, limit: 51 });
  });

  it('keeps project filtering in the service and returns no scene/provider internals', async () => {
    backend.listMaps.mockResolvedValueOnce([{ id: id(90), projectId: id(91), name: 'Foreign', projectName: 'Secret', currentRevisionId: id(92), updatedAt: '', schemaVersion: 3 }]);
    expect((await listMapsTool.execute({}, ctx)).data).toMatchObject({ maps: [] });
    const result = await readMapTool.execute({ mapId: identity.mapId }, ctx);
    expect(result).toMatchObject({ success: true, displayHint: 'map', data: { plan: { title: state.plan.name }, generation: { revisionId: id(5) } } });
    expect(JSON.stringify(result)).not.toContain('scene');
    expect(JSON.stringify(result)).not.toContain('providerJobId');
    expect(JSON.stringify(result)).not.toContain('description');
  });

  it.each(['admin', 'editor', 'viewer'] as const)('allows %s to read/list/status using fresh service authorization', async (role) => {
    backend.getProjectRole.mockResolvedValue(role);
    expect((await listMapsTool.execute({}, ctx)).success).toBe(true);
    expect((await readMapTool.execute({ mapId: identity.mapId }, ctx)).success).toBe(true);
    expect((await getMapGenerationStatusTool.execute(statusArgs, ctx)).success).toBe(true);
    expect(backend.getProjectRole).toHaveBeenCalledTimes(3);
  });

  it('fails read operations when membership has been revoked', async () => {
    backend.getProjectRole.mockRejectedValue(new Error('No membership'));
    for (const [tool, args] of [[listMapsTool, {}], [readMapTool, { mapId: identity.mapId }], [getMapGenerationStatusTool, statusArgs]] as const) {
      expect((await tool.execute(args, ctx)).success).toBe(false);
    }
  });

  it.each(['admin', 'editor'] as const)('allows %s to create an idempotent draft', async (role) => {
    backend.getProjectRole.mockResolvedValue(role);
    expect(await createMapDraftTool.execute(draftArgs, ctx)).toMatchObject({ success: true, invalidations: [{ type: 'create-map', projectId: ctx.projectId, mapId: identity.mapId }] });
    backend.claimDraft.mockResolvedValueOnce({ status: 'completed', workspace });
    expect((await createMapDraftTool.execute(draftArgs, ctx)).success).toBe(true);
    expect(backend.createDraft).toHaveBeenCalledTimes(1);
    expect(backend.claimDraft).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: ctx.projectId, idempotencyKey: id(7) }));
  });

  it('rejects conflicting idempotency input and explicit project substitution', async () => {
    backend.claimDraft.mockRejectedValueOnce({ code: 'KM409' });
    expect((await createMapDraftTool.execute(draftArgs, ctx)).success).toBe(false);
    expect((await createMapDraftTool.execute({ ...draftArgs, projectId: id(99) }, ctx)).success).toBe(false);
    expect(backend.claimDraft).toHaveBeenCalledTimes(1);
  });

  it('checks editor access in the service even when the tool context claims admin', async () => {
    const prepared = await generateMapImageTool.prepareConfirmation!(generateArgs, ctx);
    expect(prepared.success).toBe(true);
    backend.getProjectRole.mockResolvedValue('viewer');
    expect((await createMapDraftTool.execute(draftArgs, ctx)).success).toBe(false);
    expect((await generateMapImageTool.prepareConfirmation!(generateArgs, ctx)).success).toBe(false);
    expect((await retryMapGenerationTool.prepareConfirmation!({ ...statusArgs, acknowledgeDuplicateBilling: true }, ctx)).success).toBe(false);
    if (prepared.success) expect((await generateMapImageTool.execute(prepared.args, ctx)).success).toBe(false);
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });

  it('rejects maps outside the project', async () => {
    backend.readMap.mockResolvedValueOnce({ ...workspace, projectId: id(99) });
    expect((await readMapTool.execute({ mapId: identity.mapId }, ctx)).success).toBe(false);
    backend.findGeneration.mockResolvedValueOnce({ ...state, projectId: id(99) });
    expect((await generateMapImageTool.prepareConfirmation!(generateArgs, ctx)).success).toBe(false);
  });

  it.each(['mapId', 'revisionId', 'assetId'] as const)('rejects a foreign %s for status and retry', async (field) => {
    expect((await getMapGenerationStatusTool.execute({ ...statusArgs, [field]: id(99) }, ctx)).success).toBe(false);
    expect((await retryMapGenerationTool.prepareConfirmation!({ ...statusArgs, [field]: id(99), acknowledgeDuplicateBilling: true }, ctx)).success).toBe(false);
  });

  it('rejects wrong map/revision identities before preparing paid generation', async () => {
    for (const field of ['mapId', 'revisionId']) {
      expect((await generateMapImageTool.prepareConfirmation!({ ...generateArgs, [field]: id(99) }, ctx)).success).toBe(false);
    }
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });

  it.each([generateMapImageTool, retryMapGenerationTool])('$name always requires confirmation including Auto and legacy skip modes', (tool) => {
    for (const meta of [{ autoExecute: true }, { autoExecute: false }, { skipConfirmation: true }]) expect(needsConfirmation(tool, meta)).toBe(true);
  });

  it.each(['admin', 'editor'] as const)('seals the exact plan and fee for %s, submits once, and returns queued state', async (role) => {
    backend.getProjectRole.mockResolvedValue(role);
    const advance = jest.spyOn(service, 'advanceGeneration');
    const get = jest.spyOn(service, 'getGeneration');
    const prepared = await generateMapImageTool.prepareConfirmation!(generateArgs, ctx);
    expect(prepared).toMatchObject({ success: true, args: { confirmationToken: expect.any(String) }, preview: { plan: state.plan, feeNotice: expect.stringContaining('paid') } });
    expect(backend.invokeProvider).not.toHaveBeenCalled();
    if (!prepared.success) throw new Error('Preparation failed');
    expect(prepared.preview).not.toHaveProperty('confirmationToken');
    expect(await generateMapImageTool.execute(prepared.args, ctx)).toMatchObject({ success: true, data: { generation: { status: 'queued' } }, invalidations: [{ type: 'create-map', projectId: ctx.projectId, mapId: identity.mapId }] });
    expect(backend.invokeProvider).toHaveBeenCalledTimes(1);
    expect(backend.invokeProvider).toHaveBeenCalledWith('submit', expect.objectContaining({ assetId: id(6), expectedAttemptCount: 0 }));
    expect(advance).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects raw execution without server-sealed confirmation arguments', async () => {
    expect((await generateMapImageTool.execute(generateArgs, ctx)).success).toBe(false);
    expect((await retryMapGenerationTool.execute({ ...statusArgs, acknowledgeDuplicateBilling: true }, ctx)).success).toBe(false);
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });

  it.each(['expired', 'attempt', 'plan', 'project', 'token'] as const)('rejects a %s stale confirmation before submitting', async (kind) => {
    const prepared = await generateMapImageTool.prepareConfirmation!(generateArgs, ctx);
    if (!prepared.success) throw new Error('Preparation failed');
    const args = { ...(prepared.args as Record<string, unknown>) };
    if (kind === 'expired') now += 11 * 60_000;
    if (kind === 'attempt') state.asset.attemptCount++;
    if (kind === 'plan') state.plan = { ...state.plan, name: 'Changed plan' };
    if (kind === 'project') args.projectId = id(99);
    if (kind === 'token') args.confirmationToken = 'tampered';
    expect((await generateMapImageTool.execute(args, ctx)).success).toBe(false);
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });

  it('rejects stale queued replays too, without changing existing MCP replay semantics', async () => {
    const prepared = await generateMapImageTool.prepareConfirmation!(generateArgs, ctx);
    if (!prepared.success) throw new Error('Preparation failed');
    state.asset.status = 'queued';
    state.asset.attemptCount++;
    expect((await generateMapImageTool.execute(prepared.args, ctx)).success).toBe(false);
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });

  it('requires explicit duplicate billing acknowledgement before retry preparation and execution', async () => {
    state.asset = { ...state.asset, status: 'failed', providerJobId: 'job', attemptCount: 1 };
    expect((await retryMapGenerationTool.prepareConfirmation!({ ...statusArgs, acknowledgeDuplicateBilling: false }, ctx)).success).toBe(false);
    expect(backend.readGeneration).not.toHaveBeenCalled();
    const prepared = await retryMapGenerationTool.prepareConfirmation!({ ...statusArgs, acknowledgeDuplicateBilling: true }, ctx);
    if (!prepared.success) throw new Error('Preparation failed');
    expect(prepared.preview).toMatchObject({ plan: state.plan, duplicateBillingWarning: expect.stringContaining('charge credits again') });
    expect(prepared.preview).not.toHaveProperty('confirmationToken');
    expect((await generateMapImageTool.execute(prepared.args, ctx)).success).toBe(false);
    expect((await retryMapGenerationTool.execute({ ...(prepared.args as object), acknowledgeDuplicateBilling: false }, ctx)).success).toBe(false);
    expect(backend.invokeProvider).not.toHaveBeenCalled();
    expect((await retryMapGenerationTool.execute(prepared.args, ctx)).success).toBe(true);
    expect(backend.invokeProvider).toHaveBeenCalledTimes(1);
    expect(backend.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({ expectedAttemptCount: 1 }));
  });

  it('uses the existing replace-unknown signed purpose and forwards acknowledgement', async () => {
    state.asset = { ...state.asset, status: 'blocked', lastErrorCode: 'pixellab_submit_outcome_unknown', attemptCount: 1 };
    expect((await generateMapImageTool.prepareConfirmation!(generateArgs, ctx)).success).toBe(false);
    const prepared = await retryMapGenerationTool.prepareConfirmation!({ ...statusArgs, acknowledgeDuplicateBilling: true }, ctx);
    if (!prepared.success) throw new Error('Preparation failed');
    expect((await retryMapGenerationTool.execute(prepared.args, ctx)).success).toBe(true);
    expect(backend.invokeProvider).toHaveBeenCalledWith('retry', expect.objectContaining({ acknowledgeDuplicateBilling: true }));
  });

  it('reads generation status exactly once without any provider advancement', async () => {
    const get = jest.spyOn(service, 'getGeneration');
    const advance = jest.spyOn(service, 'advanceGeneration');
    expect((await getMapGenerationStatusTool.execute(statusArgs, ctx)).success).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(backend.readGeneration).toHaveBeenCalledTimes(1);
    expect(advance).not.toHaveBeenCalled();
    expect(backend.invokeProvider).not.toHaveBeenCalled();
  });
});
