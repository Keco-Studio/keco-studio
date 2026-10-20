import { z } from 'zod';
import { createAccountProject } from '../project-tool-service';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().uuid(),
}).strict();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid create_project parameters.' };
  try {
    const project = await createAccountProject(ctx.supabase, {
      name: parsed.data.name!,
      description: parsed.data.description,
      idempotencyKey: parsed.data.idempotencyKey!,
    });
    return { success: true, displayHint: 'text', data: project };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export const createProjectTool: AgentTool = {
  name: 'create_project',
  description: 'Create a project in your account. Supply a UUID idempotencyKey and reuse it for retries of the same input.',
  category: 'write',
  permissionScope: 'account',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      idempotencyKey: { type: 'string', format: 'uuid' },
    },
    required: ['name', 'idempotencyKey'],
  },
  execute,
};
