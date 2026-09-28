import type { AgentTool } from '../types';

export const copyGameDesignSystemTool: AgentTool = {
  name: 'copy_game_design_system',
  description: 'Copy an official or owned Game Design System into a new account draft. Supply a UUID idempotencyKey and reuse it for retries of the same copy request; use a new key for another copy.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['designSystemId', 'idempotencyKey'] },
  async execute(params, ctx) {
    const { designToolResult, copyDesignSystem } = await import('../game-design-system-tool-service');
    const result = await designToolResult(() => copyDesignSystem(ctx, params));
    return result.success
      ? { ...result, invalidations: [{ type: 'game-design-systems' as const }] }
      : result;
  },
};
