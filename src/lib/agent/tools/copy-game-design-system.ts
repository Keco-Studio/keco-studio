import type { AgentTool } from '../types';

export const copyGameDesignSystemTool: AgentTool = {
  name: 'copy_game_design_system',
  description: 'Copy an official or owned Game Design System into a new account draft. Each confirmed call creates a separate copy.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' },
  }, required: ['designSystemId'] },
  async execute(params, ctx) {
    const { designToolResult, copyDesignSystem } = await import('../game-design-system-tool-service');
    return designToolResult(() => copyDesignSystem(ctx, params));
  },
};
