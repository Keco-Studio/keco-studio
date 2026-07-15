/**
 * create_folder — create a new folder in the project.
 */

import { z } from 'zod';
import { createFolderServer, listProjectFolders } from '../data-access';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const norm = (s: string) => s.trim().toLowerCase();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { name, description } = parsed.data;

  try {
    const existing = await listProjectFolders(ctx.supabase, ctx.projectId, ctx);
    if (existing.some((folder) => norm(folder.name) === norm(name))) {
      return { success: false, error: `Folder "${name.trim()}" already exists in this project.` };
    }

    const folderId = await createFolderServer(ctx.supabase, ctx.projectId, name, description);

    return {
      success: true,
      displayHint: 'text',
      data: { folderId, folderName: name.trim() },
    };
  } catch (e) {
    return { success: false, error: (e as Error).message || 'Failed to create folder.' };
  }
}

export const createFolder: AgentTool = {
  name: 'create_folder',
  description:
    'Create a new folder in the project. Folders group libraries. Params: name (required), description (optional).',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Folder name' },
      description: { type: 'string', description: 'Optional folder description' },
    },
    required: ['name'],
  },
  execute,
};
