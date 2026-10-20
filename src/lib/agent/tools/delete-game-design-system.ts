import type { AgentTool } from '../types';

export const deleteGameDesignSystemTool: AgentTool = {
  name: 'delete_game_design_system',
  description: 'Permanently delete an exact owned Game Design System after confirmation. The system must have no project bindings, and deletion rejects changes made after approval.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' },
  }, required: ['designSystemId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareDeletion, preparationFailure } = await import('../gds-lifecycle-tool-service');
    try {
      const prepared = await prepareDeletion(ctx, params);
      return { success: true, ...prepared };
    } catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { deleteSystem } = await import('../gds-lifecycle-tool-service');
    return deleteSystem(ctx, params);
  },
};
