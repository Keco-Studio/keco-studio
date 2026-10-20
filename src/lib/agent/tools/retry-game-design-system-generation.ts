import type { AgentTool } from '../types';

export const retryGameDesignSystemGenerationTool: AgentTool = {
  name: 'retry_game_design_system_generation',
  description: 'Retry an exact failed owned Game Design System generation job with an idempotency key. Generation can incur provider charges.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    jobId: { type: 'string', format: 'uuid' }, idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
  }, required: ['jobId', 'idempotencyKey'] },
  async prepareConfirmation(params, ctx) {
    const { prepareSystemRetry, preparationFailure } = await import('../gds-remaining-tool-service');
    try { return { success: true, ...await prepareSystemRetry(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { retrySystemGeneration } = await import('../gds-remaining-tool-service');
    return retrySystemGeneration(ctx, params);
  },
};
