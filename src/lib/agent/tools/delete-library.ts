/**
 * delete_library — delete a library and its cascaded fields/assets/values.
 *
 * Requires the admin role (matches verifyLibraryDeletionPermission).
 */

import { requireProjectContext } from '../workspace';
import { z } from 'zod';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
}).strict();
const SealedSchema = z.object({
  projectId: z.string().uuid(), libraryId: z.string().uuid(), name: z.string(),
  updatedAt: z.string(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

async function prepareConfirmation(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  const libraryResult = await resolveLibraryForTool(
    ctx.supabase,
    requireProjectContext(ctx),
    parsed.data.libraryName,
    ctx
  );
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  try {
    const { data, error } = await ctx.supabase.rpc('agent_prepare_library_delete', {
      p_project_id: requireProjectContext(ctx), p_library_id: library.id,
    });
    if (error) throw error;
    const snapshot = SealedSchema.parse(data);
    return {
      success: true,
      args: snapshot,
      preview: { action: 'delete_library', projectId: snapshot.projectId,
        libraryId: snapshot.libraryId, libraryName: snapshot.name,
        updatedAt: snapshot.updatedAt, fingerprint: snapshot.fingerprint,
        consequence: 'Permanently delete this library and all fields, assets and values.' },
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to preview library deletion.' };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = SealedSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Delete confirmation data is unavailable; please retry.' };
  const input = parsed.data;
  if (input.projectId !== requireProjectContext(ctx)) {
    return { success: false, error: 'Library is outside this conversation.' };
  }
  try {
    const { data, error } = await ctx.supabase.rpc('agent_delete_library_if_current', {
      p_project_id: input.projectId, p_library_id: input.libraryId,
      p_expected_name: input.name, p_expected_updated_at: input.updatedAt,
      p_expected_fingerprint: input.fingerprint,
    });
    if (error) throw error;
    if (data !== input.libraryId) throw new Error('Library changed after approval; review the deletion again.');
    return { success: true, displayHint: 'text',
      data: { libraryName: input.name, libraryId: input.libraryId },
      invalidations: [{ type: 'library', id: input.libraryId }] };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to delete library.' };
  }
}

export const deleteLibrary: AgentTool = {
  name: 'delete_library',
  description:
    'Delete a library (table) and all of its fields, assets and values. This is irreversible and requires the admin role. Params: libraryName (required).',
  category: 'write',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'always',
  requiredPermission: 'admin',
  prepareConfirmation,
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'Name of the library to delete' },
    },
    required: ['libraryName'],
  },
  execute,
};
