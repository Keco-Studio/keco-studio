import { z } from 'zod';
import { listAccountProjects } from '../project-tool-service';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const schema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).optional(),
}).strict();

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid list_projects parameters.' };
  try {
    return { success: true, displayHint: 'list', data: await listAccountProjects(ctx.supabase, ctx.userId, parsed.data) };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export const listProjectsTool: AgentTool = {
  name: 'list_projects',
  description: 'List projects you have accepted access to, with role and read/write capabilities. Use nextCursor to get another page.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
  },
  execute,
};
