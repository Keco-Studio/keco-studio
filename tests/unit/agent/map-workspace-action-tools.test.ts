import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { createEmptyCollisionGrid } from '@/features/create-map/model/directMapCollisionGrid';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from '../create-map/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/createMapMcpService', () => ({ createMapMcpService: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/server/createMapReferenceService', () => ({ listCreateMapReferences: jest.fn(), getCreateMapReference: jest.fn() }));

import { createMapMcpService } from '@/lib/server/createMapMcpService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { getCreateMapReference, listCreateMapReferences } from '@/lib/server/createMapReferenceService';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { mapContentFingerprint } from '@/lib/agent/tools/update-map-draft';
import { readMapCollisionGridTool, changeMapCollisionGridTool } from '@/lib/agent/tools/map-collision-tools';
import { listMapReferencesTool, changeMapReferenceTool } from '@/lib/agent/tools/map-reference-tools';
import { listMapGenerationHistoryTool } from '@/lib/agent/tools/list-map-generation-history';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = 'a'.repeat(64);
const ctx: ToolContext = { projectId: id(1), userId: id(2), conversationId: id(3),
  workspace: 'create-map', supabase: {} as SupabaseClient };

function setup() {
  const plan = makeValidMapPlanV3();
  const scene = { ...makeEmptyMapSceneV3(), mapImage: {
    assetKey: 'map-image' as const, sourceRevisionId: id(6),
    width: plan.map.width, height: plan.map.height, locked: true as const,
  } };
  const identity = { mapId: id(4), revisionId: id(5), revisionNumber: 2, saveVersion: 3 };
  const map = { projectId: ctx.projectId!, identity, plan, scene, sourceDocumentId: null,
    generationRevisionId: id(6), generation: { status: 'ready', sha256: sha } };
  const readMap = jest.fn().mockResolvedValue(map);
  const updateDraft = jest.fn().mockResolvedValue({ mapId: id(4), revisionId: id(5), saveVersion: 4 });
  jest.mocked(createMapMcpService).mockReturnValue({ readMap, updateDraft } as unknown as ReturnType<typeof createMapMcpService>);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  const reference = { id: id(7), projectId: ctx.projectId!, name: 'Reference.png',
    storagePath: `references/${ctx.projectId}/${id(7)}/${sha}.png`, sha256: sha,
    width: 300, height: 200, contentType: 'image/png' as const, byteSize: 123,
    previewUrl: 'https://example.invalid/preview' };
  jest.mocked(listCreateMapReferences).mockResolvedValue([reference]);
  jest.mocked(getCreateMapReference).mockImplementation(async (_projectId, assetId) => assetId === reference.id ? reference : null);
  const snapshot = { mapId: id(4), revisionId: id(5), saveVersion: 3,
    expectedFingerprint: mapContentFingerprint(plan, scene) };
  return { map, readMap, updateDraft, reference, snapshot };
}

beforeEach(() => jest.resetAllMocks());

it('reads collision rows with map identity and exact fingerprint', async () => {
  const { map, readMap, snapshot } = setup();
  const grid = createEmptyCollisionGrid(map.plan.map.width, map.plan.map.height, sha);
  grid.cells[1] = 1;
  readMap.mockResolvedValueOnce({ ...map, scene: { ...map.scene, collisionGrid: grid } });
  const result = await readMapCollisionGridTool.execute({ mapId: snapshot.mapId }, ctx);
  expect(result).toMatchObject({ success: true, data: { grid: {
    counts: { 0: grid.cells.length - 1, 1: 1 },
    rowValues: expect.arrayContaining([expect.stringMatching(/^01/)]) },
  } });
});

it('paints and clears under mandatory approval and a CAS save', async () => {
  const { updateDraft, snapshot } = setup();
  expect(needsConfirmation(changeMapCollisionGridTool, { autoExecute: true })).toBe(true);
  const prepared = await changeMapCollisionGridTool.prepareConfirmation!({ ...snapshot,
    action: 'paint', cells: [{ column: 1, row: 0, value: 1 }] }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  expect(await changeMapCollisionGridTool.execute(prepared.args, ctx)).toMatchObject({
    success: true, invalidations: [{ type: 'create-map', projectId: ctx.projectId, mapId: snapshot.mapId }],
  });
  expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({
    saveVersion: 3, scene: expect.objectContaining({ collisionGrid: expect.objectContaining({
      imageSha256: sha, cells: expect.arrayContaining([1]),
    }) }),
  }));
  const clear = await changeMapCollisionGridTool.prepareConfirmation!({ ...snapshot, action: 'clear' }, ctx);
  if (!clear.success) throw new Error(clear.error);
  expect((await changeMapCollisionGridTool.execute(clear.args, ctx)).success).toBe(true);
});

it('rejects stale collision approval and out-of-bounds cells', async () => {
  const { map, readMap, updateDraft, snapshot } = setup();
  const args = { ...snapshot, action: 'paint', cells: [{ column: 999, row: 0, value: 1 }] };
  expect((await changeMapCollisionGridTool.prepareConfirmation!(args, ctx)).success).toBe(false);
  const prepared = await changeMapCollisionGridTool.prepareConfirmation!({ ...snapshot, action: 'clear' }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  readMap.mockResolvedValueOnce({ ...map, identity: { ...map.identity, saveVersion: 4 } });
  expect((await changeMapCollisionGridTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(updateDraft).not.toHaveBeenCalled();
});

it('lists only bounded validated project references and binds one by stable ID', async () => {
  const { snapshot, reference, updateDraft } = setup();
  const listed = await listMapReferencesTool.execute({}, ctx);
  expect(listed).toMatchObject({ success: true, data: { references: [{ assetId: reference.id, sha256: sha }] } });
  expect(listCreateMapReferences).toHaveBeenCalledWith(ctx.projectId, { offset: 0, limit: 21 }, { includePreviewUrls: false });
  expect(getCreateMapReference).not.toHaveBeenCalled();
  const prepared = await changeMapReferenceTool.prepareConfirmation!({ ...snapshot,
    action: 'add_content', assetId: reference.id, role: 'layout', usage: 'Path layout' }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  expect((await changeMapReferenceTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({
    plan: expect.objectContaining({ references: [expect.objectContaining({
      assetId: reference.id, sha256: sha, role: 'layout',
    })] }),
  }));
});

it('pages references beyond the former 100-item cap without signing earlier pages', async () => {
  const { reference } = setup();
  jest.mocked(listCreateMapReferences).mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({
    ...reference, id: id(index + 20),
  })));
  const result = await listMapReferencesTool.execute({ offset: 120, limit: 20 }, ctx);
  expect(listCreateMapReferences).toHaveBeenCalledWith(ctx.projectId, { offset: 120, limit: 21 }, { includePreviewUrls: false });
  expect(result).toMatchObject({ success: true, data: { nextOffset: 140,
    references: expect.arrayContaining([{ assetId: id(20), name: reference.name,
      sha256: sha, width: 300, height: 200 }]) } });
  if (result.success) {
    const references = (result.data as { references: Record<string, unknown>[] }).references;
    expect(references).toHaveLength(20);
    expect(references.every((item) => !('previewUrl' in item))).toBe(true);
  }
});

it('rejects a foreign reference and a stale removal approval', async () => {
  const { map, readMap, updateDraft, snapshot, reference } = setup();
  expect((await changeMapReferenceTool.prepareConfirmation!({ ...snapshot,
    action: 'add_content', assetId: id(99), role: 'content', usage: 'Terrain' }, ctx)).success).toBe(false);
  const bound = { ...map, plan: { ...map.plan, references: [{ assetId: reference.id, sha256: sha, role: 'content' as const, usage: 'Terrain' }] } };
  readMap.mockResolvedValue(bound);
  const current = { ...snapshot, expectedFingerprint: mapContentFingerprint(bound.plan, bound.scene) };
  const prepared = await changeMapReferenceTool.prepareConfirmation!({ ...current, action: 'remove', assetId: reference.id }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  readMap.mockResolvedValueOnce({ ...bound, identity: { ...bound.identity, saveVersion: 4 } });
  expect((await changeMapReferenceTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(updateDraft).not.toHaveBeenCalled();
});

it('bounds generation history to the requested map after project authorization', async () => {
  const { snapshot, readMap } = setup();
  const query = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), limit: jest.fn(), lt: jest.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [
      { id: id(6), revision_number: 2 }, { id: id(8), revision_number: 1 },
    ], error: null })) };
  for (const method of ['select', 'eq', 'order', 'limit', 'lt'] as const) query[method].mockReturnValue(query);
  const localCtx = { ...ctx, supabase: { from: jest.fn().mockReturnValue(query) } as unknown as SupabaseClient };
  const result = await listMapGenerationHistoryTool.execute({ mapId: snapshot.mapId, limit: 1 }, localCtx);
  expect(result).toMatchObject({ success: true, data: { revisions: [{ revisionId: id(6), isBound: true }], nextBeforeRevisionNumber: 2 } });
  expect(readMap).toHaveBeenCalledWith({ projectId: ctx.projectId, mapId: snapshot.mapId });
  expect(query.limit).toHaveBeenCalledWith(2);
});
