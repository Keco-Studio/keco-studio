import type { AgentTool } from '../types';

export const cancelGddGenerationTool: AgentTool = {
  name: 'cancel_gdd_generation',
  description: 'Cancel an exact GDD generation job in an explicit project. Requires current editor/admin access.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'editor',
  confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, jobId: { type: 'string', format: 'uuid' },
  }, required: ['projectId', 'jobId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareGddCancellation, preparationFailure } = await import('../gds-remaining-tool-service');
    try { return { success: true, ...await prepareGddCancellation(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { cancelGdd } = await import('../gds-remaining-tool-service');
    return cancelGdd(ctx, params);
  },
};
