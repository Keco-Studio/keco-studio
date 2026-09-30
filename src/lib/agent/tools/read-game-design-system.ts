import type { AgentTool } from '../types';

export const readGameDesignSystemTool: AgentTool = {
  name: 'read_game_design_system',
  description: 'Read a visible Game Design System and optionally an exact version. Returns up to 20 version summaries and a bounded, source-redacted selected version.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' },
  }, required: ['designSystemId'] },
  async execute(params, ctx) {
    const { designToolResult, readDesignSystem } = await import('../game-design-system-tool-service');
    return designToolResult(() => readDesignSystem(ctx, params));
  },
};
