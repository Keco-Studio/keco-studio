import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolContext } from '@/lib/agent/types';
import { makeEmptyMapSceneV3, makeValidMapPlanV3 } from '../create-map/fixtures';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/server/createMapMcpService', () => ({ createMapMcpService: jest.fn() }));
jest.mock('@/lib/services/authorizationService', () => ({ getUserProjectRole: jest.fn() }));

import { createMapMcpService } from '@/lib/server/createMapMcpService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { needsConfirmation } from '@/lib/agent/conversation-meta';
import { readMapDetailTool } from '@/lib/agent/tools/read-map-detail';
import { mapContentFingerprint, updateMapDraftTool } from '@/lib/agent/tools/update-map-draft';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx: ToolContext = {
  projectId: id(1), userId: id(2), conversationId: id(3), workspace: 'create-map',
  supabase: {} as SupabaseClient,
};
const identity = { mapId: id(4), revisionId: id(5), revisionNumber: 0, saveVersion: 2 };

function setup() {
  const plan = makeValidMapPlanV3();
  const scene = makeEmptyMapSceneV3();
  const workspace = { projectId: ctx.projectId!, identity, plan, scene, sourceDocumentId: null, generation: null };
  const readMap = jest.fn().mockResolvedValue(workspace);
  const updateDraft = jest.fn().mockResolvedValue({ mapId: identity.mapId, revisionId: identity.revisionId, saveVersion: 3 });
  jest.mocked(createMapMcpService).mockReturnValue({ readMap, updateDraft } as unknown as ReturnType<typeof createMapMcpService>);
  jest.mocked(getUserProjectRole).mockResolvedValue({ role: 'editor', isOwner: false });
  const input = {
    mapId: identity.mapId, revisionId: identity.revisionId, saveVersion: identity.saveVersion,
    expectedFingerprint: mapContentFingerprint(plan, scene),
    plan: { ...plan, name: 'Updated map' }, scene,
  };
  return { workspace, readMap, updateDraft, input };
}

beforeEach(() => jest.resetAllMocks());

it('reads one complete plan and a bounded scene after project-scoped service authorization', async () => {
  const { readMap, input } = setup();
  const result = await readMapDetailTool.execute({ mapId: identity.mapId }, ctx);
  expect(result).toMatchObject({ success: true, data: {
    mapId: identity.mapId, revisionId: identity.revisionId,
    saveVersion: 2, contentFingerprint: input.expectedFingerprint,
    plan: expect.objectContaining({ description: expect.any(String) }),
  } });
  expect(readMap).toHaveBeenCalledWith({ projectId: ctx.projectId, mapId: identity.mapId });
  expect(JSON.stringify(result)).not.toContain('providerJobId');
});

it('always confirms an exact overwrite and returns the next version with refresh invalidation', async () => {
  const { input, updateDraft } = setup();
  expect(needsConfirmation(updateMapDraftTool, { autoExecute: true })).toBe(true);
  const prepared = await updateMapDraftTool.prepareConfirmation!(input, ctx);
  expect(prepared).toMatchObject({ success: true, preview: {
    type: 'map_draft_overwrite', mapId: identity.mapId, saveVersion: 2,
    currentFingerprint: input.expectedFingerprint, replacementTitle: 'Updated map',
  } });
  if (!prepared.success) throw new Error(prepared.error);
  expect(await updateMapDraftTool.execute(prepared.args, ctx)).toMatchObject({
    success: true, data: { saveVersion: 3 },
    invalidations: [{ type: 'create-map', projectId: ctx.projectId, mapId: identity.mapId }],
  });
  expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({
    projectId: ctx.projectId, mapId: identity.mapId, revisionId: identity.revisionId,
    saveVersion: 2, plan: input.plan, scene: input.scene,
  }));
});

it('preserves omitted scene and plan fields for a partial edit', async () => {
  const { workspace, updateDraft, input } = setup();
  const prepared = await updateMapDraftTool.prepareConfirmation!({
    mapId: input.mapId, revisionId: input.revisionId,
    saveVersion: input.saveVersion, expectedFingerprint: input.expectedFingerprint,
    plan: { name: 'A shorter edit' },
  }, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  expect((await updateMapDraftTool.execute(prepared.args, ctx)).success).toBe(true);
  expect(updateDraft).toHaveBeenCalledWith(expect.objectContaining({
    plan: { ...workspace.plan, name: 'A shorter edit' }, scene: workspace.scene,
  }));
});

it('rejects unapproved calls, foreign maps, and viewer preparation', async () => {
  const { readMap, updateDraft, input } = setup();
  expect((await updateMapDraftTool.execute(input, ctx)).success).toBe(false);
  // The real service enforces ownership; its rejection must prevent approval.
  readMap.mockRejectedValueOnce(new Error('Map does not belong to selected project'));
  expect((await updateMapDraftTool.prepareConfirmation!(input, ctx)).success).toBe(false);
  jest.mocked(getUserProjectRole).mockResolvedValueOnce({ role: 'viewer', isOwner: false });
  expect((await updateMapDraftTool.prepareConfirmation!(input, ctx)).success).toBe(false);
  expect(updateDraft).not.toHaveBeenCalled();
});

it('rejects a stale approval, changed references, and CAS conflict without invalidating', async () => {
  const { workspace, readMap, updateDraft, input } = setup();
  const prepared = await updateMapDraftTool.prepareConfirmation!(input, ctx);
  if (!prepared.success) throw new Error(prepared.error);
  readMap.mockResolvedValueOnce({ ...workspace, identity: { ...identity, saveVersion: 3 } });
  expect((await updateMapDraftTool.execute(prepared.args, ctx)).success).toBe(false);
  expect(updateDraft).not.toHaveBeenCalled();

  const altered = { ...input, plan: { ...input.plan, references: [{
    assetId: id(8), sha256: 'a'.repeat(64), role: 'content', usage: 'terrain',
  }] } };
  expect((await updateMapDraftTool.prepareConfirmation!(altered, ctx)).success).toBe(false);
  const image = { assetKey: 'map-image', sourceRevisionId: id(7),
    width: workspace.plan.map.width, height: workspace.plan.map.height, locked: true };
  expect((await updateMapDraftTool.prepareConfirmation!({ ...input, scene: { mapImage: image } }, ctx)).success).toBe(false);
  updateDraft.mockRejectedValueOnce(new Error('The map revision or save version is stale.'));
  expect((await updateMapDraftTool.execute(prepared.args, ctx)).success).toBe(false);
});
