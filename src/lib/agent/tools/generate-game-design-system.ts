import type { AgentTool } from '../types';
import { z } from 'zod';

const GENERATION_WARNING = 'Generate a Game Design System using paid AI credits.';

export const generateGameDesignSystemTool: AgentTool = {
  name: 'generate_game_design_system',
  description: 'Enqueue account Game Design System generation and return its durable job ID immediately. Reuse idempotencyKey for the same request. Supply a valid published art style preset and at least one design input. Never wait or poll inside this operation.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
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
  async prepareConfirmation(params, ctx) {
    try {
      if (!ctx.userId) return { success: false, error: 'Authentication required.' };
      const { generateSystemSchema } = await import('../game-design-system-tool-service');
      const input = generateSystemSchema.parse(params);
      return { success: true, args: { ...input, confirmedGeneration: true },
        preview: { action: 'generate_game_design_system', title: input.input.title,
          idempotencyKey: input.idempotencyKey, warning: GENERATION_WARNING } };
    } catch { return { success: false, error: 'Invalid Game Design System generation request.' }; }
  },
  async execute(params, ctx) {
    const { designToolResult, generateDesignSystem } = await import('../game-design-system-tool-service');
    const sealed = z.object({ confirmedGeneration: z.literal(true) }).passthrough().safeParse(params);
    if (!sealed.success) return { success: false, error: 'Generation approval is required.' };
    const { confirmedGeneration: _confirmedGeneration, ...input } = sealed.data;
    return designToolResult(() => generateDesignSystem(ctx, input));
  },
};
