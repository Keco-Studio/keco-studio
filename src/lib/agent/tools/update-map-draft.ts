import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  validateMapPlanV3, validateMapSceneV3,
  type MapPlanV3, type MapSceneV3,
} from '@/features/create-map/model/directMapSchema';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const inputFields = z.object({
  mapId: z.string().uuid(), revisionId: z.string().uuid(),
  saveVersion: z.number().int().nonnegative(),
  expectedFingerprint: fingerprintSchema,
  plan: z.record(z.unknown()).optional(), scene: z.record(z.unknown()).optional(),
}).strict();
const inputSchema = inputFields.refine((input) => input.plan !== undefined || input.scene !== undefined, 'Plan or scene changes are required.');
const sealedSchema = inputFields.extend({
  projectId: z.string().uuid(), confirmedOverwrite: z.literal(true),
}).strict().refine((input) => input.plan !== undefined && input.scene !== undefined, 'Confirmed map content is incomplete.');

export function mapContentFingerprint(plan: MapPlanV3, scene: MapSceneV3): string {
  return createHash('sha256').update(JSON.stringify({ plan, scene })).digest('hex');
}

function validatedContent(planInput: unknown, sceneInput: unknown) {
  const plan = validateMapPlanV3(planInput);
  if (plan.success === false) throw new Error(`Invalid map plan: ${plan.issues[0]?.message ?? 'unknown error'}`);
  const scene = validateMapSceneV3(plan.data, sceneInput);
  if (scene.success === false) throw new Error(`Invalid map scene: ${scene.issues[0]?.message ?? 'unknown error'}`);
  return { plan: plan.data, scene: scene.data };
}

function managedFieldsChanged(current: { plan: MapPlanV3; scene: MapSceneV3 }, next: { plan: MapPlanV3; scene: MapSceneV3 }) {
  return JSON.stringify(next.plan.references) !== JSON.stringify(current.plan.references)
    || JSON.stringify(next.plan.styleReference) !== JSON.stringify(current.plan.styleReference)
    || JSON.stringify(next.scene.mapImage) !== JSON.stringify(current.scene.mapImage)
    || JSON.stringify(next.scene.collisionGrid) !== JSON.stringify(current.scene.collisionGrid);
}

export const updateMapDraftTool: AgentTool = {
  name: 'update_map_draft',
  description: 'Update fields in a saved V3 map plan or scene after reviewing read_map_detail. Omitted fields retain their saved values. Requires confirmation even in Auto mode. Reference assets, generated images, and collision grids use their dedicated workflows.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: {
    type: 'object', properties: {
      mapId: { type: 'string', format: 'uuid' },
      revisionId: { type: 'string', format: 'uuid' },
      saveVersion: { type: 'integer', minimum: 0 },
      expectedFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      plan: { type: 'object', description: 'Plan fields to replace, such as name, summary, or description.' },
      scene: { type: 'object', description: 'Scene fields to replace; omitted collision grid and image remain saved.' },
    },
    required: ['mapId', 'revisionId', 'saveVersion', 'expectedFingerprint'],
    anyOf: [{ required: ['plan'] }, { required: ['scene'] }],
    additionalProperties: false,
  },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = inputSchema.parse(params);
      const map = await (await mapService(ctx)).readMap({ projectId, mapId: input.mapId });
      const access = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
      if (access.role === 'viewer') return { success: false, error: 'This project requires admin or editor access.' };
      if (map.identity.revisionId !== input.revisionId || map.identity.saveVersion !== input.saveVersion
        || mapContentFingerprint(map.plan, map.scene) !== input.expectedFingerprint) {
        return { success: false, error: 'The map changed. Read its latest detail before requesting approval.' };
      }
      const content = validatedContent({ ...map.plan, ...input.plan }, { ...map.scene, ...input.scene });
      if (managedFieldsChanged(map, content)) {
        return { success: false, error: 'References, generated images, and collision grids require their dedicated map workflows.' };
      }
      return {
        success: true,
        args: { ...input, ...content, projectId, confirmedOverwrite: true },
        preview: {
          type: 'map_draft_overwrite', projectId, mapId: input.mapId,
          revisionId: input.revisionId, saveVersion: input.saveVersion,
          currentTitle: map.plan.name, replacementTitle: content.plan.name,
          currentFingerprint: input.expectedFingerprint,
          replacementFingerprint: mapContentFingerprint(content.plan, content.scene),
          consequence: 'Replace the saved map plan and scene at this revision.',
        },
      };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      const service = await mapService(ctx);
      const map = await service.readMap({ projectId, mapId: input.mapId });
      if (map.identity.revisionId !== input.revisionId || map.identity.saveVersion !== input.saveVersion
        || mapContentFingerprint(map.plan, map.scene) !== input.expectedFingerprint) {
        return { success: false, error: 'The map changed after approval. Read its latest detail and confirm again.' };
      }
      const content = validatedContent(input.plan, input.scene);
      if (managedFieldsChanged(map, content)) {
        return { success: false, error: 'References, generated images, and collision grids require their dedicated map workflows.' };
      }
      const saved = await service.updateDraft({
        projectId, mapId: input.mapId, revisionId: input.revisionId,
        saveVersion: input.saveVersion, ...content,
      });
      return mapResult({
        kind: 'map', projectId, mapId: input.mapId, revisionId: input.revisionId,
        saveVersion: saved.saveVersion,
        contentFingerprint: mapContentFingerprint(content.plan, content.scene),
      }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
