import type { AgentTool } from '../types';

export const applyGameDesignSystemTool: AgentTool = {
  name: 'apply_game_design_system',
  description: 'Pin an exact Game Design System version to an explicit project ID from list_projects. Requires target project owner or admin. Cannot delete or unbind.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'admin', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, designSystemId: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' },
  }, required: ['projectId', 'designSystemId', 'versionId'] },
  async prepareConfirmation(params, ctx) {
    const { designToolResult, prepareApplyDesignSystem } = await import('../game-design-system-tool-service');
    const result = await designToolResult(() => prepareApplyDesignSystem(ctx, params));
    if (!result.success) return { success: false, error: result.error! };
    const prepared = result.data as Awaited<ReturnType<typeof prepareApplyDesignSystem>>;
    return { success: true, ...prepared };
  },
  async execute(params, ctx) {
    const { designToolResult, applyDesignSystem } = await import('../game-design-system-tool-service');
    const result = await designToolResult(() => applyDesignSystem(ctx, params));
    if (!result.success) return result;
    const applied = result.data as Awaited<ReturnType<typeof applyDesignSystem>>;
    return { ...result, invalidations: [{ type: 'game-design-systems',
      designSystemId: applied.designSystemId, projectId: applied.projectId }] };
  },
};
