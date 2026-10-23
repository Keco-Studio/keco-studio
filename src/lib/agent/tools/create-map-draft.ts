import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { AgentTool, ToolContext } from '../types';
import { requireProjectContext } from '../workspace';
import { boundedPlan, mapResult, mapService, mapToolError } from './map-tool-support';

const paramsObjectSchema = z.object({
  projectId: z.string().uuid().optional(),
  description: z.string().trim().max(4000),
  documentId: z.string().uuid().nullable().default(null),
  referenceIds: z.array(z.string().uuid()).max(4).default([]),
  styleReferenceId: z.string().uuid().nullable().default(null),
  referenceRoles: z.record(z.enum(['content', 'layout'])).default({}),
  referenceUsage: z.record(z.string().min(1).max(240)).default({}),
  styleCopy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).max(4).default([]),
  idempotencyKey: z.string().uuid(),
});
const paramsSchema = paramsObjectSchema.strict()
  .refine((input) => Boolean(input.description || input.documentId), 'A description or document is required.');
const sealedParamsSchema = paramsObjectSchema.extend({
  basePlanNodeId: z.string().uuid().nullable().default(null),
}).strict().refine((input) => Boolean(input.description || input.documentId), 'A description or document is required.');

const agentMapWorkspaces = new Set(['studio', 'game-design-systems']);

function mapConversationIntentHash(input: {
  projectId: string;
  agentConversationId: string;
  basePlanNodeId: string | null;
  mapId: string;
  revisionId: string;
  idempotencyKey: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function resolveDraftProjectId(ctx: ToolContext, explicitProjectId: string | undefined): string {
  if (ctx.projectId) return ctx.projectId;
  if (ctx.workspace === 'game-design-systems' && explicitProjectId) return explicitProjectId;
  return requireProjectContext(ctx);
}

async function readAgentMapConversation(
  ctx: ToolContext,
  projectId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await ctx.supabase.rpc('read_agent_map_conversation_v1', {
    p_project_id: projectId,
    p_agent_conversation_id: ctx.conversationId,
  });
  if (error) throw error;
  if (data == null) return null;
  if (typeof data !== 'object' || Array.isArray(data) || typeof (data as { id?: unknown }).id !== 'string') {
    throw new Error('Invalid map conversation response');
  }
  return { id: (data as { id: string }).id };
}

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
  async prepareConfirmation(params, ctx) {
    if (!ctx.projectId && ctx.workspace !== 'game-design-systems') requireProjectContext(ctx);
    try {
      const input = paramsSchema.parse(params);
      const projectId = resolveDraftProjectId(ctx, input.projectId);
      if (input.projectId && input.projectId !== projectId) {
        return { success: false, error: 'Map project does not match the selected project.' };
      }
      return {
        success: true,
        args: {
          ...input,
          basePlanNodeId: agentMapWorkspaces.has(ctx.workspace)
            ? ctx.mapBasePlanNodeId ?? null
            : null,
        },
      };
    } catch (error) {
      return mapToolError(error);
    }
  },
  async execute(params, ctx) {
    if (!ctx.projectId && ctx.workspace !== 'game-design-systems') requireProjectContext(ctx);
    try {
      const input = sealedParamsSchema.parse(params) as Required<z.infer<typeof sealedParamsSchema>>;
      const projectId = resolveDraftProjectId(ctx, input.projectId);
      if (input.projectId && input.projectId !== projectId) return { success: false, error: 'Map project does not match the selected project.' };
      const persistInAgentConversation = agentMapWorkspaces.has(ctx.workspace);
      if (persistInAgentConversation) {
        const currentConversation = await readAgentMapConversation(ctx, projectId);
        if (currentConversation && !input.basePlanNodeId) {
          return { success: false, error: 'Select a base Plan from this conversation before creating a map revision.' };
        }
      }
      const map = await (await mapService(ctx)).createDraft({ ...input, projectId });
      let version: {
        conversationId: string;
        planNodeId: string;
        planVersionId: string;
        planDisplayVersion: number;
      } | null = null;
      if (persistInAgentConversation) {
        const { data, error } = await ctx.supabase.rpc('attach_map_conversation_plan_to_agent_v1', {
          p_project_id: projectId,
          p_agent_conversation_id: ctx.conversationId,
          p_parent_plan_node_id: input.basePlanNodeId,
          p_title: map.plan.name,
          p_message: input.description,
          p_idempotency_key: input.idempotencyKey,
          p_intent_hash: mapConversationIntentHash({
            projectId,
            agentConversationId: ctx.conversationId,
            basePlanNodeId: input.basePlanNodeId,
            mapId: map.mapId,
            revisionId: map.revisionId,
            idempotencyKey: input.idempotencyKey,
          }),
          p_map_id: map.mapId,
          p_draft_revision_id: map.revisionId,
          p_expected_save_version: map.saveVersion,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row || typeof row !== 'object') throw new Error('Invalid map conversation response');
        const value = row as Record<string, unknown>;
        if (
          typeof value.conversation_id !== 'string' ||
          typeof value.plan_node_id !== 'string' ||
          typeof value.plan_version_id !== 'string' ||
          typeof value.plan_display_version !== 'number'
        ) throw new Error('Invalid map conversation response');
        version = {
          conversationId: value.conversation_id,
          planNodeId: value.plan_node_id,
          planVersionId: value.plan_version_id,
          planDisplayVersion: value.plan_display_version,
        };
      }
      return mapResult({
        kind: 'map', projectId, mapId: map.mapId, revisionId: map.revisionId,
        revisionNumber: map.revisionNumber, saveVersion: map.saveVersion, plan: boundedPlan(map.plan),
        ...(version ?? {}),
      }, projectId, map.mapId);
    } catch (error) { return mapToolError(error); }
  },
};
