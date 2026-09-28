/**
 * create_folder — create a new folder in the project.
 */

import { requireProjectContext } from '../workspace';
import { z } from 'zod';
import { createFolderServer, listProjectFolders } from '../data-access';
import { replayStudioCreate, studioCreateInputHash } from '../studio-create-idempotency-service';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const ParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  idempotencyKey: z.string().uuid(),
});

const norm = (s: string) => s.trim().toLowerCase();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: `Invalid parameters: ${parsed.error.message}` };
  }
  const { name, description, idempotencyKey } = parsed.data;

  try {
    const projectId = requireProjectContext(ctx);
    const inputHash = studioCreateInputHash({ name: name.trim(), description: description?.trim() || null });
    const request = { projectId, operation: 'folder' as const, idempotencyKey, inputHash };
    const previousId = await replayStudioCreate(ctx.supabase, request);
    if (previousId) return { success: true, displayHint: 'text',
      data: { folderId: previousId, folderName: name.trim() } };

    const existing = await listProjectFolders(ctx.supabase, projectId, ctx);
    if (existing.some((folder) => norm(folder.name) === norm(name))) {
      return { success: false, error: `Folder "${name.trim()}" already exists in this project.` };
    }

    let folderId: string;
    try {
      folderId = await createFolderServer(ctx.supabase, projectId, name, description,
        { key: idempotencyKey, hash: inputHash });
    } catch (error) {
      const committedId = await replayStudioCreate(ctx.supabase, request);
      if (!committedId) throw error;
      folderId = committedId;
    }

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
    'Create a new folder in the project. Reuse the UUID idempotencyKey for retries of the same request.',
  category: 'write',
  confirmationMode: 'pre_execute',
  requiredPermission: 'editor',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Folder name' },
      description: { type: 'string', description: 'Optional folder description' },
      idempotencyKey: { type: 'string', format: 'uuid' },
    },
    required: ['name', 'idempotencyKey'],
  },
  execute,
};
