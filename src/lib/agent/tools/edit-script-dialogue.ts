import type { AgentTool } from '../types';

type Action = 'edit' | 'speaker';

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

export const editScriptDialogueTool: AgentTool = {
  name: 'edit_script_dialogue',
  description: 'Edit an exact Script dialogue block and synchronize its source document and derived tables atomically. Supply a UUID idempotencyKey; the returned operationId can be undone while current.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, blockId: { type: 'string', format: 'uuid' },
    actionText: { type: 'string', maxLength: 10000 }, dialogue: { type: 'string', maxLength: 20000 },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'blockId', 'actionText', 'dialogue', 'idempotencyKey'] },
  prepareConfirmation: prepare('edit'), execute: execute('edit'),
};

export const changeScriptDialogueSpeakerTool: AgentTool = {
  name: 'change_script_dialogue_speaker',
  description: 'Change an exact Script dialogue block to an existing character, atomically synchronizing its source document and derived tables. Supply a UUID idempotencyKey; the returned operationId can be undone while current.',
  category: 'write', confirmationMode: 'pre_execute', confirmationPolicy: 'always', requiredPermission: 'editor',
  parameters: { type: 'object', additionalProperties: false, properties: {
    libraryId: { type: 'string', format: 'uuid' }, blockId: { type: 'string', format: 'uuid' },
    speaker: { type: 'string', minLength: 1, maxLength: 64 },
    idempotencyKey: { type: 'string', format: 'uuid' },
  }, required: ['libraryId', 'blockId', 'speaker', 'idempotencyKey'] },
  prepareConfirmation: prepare('speaker'), execute: execute('speaker'),
};
