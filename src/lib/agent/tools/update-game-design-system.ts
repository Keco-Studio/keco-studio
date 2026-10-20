import type { AgentTool } from '../types';

export const updateGameDesignSystemTool: AgentTool = {
  name: 'update_game_design_system',
  description: 'Edit title, summary, or draft/published status of an exact owned Game Design System. Always confirms the existing system and rejects changes made after approval.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: ['string', 'null'], maxLength: 1000 },
    status: { type: 'string', enum: ['draft', 'published'] },
  }, required: ['designSystemId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareMetadata, preparationFailure } = await import('../gds-lifecycle-tool-service');
    try {
      const prepared = await prepareMetadata(ctx, params);
      return { success: true, ...prepared };
    } catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { updateMetadata } = await import('../gds-lifecycle-tool-service');
    return updateMetadata(ctx, params);
  },
};
