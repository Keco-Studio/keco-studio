/**
 * create_library — create a new (empty) library/table in the project.
 *
 * Optionally places the library inside a folder (resolved by name). Use
 * setup_library instead when the library should be created together with its
 * fields in one step.
 */

import { z } from 'zod';
import {
  createLibraryServer,
  findFolderByName,
  listProjectLibraries,
} from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  name: z.string().min(1),
  folderName: z.string().min(1).optional(),
  description: z.string().optional(),
});

const norm = (s: string) => s.trim().toLowerCase();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { name, folderName, description } = parsed.data;

  try {
    let folderId: string | undefined;
    let resolvedFolderName: string | undefined;
    if (folderName) {
      const { folder, available } = await findFolderByName(
        ctx.supabase,
        ctx.projectId,
        folderName,
        ctx
      );
      if (!folder) {
        return {
          success: false,
          error: `Folder "${folderName}" not found. Available folders: ${available.join(', ') || '(none)'}`,
        };
      }
      folderId = folder.id;
      resolvedFolderName = folder.name;
    }

    const existing = await listProjectLibraries(ctx.supabase, ctx.projectId, ctx);
    if (existing.some((lib) => norm(lib.name) === norm(name))) {
      return { success: false, error: `Library "${name.trim()}" already exists in this project.` };
    }

    const libraryId = await createLibraryServer(
      ctx.supabase,
      ctx.projectId,
      name,
      folderId,
      description
    );

    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId,
        libraryName: name.trim(),
        folderName: resolvedFolderName,
      },
      invalidations: [{ type: 'library', id: libraryId }],
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to create library.' };
  }
}

export const createLibrary: AgentTool = {
  name: 'create_library',
  description:
    'Create a new empty library (table) in the project. Optionally place it in a folder by name (folderName). Use setup_library instead when you also need to create the fields/columns. Params: name (required), folderName (optional), description (optional).',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Library (table) name' },
      folderName: {
        type: 'string',
        description:
          'Folder name to place the library in. Omit to leave it at project root.',
      },
      description: { type: 'string', description: 'Optional library description' },
    },
    required: ['name'],
  },
  execute,
};
