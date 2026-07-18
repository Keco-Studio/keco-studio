/**
 * delete_library — delete a library and its cascaded fields/assets/values.
 *
 * Requires the admin role (matches verifyLibraryDeletionPermission).
 */

import { z } from 'zod';
import { deleteLibraryServer } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
});

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }

  const libraryResult = await resolveLibraryForTool(
    ctx.supabase,
    ctx.projectId,
    parsed.data.libraryName,
    ctx
  );
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  try {
    await deleteLibraryServer(ctx.supabase, library.id);
    return {
      success: true,
      displayHint: 'text',
      data: { libraryName: library.name, libraryId: library.id },
      invalidations: [{ type: 'library', id: library.id }],
    };
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
  requiredPermission: 'admin',
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'Name of the library to delete' },
    },
    required: ['libraryName'],
  },
  execute,
};
