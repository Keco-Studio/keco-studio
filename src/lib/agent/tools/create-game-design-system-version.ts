import type { AgentTool } from '../types';
import { gameDesignSystemVersionRequestToolSchema } from './game-design-system-version-schema';

export const createGameDesignSystemVersionTool: AgentTool = {
  name: 'create_game_design_system_version',
  description: 'Create a new current version of an owned Game Design System with an exact parent and expected current version. Read the current system first. The request fields are complete replacements: include every required document field or every rule-set field you replace, and omit unchanged components. Use anti_pattern (snake_case) for anti-pattern rules and tableGuidance entries with table/purpose/fields. Replacing the current version always confirms.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' }, idempotencyKey: { type: 'string', format: 'uuid' },
    request: gameDesignSystemVersionRequestToolSchema,
  }, required: ['designSystemId', 'idempotencyKey', 'request'] },
  async prepareConfirmation(params, ctx) {
    const { prepareVersion, preparationFailure } = await import('../gds-remaining-tool-service');
    try { return { success: true, ...await prepareVersion(ctx, params) }; }
    catch (error) { return preparationFailure(error); }
  },
  async execute(params, ctx) {
    const { createVersion } = await import('../gds-remaining-tool-service');
    return createVersion(ctx, params);
  },
};
