import { z } from 'zod';
import { requireProjectContext } from '../workspace';
import { scheduleLibrarySchemaReindex } from '../embedding-index';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const paramsSchema = z.object({
  libraryId: z.string().uuid(),
  fieldIds: z.array(z.string().uuid()).min(1).max(200),
  expectedUpdatedAt: z.string().optional(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

type Field = { fieldId: string; section: string; sectionId: string };
type Snapshot = { name: string; updatedAt: string; fingerprint: string; fields: Field[] };

function validSelection(fieldIds: string[], fields: Field[]) {
  const ids = new Set(fields.map((field) => field.fieldId));
  return fieldIds.length === ids.size && new Set(fieldIds).size === fieldIds.length &&
    fieldIds.every((fieldId) => ids.has(fieldId));
}

async function snapshot(ctx: ToolContext, libraryId: string): Promise<Snapshot> {
  const { data, error } = await ctx.supabase.rpc('agent_prepare_library_reorder', {
    p_project_id: requireProjectContext(ctx), p_library_id: libraryId,
  });
  if (error || !data || !Array.isArray(data.fields) || !data.updatedAt ||
    !/^[a-f0-9]{64}$/.test(data.fingerprint)) {
    throw new Error('Library schema could not be read. Check the library and edit permission.');
  }
  return data as Snapshot;
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success || !parsed.data.expectedUpdatedAt || !parsed.data.expectedFingerprint) {
    return { success: false, error: 'Library reorder confirmation data is unavailable.' };
  }
  const { libraryId, fieldIds, expectedUpdatedAt, expectedFingerprint } = parsed.data;
  const projectId = requireProjectContext(ctx);
  try {
    const state = await snapshot(ctx, libraryId);
    if (state.updatedAt !== expectedUpdatedAt || state.fingerprint !== expectedFingerprint) {
      return { success: false, error: 'Library fields changed after approval. Read the schema again.' };
    }
    if (!validSelection(fieldIds, state.fields)) {
      return { success: false, error: 'Reorder requires every current field ID exactly once. Read the library schema again.' };
    }
    const byId = new Map(state.fields.map((field) => [field.fieldId, field]));
    const fields = fieldIds.map((fieldId) => byId.get(fieldId)!);
    const { data, error } = await ctx.supabase.rpc('agent_reorder_library_fields_if_current', {
      p_project_id: projectId, p_library_id: libraryId, p_fields: fields,
      p_expected_updated_at: expectedUpdatedAt, p_expected_fingerprint: expectedFingerprint,
    });
    if (error) return { success: false, error: error.code === 'PT409'
      ? 'Library fields changed after approval. Read the schema again.'
      : 'Library reorder failed. Read the schema again and check edit permission.' };
    scheduleLibrarySchemaReindex(ctx.supabase, { projectId, libraryId });
    return { success: true, schemaChanged: true, displayHint: 'text',
      data: { libraryId, projectId, fieldIds, reorderedCount: fieldIds.length, updatedAt: data.updatedAt },
      invalidations: [{ type: 'library', id: libraryId, projectId }] };
  } catch {
    return { success: false, error: 'Library reorder failed. Read the schema again and check edit permission.' };
  }
}

export const reorderLibraryFieldsTool: AgentTool = {
  name: 'reorder_library_fields',
  description: 'Reorder every field of one library using stable IDs in the desired order. Include every current field exactly once. Field values are preserved.',
  category: 'write', requiredPermission: 'editor', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' },
    fieldIds: { type: 'array', items: { type: 'string', format: 'uuid' }, minItems: 1, maxItems: 200 },
  }, required: ['libraryId', 'fieldIds'] },
  async prepareConfirmation(params, ctx) {
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) return { success: false, error: 'Invalid library reorder parameters.' };
    try {
      const state = await snapshot(ctx, parsed.data.libraryId);
      if (!validSelection(parsed.data.fieldIds, state.fields)) {
        return { success: false, error: 'Reorder requires every current field ID exactly once. Read the library schema again.' };
      }
      return { success: true,
        args: { libraryId: parsed.data.libraryId, fieldIds: parsed.data.fieldIds,
          expectedUpdatedAt: state.updatedAt, expectedFingerprint: state.fingerprint },
        preview: { libraryId: parsed.data.libraryId, libraryName: state.name,
          currentFieldIds: state.fields.map((field) => field.fieldId), fieldIds: parsed.data.fieldIds } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Library schema could not be read.' };
    }
  },
  execute,
};
