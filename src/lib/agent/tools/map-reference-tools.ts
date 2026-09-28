import { z } from 'zod';
import { validateMapPlanV3, type MapPlanV3 } from '@/features/create-map/model/directMapSchema';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import type { MapReferenceRecord } from '@/lib/server/createMapReferenceService';
import type { AgentTool, ToolContext } from '../types';
import { requireProjectContext } from '../workspace';
import { mapResult, mapService, mapToolError } from './map-tool-support';
import { mapContentFingerprint } from './update-map-draft';
import { mapSnapshotFields, mapSnapshotParameters, readMapForMutation, type MapSnapshot } from './map-saved-action-support';

async function projectReferences(projectId: string, page: { offset: number; limit: number }): Promise<MapReferenceRecord[]> {
  const { listCreateMapReferences } = await import('@/lib/server/createMapReferenceService');
  return listCreateMapReferences(projectId, page, { includePreviewUrls: false });
}

const listSchema = z.object({ offset: z.number().int().nonnegative().max(100_000).default(0), limit: z.number().int().min(1).max(50).default(20) }).strict();
const actionFields = {
  ...mapSnapshotFields,
  action: z.enum(['add_content', 'set_style', 'remove']),
  assetId: z.string().uuid(),
  role: z.enum(['content', 'layout']).optional(),
  usage: z.string().trim().min(1).max(240).optional(),
  copy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).min(1).max(4).optional(),
};
const actionSchema = z.object(actionFields).strict();
const sealedSchema = z.object({ ...actionFields, projectId: z.string().uuid(), confirmedChange: z.literal(true), assetSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function referencePlan(plan: MapPlanV3, input: z.infer<typeof actionSchema>, asset?: MapReferenceRecord): MapPlanV3 {
  if (input.action === 'add_content') {
    if (!asset || !input.role || !input.usage) throw new Error('A validated reference, role, and usage are required.');
    if (plan.references.some((reference) => reference.assetId === asset.id)
      || plan.styleReference?.assetId === asset.id) throw new Error('This asset is already bound to the map.');
    return { ...plan, references: [...plan.references, { assetId: asset.id, sha256: asset.sha256, role: input.role, usage: input.usage }] };
  }
  if (input.action === 'set_style') {
    if (!asset || !input.copy) throw new Error('A validated style reference and copy directives are required.');
    if (plan.references.some((reference) => reference.assetId === asset.id)) throw new Error('This asset is already a content reference.');
    return { ...plan, styleReference: { assetId: asset.id, sha256: asset.sha256, copy: input.copy } };
  }
  const references = plan.references.filter((reference) => reference.assetId !== input.assetId);
  const styleReference = plan.styleReference?.assetId === input.assetId ? null : plan.styleReference;
  if (references.length === plan.references.length && styleReference === plan.styleReference) {
    throw new Error('This reference is not bound to the selected map.');
  }
  return { ...plan, references, styleReference };
}

async function resolveAction(projectId: string, ctx: ToolContext, input: z.infer<typeof actionSchema>) {
  const map = await readMapForMutation(ctx, projectId, input as MapSnapshot);
  const asset = input.action === 'remove' ? undefined
    : await (await import('@/lib/server/createMapReferenceService')).getCreateMapReference(projectId, input.assetId) ?? undefined;
  if (input.action !== 'remove' && !asset) throw new Error('Reference asset was not found in this project.');
  const parsed = validateMapPlanV3(referencePlan(map.plan, input, asset));
  if (parsed.success === false) throw new Error(`Invalid map references: ${parsed.issues[0]?.message ?? 'unknown error'}`);
  return { map, plan: parsed.data, assetSha256: asset?.sha256 ?? (
    map.plan.references.find((reference) => reference.assetId === input.assetId)?.sha256
    ?? map.plan.styleReference?.sha256 ?? ''
  ) };
}

export const listMapReferencesTool: AgentTool = {
  name: 'list_map_references', description: 'List validated image reference assets in the selected project, 20 by default and at most 50.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', properties: {
    offset: { type: 'integer', minimum: 0, maximum: 100000 }, limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = listSchema.parse(params);
      await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
      const items = await projectReferences(projectId, { offset: input.offset, limit: input.limit + 1 });
      return mapResult({ kind: 'map_references', projectId,
        references: items.slice(0, input.limit).map((item) => ({
          assetId: item.id, name: item.name.slice(0, 160), sha256: item.sha256,
          width: item.width, height: item.height,
        })),
        nextOffset: items.length > input.limit ? input.offset + input.limit : null,
      });
    } catch (error) { return mapToolError(error); }
  },
};

export const changeMapReferenceTool: AgentTool = {
  name: 'change_map_reference',
  description: 'Bind a validated project image as a content or style reference, or remove a bound reference. Requires approval and exact saved-map CAS state.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    ...mapSnapshotParameters,
    action: { type: 'string', enum: ['add_content', 'set_style', 'remove'] },
    assetId: { type: 'string', format: 'uuid' },
    role: { type: 'string', enum: ['content', 'layout'] },
    usage: { type: 'string', minLength: 1, maxLength: 240 },
    copy: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: ['color_palette', 'outline', 'detail', 'shading'] } },
  }, required: ['mapId', 'revisionId', 'saveVersion', 'expectedFingerprint', 'action', 'assetId'], additionalProperties: false },
  async prepareConfirmation(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = actionSchema.parse(params);
      const resolved = await resolveAction(projectId, ctx, input);
      return { success: true, args: { ...input, projectId, confirmedChange: true, assetSha256: resolved.assetSha256 },
        preview: { type: 'map_reference_change', projectId, mapId: input.mapId,
          revisionId: input.revisionId, saveVersion: input.saveVersion,
          action: input.action, assetId: input.assetId,
          currentTitle: resolved.map.plan.name,
          consequence: input.action === 'remove' ? 'Remove this reference from the saved map.' : 'Replace the saved map reference binding.',
        } };
    } catch (error) { return mapToolError(error); }
  },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = sealedSchema.parse(params);
      if (input.projectId !== projectId) return { success: false, error: 'Map confirmation project mismatch.' };
      const resolved = await resolveAction(projectId, ctx, input);
      if (resolved.assetSha256 !== input.assetSha256) return { success: false, error: 'Reference asset changed after approval.' };
      const saved = await (await mapService(ctx)).updateDraft({
        projectId, mapId: input.mapId, revisionId: input.revisionId,
        saveVersion: input.saveVersion, plan: resolved.plan, scene: resolved.map.scene,
      });
      return mapResult({ kind: 'map_reference', projectId, mapId: input.mapId,
        revisionId: input.revisionId, saveVersion: saved.saveVersion,
        assetId: input.assetId, action: input.action,
        contentFingerprint: mapContentFingerprint(resolved.plan, resolved.map.scene),
      }, projectId, input.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
