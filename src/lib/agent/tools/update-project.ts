import { z } from 'zod';
import { getProject, updateProject } from '@/lib/services/projectService';
import { verifyProjectUpdatePermission } from '@/lib/services/authorizationService';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict().refine((value) => value.name !== undefined || value.description !== undefined);

function projectUpdateError(error: unknown, fallback: string): string {
  const message = error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' ? error.message : '';
  if (message === 'Only admin users can update projects'
    || message === 'Project name is required.'
    || message === 'Project changed after approval; review it again.') return message;
  if (/^Project name .+ already exists$/.test(message)) return 'Project name already exists.';
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'PT409') return 'Project changed after approval; review it again.';
  if (code === '42501') return 'You do not have permission to update this project.';
  return fallback;
}

async function prepareConfirmation(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid update_project parameters.' };
  try {
    await verifyProjectUpdatePermission(ctx.supabase, parsed.data.projectId, ctx.userId);
    const project = await getProject(ctx.supabase, parsed.data.projectId);
    if (!project) return { success: false, error: 'PROJECT_NOT_FOUND' };
    return {
      success: true,
      args: { ...parsed.data, name: parsed.data.name ?? project.name, expectedUpdatedAt: project.updated_at },
      preview: {
        projectId: project.id,
        currentName: project.name,
        name: parsed.data.name ?? project.name,
        description: parsed.data.description === undefined ? project.description : parsed.data.description,
      },
    };
  } catch (error) {
    return { success: false, error: projectUpdateError(error, 'Failed to preview project update.') };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid update_project parameters.' };
  try {
    const { projectId, description, expectedUpdatedAt } = parsed.data;
    if (!expectedUpdatedAt) return { success: false, error: 'Project update confirmation data is unavailable; please retry.' };
    await verifyProjectUpdatePermission(ctx.supabase, projectId, ctx.userId);
    const project = await getProject(ctx.supabase, projectId);
    if (!project) return { success: false, error: 'PROJECT_NOT_FOUND' };
    if (project.updated_at !== expectedUpdatedAt) {
      return { success: false, error: 'Project changed after approval; review it again.' };
    }
    const name = parsed.data.name ?? project.name;
    const nextDescription = description === undefined ? project.description : description;
    if (project.name !== name || project.description !== (nextDescription || null)) {
      await updateProject(ctx.supabase, projectId, { name, description: nextDescription ?? '', expectedUpdatedAt });
    }
    const updated = await getProject(ctx.supabase, projectId);
    if (!updated) return { success: false, error: 'PROJECT_NOT_FOUND' };
    return {
      success: true,
      displayHint: 'text',
      data: { projectId, name: updated.name, description: updated.description, updatedAt: updated.updated_at },
      invalidations: [{ type: 'projects', projectId }],
    };
  } catch (error) {
    return { success: false, error: projectUpdateError(error, 'Failed to update project.') };
  }
}

export const updateProjectTool: AgentTool = {
  name: 'update_project',
  description: 'Update the name or description of an explicit project ID. Requires project owner or admin.',
  category: 'write',
  permissionScope: 'explicit-project',
  requiredPermission: 'admin',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'always',
  prepareConfirmation,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      projectId: { type: 'string', format: 'uuid' },
      name: { type: 'string', minLength: 1, maxLength: 120 },
      description: { type: ['string', 'null'], maxLength: 1000 },
    },
    required: ['projectId'],
  },
  execute,
};
