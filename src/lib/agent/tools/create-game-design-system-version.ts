import type { AgentTool } from '../types';

export const createGameDesignSystemVersionTool: AgentTool = {
  name: 'create_game_design_system_version',
  description: 'Create a new current version of an owned Game Design System with an exact parent and expected current version. Replacing the current version always confirms.',
  category: 'write', permissionScope: 'account', confirmationMode: 'pre_execute', confirmationPolicy: 'always',
  parameters: { type: 'object', additionalProperties: false, properties: {
    designSystemId: { type: 'string', format: 'uuid' }, idempotencyKey: { type: 'string', format: 'uuid' },
    request: { type: 'object', additionalProperties: false,
      properties: { parentVersionId: { type: 'string', format: 'uuid' }, expectedCurrentVersionId: { type: 'string', format: 'uuid' },
        document: { type: 'object' }, rules: { type: 'object' }, artStyle: { type: ['object', 'null'] } },
      required: ['parentVersionId', 'expectedCurrentVersionId'] },
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
