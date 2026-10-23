import type { AgentTool } from '../types';
import { gameRulesKernelToolSchema } from './game-design-system-version-schema';

export const createGameDesignSystemTool: AgentTool = {
  name: 'create_game_design_system',
  description: 'Create an owned draft Game Design System from a complete schemaVersion 2 Game Rules Kernel. Legacy schemaVersion 1 data is read-only and cannot be used for creation. Supply a UUID idempotencyKey and reuse it for retries of the same request.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute',
  parameters: { type: 'object', additionalProperties: false, properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    summary: { type: 'string', maxLength: 1000 },
    idempotencyKey: { type: 'string', format: 'uuid' },
    rules: gameRulesKernelToolSchema,
  }, required: ['title', 'rules', 'idempotencyKey'] },
  async execute(params, ctx) {
    const { createStructuredSystem } = await import('../gds-remaining-tool-service');
    return createStructuredSystem(ctx, params);
  },
};
