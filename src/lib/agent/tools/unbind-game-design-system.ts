import type { AgentTool } from '../types';

export const unbindGameDesignSystemTool: AgentTool = {
  name: 'unbind_game_design_system',
  description: 'Remove the currently bound Game Design System version from an explicit project. Owner/admin only. Always confirms the exact current binding.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'admin',
  confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' },
  }, required: ['projectId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareUnbind, preparationFailure } = await import('../gds-remaining-tool-service');
    try { return { success: true, ...await prepareUnbind(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { unbindSystem } = await import('../gds-remaining-tool-service');
    return unbindSystem(ctx, params);
  },
};
