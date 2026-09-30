import type { AgentTool } from '../types';

type Action = 'insert' | 'delete' | 'undo';

function prepare(action: Action): NonNullable<AgentTool['prepareConfirmation']> {
  return async (params, ctx) => {
    const { prepareScriptDialogueAction } = await import('../script-dialogue-mutation-tool-service');
    return prepareScriptDialogueAction(action, params, ctx);
  };
}

function execute(action: Action): AgentTool['execute'] {
  return async (params, ctx) => {
    const { executeScriptDialogueAction } = await import('../script-dialogue-mutation-tool-service');
    return executeScriptDialogueAction(action, params, ctx);
  };
}

export const insertScriptDialogueTool: AgentTool = {
  name: 'insert_script_dialogue',
  description: 'Insert a complete dialogue block after an exact Script block, or append when no block ID is given. Supply a UUID idempotencyKey and reuse it for retries.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, afterBlockId: { type: 'string', format: 'uuid' },
    speaker: { type: 'string', minLength: 1, maxLength: 64 },
    actionText: { type: 'string', maxLength: 10000 }, dialogue: { type: 'string', minLength: 1, maxLength: 20000 },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'speaker', 'actionText', 'dialogue', 'idempotencyKey'] },
  prepareConfirmation: prepare('insert'), execute: execute('insert'),
};

export const deleteScriptDialogueBlockTool: AgentTool = {
  name: 'delete_script_dialogue_block',
  description: 'Delete one exact, complete Script dialogue block after confirmation, updating the source Document, Script rows, and plot plan atomically.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, blockId: { type: 'string', format: 'uuid' },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'blockId', 'idempotencyKey'] },
  prepareConfirmation: prepare('delete'), execute: execute('delete'),
};

export const undoScriptDialogueActionTool: AgentTool = {
  name: 'undo_script_dialogue_action',
  description: 'Undo the immediately preceding AI Script dialogue insertion, deletion, edit, speaker change, or reorder by operation ID, if nothing has changed since it completed.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, operationId: { type: 'string', format: 'uuid' },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'operationId', 'idempotencyKey'] },
  prepareConfirmation: prepare('undo'), execute: execute('undo'),
};
