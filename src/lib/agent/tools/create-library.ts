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
  resolveDocumentLibrarySourceDisplay,
} from '../data-access';
import type {
  AgentTool,
  ConfirmationPreparation,
  ToolContext,
  ToolResult,
} from '../types';

const ParamsSchema = z.object({
  name: z.string().min(1),
  folderName: z.string().min(1).optional(),
  description: z.string().optional(),
});

const norm = (s: string) => s.trim().toLowerCase();

async function prepareConfirmation(
  params: unknown,
  ctx: ToolContext
): Promise<ConfirmationPreparation> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  if (!ctx.documentExport) {
    return { success: true, args: parsed.data };
  }

  try {
    const source = await resolveDocumentLibrarySourceDisplay(
      ctx.supabase,
      ctx.projectId,
      ctx.documentExport
    );
    const args = {
      name: parsed.data.name,
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
    };
    return {
      success: true,
      args,
      preview: {
        libraryName: parsed.data.name.trim(),
        folderId: source.folderId,
        folderName: source.folderName,
        sourceDocumentName: source.documentName,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resolve source document.',
    };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { name, folderName, description } = parsed.data;

  try {
    let folderId: string | undefined;
    let resolvedFolderName: string | undefined;
    let sourceDocumentName: string | undefined;
    if (ctx.documentExport) {
      const source = await resolveDocumentLibrarySourceDisplay(
        ctx.supabase,
        ctx.projectId,
        ctx.documentExport
      );
      folderId = source.folderId;
      resolvedFolderName = source.folderName;
      sourceDocumentName = source.documentName;
    } else if (folderName) {
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
      description,
      ctx.documentExport
    );

    return {
      success: true,
      displayHint: 'text',
      data: {
        libraryId,
        libraryName: name.trim(),
        folderName: resolvedFolderName,
        sourceDocumentName,
      },
      invalidations: [{
        type: 'library',
        id: libraryId,
        ...(ctx.documentExport
          ? {
              projectId: ctx.projectId,
              sourceDocumentId: ctx.documentExport.sourceDocumentId,
            }
          : {}),
      }],
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
  prepareConfirmation,
};
