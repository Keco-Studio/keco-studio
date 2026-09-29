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
const identitySchema = z.object({
  mapId: z.string().uuid(), revisionId: z.string().uuid(),
  saveVersion: z.number().int().nonnegative(),
  expectedFingerprint: fingerprintSchema,
});
const inputSchema = identitySchema.extend({ plan: z.record(z.unknown()), scene: z.record(z.unknown()).optional() }).strict()
  .refine((input) => Object.keys(input.plan).length > 0, 'Plan changes are required.');
const sealedSchema = identitySchema.extend({
  plan: z.unknown(), scene: z.unknown(), projectId: z.string().uuid(), confirmedOverwrite: z.literal(true),
}).strict();

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

function mergeMapContent(current: { plan: MapPlanV3; scene: MapSceneV3 }, planPatch: Record<string, unknown>, scenePatch?: Record<string, unknown>) {
  const requestedMap = planPatch.map;
  if (requestedMap && typeof requestedMap === 'object' && !Array.isArray(requestedMap)) {
    const dimensions = requestedMap as { width?: unknown; height?: unknown };
    if (dimensions.width !== undefined && dimensions.width !== current.plan.map.width
      || dimensions.height !== undefined && dimensions.height !== current.plan.map.height) {
      throw Object.assign(new Error('Map size changes require a new map draft.'), { code: 'MAP_RESIZE_REQUIRES_NEW_DRAFT' });
    }
  }
  const { generation, map: _map, ...planFields } = planPatch;
  const generationPatch = generation && typeof generation === 'object' && !Array.isArray(generation)
    ? generation as Record<string, unknown>
    : undefined;
  return validatedContent({ ...current.plan, ...planFields,
    generation: generationPatch ? { ...current.plan.generation, ...generationPatch } : current.plan.generation,
    map: current.plan.map,
  }, { ...current.scene, ...(scenePatch ?? {}) });
}

function unsupportedContentChanged(current: { plan: MapPlanV3; scene: MapSceneV3 }, next: { plan: MapPlanV3; scene: MapSceneV3 }): boolean {
  return JSON.stringify(next.plan.references) !== JSON.stringify(current.plan.references)
    || JSON.stringify(next.plan.styleReference) !== JSON.stringify(current.plan.styleReference)
    || JSON.stringify(next.plan.map) !== JSON.stringify(current.plan.map)
    || JSON.stringify(next.scene) !== JSON.stringify(current.scene)
    || next.plan.schemaVersion !== current.plan.schemaVersion
    || JSON.stringify({ ...next.plan.generation, seed: null }) !== JSON.stringify({ ...current.plan.generation, seed: null });
}

export const updateMapDraftTool: AgentTool = {
  name: 'update_map_draft',
  description: 'Update the name, summary, description, or generation seed in a saved V3 map plan after read_map_detail. Omitted fields retain their saved values. Dimensions require a new map draft. Requires confirmation even in Auto mode.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: {
    type: 'object', properties: {
      mapId: { type: 'string', format: 'uuid' },
      revisionId: { type: 'string', format: 'uuid' },
      saveVersion: { type: 'integer', minimum: 0 },
      expectedFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      plan: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 500 },
        description: { type: 'string', minLength: 1, maxLength: 2000 },
        generation: { type: 'object', additionalProperties: false, properties: {
          seed: { type: ['integer', 'null'], minimum: 0 },
        }, required: ['seed'] },
        map: { type: 'object', additionalProperties: false, description: 'Only use to request a size change; this returns instructions to create a new draft.', properties: {
          width: { type: 'integer' }, height: { type: 'integer' },
        } },
      } },
    },
    required: ['mapId', 'revisionId', 'saveVersion', 'expectedFingerprint', 'plan'],
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
      const content = mergeMapContent(map, input.plan, input.scene);
      if (unsupportedContentChanged(map, content)) {
        return { success: false, error: 'References, generated images, collision grids, and other managed map fields require their dedicated workflows.' };
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
      if (unsupportedContentChanged(map, content)) {
        return { success: false, error: 'Confirmed map content contains unsupported changes. Read its latest detail and confirm again.' };
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
