import type { AgentTool } from '../types';

export const reorderScriptDialogueTool: AgentTool = {
  name: 'reorder_script_dialogue',
  description: 'Move an exact dialogue block before or after another block in a derived Script. Atomically updates the source document, Script table, and plot plan. Supply a UUID idempotencyKey; the returned operationId can be undone while current.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, movingBlockId: { type: 'string', format: 'uuid' },
    targetBlockId: { type: 'string', format: 'uuid' }, idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'movingBlockId', 'targetBlockId', 'idempotencyKey'] },
  async prepareConfirmation(params, ctx) {
    const { prepareScriptDialogueAction } = await import('../script-dialogue-mutation-tool-service');
    return prepareScriptDialogueAction('reorder', params, ctx);
  },
  async execute(params, ctx) {
    const { executeScriptDialogueAction } = await import('../script-dialogue-mutation-tool-service');
    return executeScriptDialogueAction('reorder', params, ctx);
  },
};
