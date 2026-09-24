import type { AgentTool } from '../types';

export const generateGameDesignSystemTool: AgentTool = {
  name: 'generate_game_design_system',
  description: 'Enqueue account Game Design System generation and return its durable job ID immediately. Reuse idempotencyKey for the same request. Supply a valid published art style preset and at least one design input. Never wait or poll inside this operation.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    idempotencyKey: { type: 'string', minLength: 8, maxLength: 128 },
    input: { type: 'object', additionalProperties: false, properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      genres: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
      philosophies: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 120 } },
      description: { type: 'string', maxLength: 4000 }, suitableFor: { type: 'string', maxLength: 500 },
      baseSystemId: { type: 'string', format: 'uuid' }, pastedMarkdown: { type: 'string', maxLength: 20000 },
      references: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', enum: ['document', 'table'] }, projectId: { type: 'string', format: 'uuid' }, resourceId: { type: 'string', format: 'uuid' },
      }, required: ['kind', 'projectId', 'resourceId'] } },
      referenceGames: { type: 'array', maxItems: 10, items: { type: 'object', additionalProperties: false, properties: {
        name: { type: 'string', maxLength: 120 }, reference: { type: 'string', maxLength: 500 }, avoid: { type: 'string', maxLength: 500 },
      }, required: ['name', 'reference', 'avoid'] } },
      artStyle: { type: 'object', additionalProperties: false, properties: {
        presetId: { type: 'string' }, presetVersion: { type: 'integer', minimum: 1 },
        customization: { type: 'object', additionalProperties: false, properties: {
          direction: { type: 'string', maxLength: 2000 }, avoid: { type: 'string', maxLength: 1000 },
          referenceGames: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, properties: {
            name: { type: 'string', maxLength: 120 }, borrow: { type: 'string', maxLength: 500 },
          }, required: ['name', 'borrow'] } },
        }, required: ['referenceGames'] },
      }, required: ['presetId', 'presetVersion', 'customization'] },
    }, required: ['title', 'artStyle'] },
  }, required: ['input', 'idempotencyKey'] },
  async execute(params, ctx) {
    const { designToolResult, generateDesignSystem } = await import('../game-design-system-tool-service');
    return designToolResult(() => generateDesignSystem(ctx, params));
  },
};
