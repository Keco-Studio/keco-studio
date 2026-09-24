import type { AgentTool } from '../types';

export const applyGameDesignSystemTool: AgentTool = {
  name: 'apply_game_design_system',
  description: 'Pin an exact Game Design System version to an explicit project ID from list_projects. Requires target project owner or admin. Cannot delete or unbind.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'admin', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, designSystemId: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' },
  }, required: ['projectId', 'designSystemId', 'versionId'] },
  async execute(params, ctx) {
    const { designToolResult, applyDesignSystem } = await import('../game-design-system-tool-service');
    return designToolResult(() => applyDesignSystem(ctx, params));
  },
};
