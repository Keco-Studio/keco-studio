import type { AgentTool } from '../types';

export const generateGddTool: AgentTool = {
  name: 'generate_gdd',
  description: 'Enqueue a GDD for an explicit project ID using its currently pinned Game Design System version. Requires target editor/admin and always confirms, including Auto. Professional mode may automatically submit up to three paid map images. Returns immediately; use get_generation_status for a later status check.',
  category: 'write', permissionScope: 'explicit-project', requiredPermission: 'editor',
  confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    projectId: { type: 'string', format: 'uuid' }, mode: { type: 'string', enum: ['quick', 'professional'] },
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
  }, required: ['projectId', 'mode', 'idempotencyKey'] },
  async prepareConfirmation(params, ctx) {
    const { designToolResult, prepareGdd } = await import('../game-design-system-tool-service');
    const result = await designToolResult(() => prepareGdd(ctx, params));
    if (!result.success) return { success: false, error: result.error! };
    return { success: true, args: result.data, preview: result.data };
  },
  async execute(params, ctx) {
    const { designToolResult, generateGdd } = await import('../game-design-system-tool-service');
    return designToolResult(() => generateGdd(ctx, params));
  },
};
