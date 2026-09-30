import { z } from 'zod';
import type { AgentTool } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedPlan, mapResult, mapService, mapToolError } from './map-tool-support';

const paramsSchema = z.object({
  projectId: z.string().uuid().optional(),
  description: z.string().trim().max(4000),
  documentId: z.string().uuid().nullable().default(null),
  referenceIds: z.array(z.string().uuid()).max(4).default([]),
  styleReferenceId: z.string().uuid().nullable().default(null),
  referenceRoles: z.record(z.enum(['content', 'layout'])).default({}),
  referenceUsage: z.record(z.string().min(1).max(240)).default({}),
  styleCopy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).max(4).default([]),
  idempotencyKey: z.string().uuid(),
}).strict().refine((input) => Boolean(input.description || input.documentId), 'A description or document is required.');

export const createMapDraftTool: AgentTool = {
  name: 'create_map_draft',
  description: 'Create and save a map draft from a description and optional project document/references. Reuse the same idempotencyKey when repeating an identical request. Does not generate a paid image.',
  category: 'write', confirmationMode: 'pre_execute', requiredPermission: 'editor',
  parameters: { type: 'object', properties: {
    projectId: { type: 'string', format: 'uuid' },
    description: { type: 'string', maxLength: 4000 },
    documentId: { type: ['string', 'null'], format: 'uuid' },
    referenceIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 4 },
    styleReferenceId: { type: ['string', 'null'], format: 'uuid' },
    referenceRoles: { type: 'object', additionalProperties: { type: 'string', enum: ['content', 'layout'] } },
    referenceUsage: { type: 'object', additionalProperties: { type: 'string', maxLength: 240 } },
    styleCopy: { type: 'array', items: { type: 'string', enum: ['color_palette', 'outline', 'detail', 'shading'] }, maxItems: 4 },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['description', 'idempotencyKey'], additionalProperties: false },
  async execute(params, ctx) {
    const projectId = requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params) as Required<z.infer<typeof paramsSchema>>;
      if (input.projectId && input.projectId !== projectId) return { success: false, error: 'Map project does not match the selected project.' };
      const map = await (await mapService(ctx)).createDraft({ ...input, projectId });
      return mapResult({
        kind: 'map', projectId, mapId: map.mapId, revisionId: map.revisionId,
        revisionNumber: map.revisionNumber, saveVersion: map.saveVersion, plan: boundedPlan(map.plan),
      }, projectId, map.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
