import { z } from 'zod';
import { findAccessibleProject } from '../project-tool-service';
import type { AgentTool, ToolContext, ToolResult } from '../types';

const schema = z.object({
  projectId: z.string().uuid().optional(),
  projectName: z.string().trim().min(1).max(120).optional(),
}).strict().refine((value) => Boolean(value.projectId) !== Boolean(value.projectName));

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Provide exactly one projectId or projectName.' };
  try {
    const found = await findAccessibleProject(ctx.supabase, ctx.userId, parsed.data);
    if (found.candidates) {
      return { success: false, error: 'PROJECT_NAME_AMBIGUOUS', data: { candidates: found.candidates } };
    }
    if (!found.project) return { success: false, error: 'PROJECT_NOT_FOUND' };
    return {
      success: true,
      displayHint: 'text',
      data: { project: found.project },
      navigation: { kind: 'project', projectId: found.project.id },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export const selectProjectTool: AgentTool = {
  name: 'select_project',
  description: 'Open one accessible project by exact ID or unique case-insensitive name. Resolve ambiguous names with project IDs.',
  category: 'read',
  confirmationMode: 'pre_execute',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { projectId: { type: 'string', format: 'uuid' }, projectName: { type: 'string' } },
  },
  execute,
};
