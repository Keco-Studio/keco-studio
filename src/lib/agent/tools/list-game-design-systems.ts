import type { AgentTool } from '../types';

export const listGameDesignSystemsTool: AgentTool = {
  name: 'list_game_design_systems',
  description: 'List visible Game Design Systems with bounded summaries. Default 20, maximum 50. Pass nextOffset to continue.',
  category: 'read', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    limit: { type: 'integer', minimum: 1, maximum: 50 }, offset: { type: 'integer', minimum: 0, maximum: 100000 },
  } },
  async execute(params, ctx) {
    const { designToolResult, listDesignSystems } = await import('../game-design-system-tool-service');
    return designToolResult(() => listDesignSystems(ctx, params), 'list');
  },
};
