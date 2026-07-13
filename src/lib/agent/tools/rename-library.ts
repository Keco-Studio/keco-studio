/**
 * rename_library — change a library's name.
 */

import { z } from 'zod';
import { listProjectLibraries, renameLibraryServer } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';
import { errorFromLookupResult, libraryFromLookupResult, resolveLibraryForTool } from './_shared';

const ParamsSchema = z.object({
  libraryName: z.string().min(1),
  newName: z.string().min(1),
});

const norm = (s: string) => s.trim().toLowerCase();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { libraryName, newName } = parsed.data;

  const libraryResult = await resolveLibraryForTool(ctx.supabase, ctx.projectId, libraryName, ctx);
  const libraryLookupError = errorFromLookupResult(libraryResult);
  if (libraryLookupError !== undefined) {
    return { success: false, error: libraryLookupError };
  }
  const library = libraryFromLookupResult(libraryResult);

  try {
    const existing = await listProjectLibraries(ctx.supabase, ctx.projectId, ctx);
    const conflict = existing.some(
      (lib) => lib.id !== library.id && norm(lib.name) === norm(newName)
    );
    if (conflict) {
      return { success: false, error: `Library "${newName.trim()}" already exists in this project.` };
    }

    await renameLibraryServer(ctx.supabase, library.id, newName);

    return {
      success: true,
      displayHint: 'text',
      data: { libraryId: library.id, oldName: library.name, newName: newName.trim() },
      invalidateCache: [library.id],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to rename library.' };
  }
}

export const renameLibrary: AgentTool = {
  name: 'rename_library',
  description:
    'Rename an existing library (table). Params: libraryName (current name, required), newName (required).',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      libraryName: { type: 'string', description: 'Current library name' },
      newName: { type: 'string', description: 'New library name' },
    },
    required: ['libraryName', 'newName'],
  },
  execute,
};
