import { after } from 'next/server';
import { z } from 'zod';
import { verifyProjectDeletionPermission } from '@/lib/services/authorizationService';
import type { AgentTool, ConfirmationPreparation, ToolContext, ToolResult } from '../types';

const paramsSchema = z.object({
  projectId: z.string().uuid(),
  expectedName: z.string().optional(),
  expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).strict();

const snapshotSchema = z.object({
  projectId: z.string().uuid(), name: z.string(), updatedAt: z.string(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.number().int().nonnegative(),
  tableCounts: z.record(z.string(), z.number().int().nonnegative()),
});

function projectDeleteError(error: unknown, fallback: string): string {
  const message = error && typeof error === 'object' && 'message' in error
    && typeof error.message === 'string' ? error.message : '';
  if (message === 'Only admin users can delete projects') return message;
  if (message === 'Project contents changed after approval'
    || message === 'Project changed after approval') {
    return 'Project contents changed after approval; review it again.';
  }
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'PT409') return 'Project contents changed after approval; review it again.';
  if (code === '42501') return 'You do not have permission to delete this project.';
  return fallback;
}

async function prepareConfirmation(params: unknown, ctx: ToolContext): Promise<ConfirmationPreparation> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) return { success: false, error: 'Invalid delete_project parameters.' };
  try {
    await verifyProjectDeletionPermission(ctx.supabase, parsed.data.projectId, ctx.userId);
    const { data, error } = await ctx.supabase.rpc('agent_prepare_project_cascade_delete', {
      p_project_id: parsed.data.projectId,
    });
    if (error) throw error;
    const project = snapshotSchema.parse(data);
    return {
      success: true,
      args: { projectId: project.projectId, expectedName: project.name, expectedFingerprint: project.fingerprint },
      preview: {
        projectId: project.projectId,
        name: project.name,
        updatedAt: project.updatedAt,
        affectedRows: project.rowCount,
        affectedTables: project.tableCounts,
        consequence: 'Permanently delete this project and its contents. Project storage files will be cleaned up.',
      },
    };
  } catch (error) {
    return { success: false, error: projectDeleteError(error, 'Failed to preview project deletion.') };
  }
}

async function execute(params: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success || !parsed.data.expectedName || !parsed.data.expectedFingerprint) {
    return { success: false, error: 'Delete confirmation data is unavailable; please retry.' };
  }
  try {
    const { projectId, expectedName, expectedFingerprint } = parsed.data;
    await verifyProjectDeletionPermission(ctx.supabase, projectId, ctx.userId);
    const { deleteProjectWithServerBoundary, processProjectStorageCleanupJob } = await import('@/lib/server/projectDeletion');
    const deletion = await deleteProjectWithServerBoundary({
      authClient: ctx.supabase, projectId, userId: ctx.userId, expectedDeletionFingerprint: expectedFingerprint,
    });
    if (deletion.cleanupJobIds.length > 0) {
      after(async () => {
        for (const cleanupJobId of deletion.cleanupJobIds) {
          try {
            await processProjectStorageCleanupJob({ cleanupJobId });
          } catch (error) {
            console.error('[agent delete_project] Deferred storage cleanup failed:', error);
          }
        }
      });
    }
    return {
      success: true,
      displayHint: 'text',
      data: { projectId, name: expectedName, deleted: true },
      invalidations: [{ type: 'projects', projectId }],
    };
  } catch (error) {
    return { success: false, error: projectDeleteError(error, 'Failed to delete project.') };
  }
}

export const deleteProjectTool: AgentTool = {
  name: 'delete_project',
  description: 'Permanently delete the explicit project ID and its contents after confirmation. Requires project owner or admin.',
  category: 'write',
  permissionScope: 'explicit-project',
  requiredPermission: 'admin',
  confirmationMode: 'pre_execute',
  confirmationPolicy: 'always',
  prepareConfirmation,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { projectId: { type: 'string', format: 'uuid' } },
    required: ['projectId'],
  },
  execute,
};
