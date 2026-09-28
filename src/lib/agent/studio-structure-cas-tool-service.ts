import type { ToolContext } from './types';

export type StructureAction = 'update_folder' | 'move_folder' | 'update_library_metadata' | 'move_library';

export async function applyStudioStructureChange(ctx: ToolContext, input: {
  action: StructureAction;
  targetId: string;
  expectedUpdatedAt: string;
  destinationId?: string | null;
  name?: string;
  description?: string | null;
}) {
  if (!ctx.projectId || !ctx.userId) throw new Error('Project context is unavailable.');
  const { data, error } = await ctx.supabase.rpc('agent_change_studio_structure_if_current', {
    p_project_id: ctx.projectId,
    p_action: input.action,
    p_target_id: input.targetId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_destination_id: input.destinationId ?? null,
    p_name: input.name ?? null,
    p_description: input.description ?? null,
  });
  if (error) {
    if (error.code === 'PT409') throw new Error('Target changed after approval; preview the action again.');
    throw error;
  }
  if (!data) throw new Error('Target changed after approval; preview the action again.');
  return data as { id: string; name: string; updatedAt: string };
}
