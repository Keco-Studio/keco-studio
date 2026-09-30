import { z } from 'zod';
import { validateMapSceneV3 } from '@/features/create-map/model/directMapSchema';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';
import { mapContentFingerprint } from './update-map-draft';
import { mapSnapshotFields, mapSnapshotParameters, readMapForMutation, type MapSnapshot } from './map-saved-action-support';

const inputSchema = z.object(mapSnapshotFields).strict();
const sealedSchema = inputSchema.extend({ projectId: z.string().uuid(), confirmedAnalysis: z.literal(true) }).strict();

export const analyzeMapCollisionGridTool: AgentTool = {
  name: 'analyze_map_collision_grid',
  description: 'Analyze the validated ready map image, then replace and save its collision grid after exact-state approval. Vision analysis may incur AI usage.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: mapSnapshotParameters,
    required: ['mapId', 'revisionId', 'saveVersion', 'expectedFingerprint'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = inputSchema.parse(params);
      const map = await readMapForMutation(ctx, projectId, input as MapSnapshot);
      if (!map.scene.mapImage?.locked) return { success: false, error: 'A ready map image must be bound before analysis.' };
      return { success: true, args: { ...input, projectId, confirmedAnalysis: true },
        preview: { type: 'map_collision_analysis', projectId,
          mapId: input.mapId, revisionId: input.revisionId, saveVersion: input.saveVersion,
          currentTitle: map.plan.name, currentFingerprint: input.expectedFingerprint,
          replacesExistingGrid: map.scene.collisionGrid !== null,
          consequence: 'Analyze the ready image and replace the saved collision grid.',
        } };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      await readMapForMutation(ctx, projectId, input as MapSnapshot);
      const { analyzeSavedMapCollisionGrid } = await import('@/lib/server/createMapCollisionAnalysisService');
      const grid = await analyzeSavedMapCollisionGrid({
        supabase: ctx.supabase, userId: ctx.userId, projectId,
        mapId: input.mapId, revisionId: input.revisionId,
      });
      const map = await readMapForMutation(ctx, projectId, input as MapSnapshot);
      const scene = validateMapSceneV3(map.plan, { ...map.scene, collisionGrid: grid });
      if (scene.success === false) return { success: false, error: 'Collision analysis did not match the saved map.' };
      const saved = await (await mapService(ctx)).updateDraft({
        projectId, mapId: input.mapId, revisionId: input.revisionId,
        saveVersion: input.saveVersion, plan: map.plan, scene: scene.data,
      });
      return mapResult({ kind: 'map_collision_grid', projectId, mapId: input.mapId,
        revisionId: input.revisionId, saveVersion: saved.saveVersion,
        imageSha256: grid.imageSha256, blockedCells: grid.cells.filter((cell) => cell === 1).length,
        contentFingerprint: mapContentFingerprint(map.plan, scene.data),
      }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
