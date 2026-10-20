import type { AgentTool } from '../types';

export const createGameDesignSystemTool: AgentTool = {
  name: 'create_game_design_system',
  description: 'Create an owned draft Game Design System from a complete structured rule set. Supply a UUID idempotencyKey and reuse it for retries of the same request.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', maxLength: 1000 },
    idempotencyKey: { type: 'string', format: 'uuid' },
    rules: { type: 'object', description: 'GameDesignRuleSet: schemaVersion 1, genres, philosophies, suitableFor, rules (each with id, kind, title, statement, appliesWhen, severity), and tableGuidance.',
      required: ['schemaVersion', 'genres', 'philosophies', 'suitableFor', 'rules', 'tableGuidance'] },
  }, required: ['title', 'rules', 'idempotencyKey'] },
  async execute(params, ctx) {
    const { createStructuredSystem } = await import('../gds-remaining-tool-service');
    return createStructuredSystem(ctx, params);
  },
};
