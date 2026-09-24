import type { AgentTool } from '../types';

export const getGenerationStatusTool: AgentTool = {
  name: 'get_generation_status',
  description: 'Read one owned Game Design System or GDD job status once. No polling or worker execution. GDD status also requires current target project editor/admin access.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    jobType: { type: 'string', enum: ['game-design-system', 'gdd'] }, jobId: { type: 'string', format: 'uuid' },
  }, required: ['jobType', 'jobId'] },
  async execute(params, ctx) {
    const { designToolResult, generationStatus } = await import('../game-design-system-tool-service');
    return designToolResult(() => generationStatus(ctx, params));
  },
};
