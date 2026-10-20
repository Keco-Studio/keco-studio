import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from '../create-map/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/createMapMcpService', () => ({ createMapMcpService: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));
jest.mock('@/lib/server/createMapCollisionAnalysisService', () => ({ analyzeSavedMapCollisionGrid: jest.fn() }));

import { createMapMcpService } from '@/lib/server/createMapMcpService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { analyzeSavedMapCollisionGrid } from '@/lib/server/createMapCollisionAnalysisService';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { analyzeMapCollisionGridTool } from '@/lib/agent/tools/analyze-map-collision-grid';
import { mapContentFingerprint } from '@/lib/agent/tools/update-map-draft';

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
    generationRevisionId: id(6), generation: null };
  const readMap = jest.fn().mockResolvedValue(map);
  const updateDraft = jest.fn().mockResolvedValue({ mapId: id(4), revisionId: id(5), saveVersion: 4 });
  jest.mocked(createMapMcpService).mockReturnValue({ readMap, updateDraft } as unknown as ReturnType<typeof createMapMcpService>);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  const grid = { version: 1 as const, cellSize: 8 as const,
    columns: plan.map.width / 8, rows: plan.map.height / 8,
    cells: Array.from({ length: plan.map.width * plan.map.height / 64 }, () => 0 as 0 | 1),
    imageSha256: sha };
  jest.mocked(analyzeSavedMapCollisionGrid).mockResolvedValue(grid);
  const snapshot = { mapId: id(4), revisionId: id(5), saveVersion: 3,
    expectedFingerprint: mapContentFingerprint(plan, scene) };
  return { map, readMap, updateDraft, grid, snapshot };
}

beforeEach(() => jest.resetAllMocks());

it('confirms, analyzes the verified image, and saves the grid with CAS', async () => {
  const { updateDraft, snapshot, grid } = setup();
  expect(needsConfirmation(analyzeMapCollisionGridTool, { autoExecute: true })).toBe(true);
  const prepared = await analyzeMapCollisionGridTool.prepareConfirmation!(snapshot, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    type: 'map_collision_analysis', mapId: snapshot.mapId, saveVersion: 3,
  } });
  if (!prepared.success) throw new Error(prepared.error);
  expect(await analyzeMapCollisionGridTool.execute(prepared.args, ctx)).toMatchObject({
    success: true, data: { saveVersion: 4, imageSha256: sha },
    invalidations: [{ type: 'create-map', projectId: ctx.projectId, mapId: snapshot.mapId }],
  });
  expect(analyzeSavedMapCollisionGrid).toHaveBeenCalledWith({
    supabase: ctx.supabase, userId: ctx.userId, projectId: ctx.projectId,
    mapId: snapshot.mapId, revisionId: snapshot.revisionId,
  });
  expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({
    saveVersion: 3, scene: expect.objectContaining({ collisionGrid: grid }),
  }));
});

it('rejects viewer access and stale approval without running analysis', async () => {
  const { map, readMap, updateDraft, snapshot } = setup();
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
  expect((await analyzeMapCollisionGridTool.prepareConfirmation!(snapshot, ctx)).success).toBe(false);
  const prepared = await analyzeMapCollisionGridTool.prepareConfirmation!(snapshot, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  readMap.mockResolvedValueOnce({ ...map, identity: { ...map.identity, saveVersion: 4 } });
  expect((await analyzeMapCollisionGridTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(analyzeSavedMapCollisionGrid).not.toHaveBeenCalled();
  expect(updateDraft).not.toHaveBeenCalled();
});

it('rejects a map edit that happens during image analysis', async () => {
  const { map, readMap, updateDraft, snapshot } = setup();
  const prepared = await analyzeMapCollisionGridTool.prepareConfirmation!(snapshot, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  readMap.mockResolvedValueOnce(map).mockResolvedValueOnce({ ...map, identity: { ...map.identity, saveVersion: 4 } });
  expect((await analyzeMapCollisionGridTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(analyzeSavedMapCollisionGrid).toHaveBeenCalledTimes(1);
  expect(updateDraft).not.toHaveBeenCalled();
});
