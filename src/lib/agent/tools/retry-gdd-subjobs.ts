import type { AgentTool } from '../types';

const projectId = { type: 'string', format: 'uuid' };
const gddJobId = { type: 'string', format: 'uuid' };

export const retryGddResourceJobTool: AgentTool = {
  name: 'retry_gdd_resource_job',
  description: 'Retry one failed GDD resource job in an explicit project. Map resources require acknowledgeDuplicateBilling=true. Always requests approval because generation may incur provider charges.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'editor',
  confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId, gddJobId, resourceJobId: { type: 'string', format: 'uuid' },
    acknowledgeDuplicateBilling: { type: 'boolean', description: 'Must be true for a paid map resource retry.' },
  }, required: ['projectId', 'gddJobId', 'resourceJobId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareResourceRetry, preparationFailure } = await import('../gdd-subjob-retry-tool-service');
    try { return { success: true, ...await prepareResourceRetry(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { retryResource } = await import('../gdd-subjob-retry-tool-service');
    return retryResource(ctx, params);
  },
};

export const retryGddDialogueJobTool: AgentTool = {
  name: 'retry_gdd_dialogue_job',
  description: 'Retry one failed GDD dialogue job in an explicit project. Always requests approval because generation may incur provider charges.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'editor',
  confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId, gddJobId, dialogueJobId: { type: 'string', format: 'uuid' },
  }, required: ['projectId', 'gddJobId', 'dialogueJobId'] },
  async prepareConfirmation(params, ctx) {
    const { prepareDialogueRetry, preparationFailure } = await import('../gdd-subjob-retry-tool-service');
    try { return { success: true, ...await prepareDialogueRetry(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { retryDialogue } = await import('../gdd-subjob-retry-tool-service');
    return retryDialogue(ctx, params);
  },
};
