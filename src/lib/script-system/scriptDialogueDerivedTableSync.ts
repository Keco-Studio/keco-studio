import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  buildScriptDialogueBlocks,
  resolveSpeechTypeForSpeaker,
  sourceTextForDialogueBlock,
  type ScriptDialogueBlock,
} from './scriptDialogueBlocks';
import {
  parseSourceDialogue,
  type ScriptDialogueDocumentCommand,
} from './scriptDialogueDocumentSync';
import { normalizeDialogueSourceText } from './scriptDialogueLineage';

export type DerivedDialogueFieldKeys = {
  typeKey: string;
  nameKey: string;
  contentKey: string;
};

export type DerivedDialogueCommandPlan =
  | {
      type: 'edit';
      block: ScriptDialogueBlock;
      values: { speaker: string; action: string; dialogue: string };
    }
  | {
      type: 'insert';
      afterRowId: string | null;
      insertAtStart?: boolean;
      values: { speaker: string; action: string; dialogue: string };
    }
  | { type: 'delete'; block: ScriptDialogueBlock };

type DerivedDialogueTableOperationFields = {
  libraryId: string;
  typeFieldId: string;
  nameFieldId: string;
  contentFieldId: string;
};

export type DerivedDialogueTableOperation =
  | (DerivedDialogueTableOperationFields & {
      type: 'edit';
      actionRowId: string | null;
      speechRowId: string | null;
      speaker: string;
      action: string;
      dialogue: string;
      speechType: '1' | '2';
    })
  | (DerivedDialogueTableOperationFields & {
      type: 'insert';
      afterRowId: string | null;
      insertAtStart: boolean;
      speaker: string;
      action: string;
      dialogue: string;
      speechType: '1' | '2';
    })
  | (DerivedDialogueTableOperationFields & {
      type: 'delete';
      actionRowId: string | null;
      speechRowId: string | null;
    });

function normalized(value: string | undefined): string {
  return normalizeDialogueSourceText(value ?? '');
}

function uniqueBlock(
  blocks: ScriptDialogueBlock[],
  predicate: (block: ScriptDialogueBlock) => boolean,
): ScriptDialogueBlock | null {
  const matches = blocks.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function lastRowId(block: ScriptDialogueBlock): string | null {
  return block.speechRowId ?? block.actionRowId ?? null;
}

export function planDerivedDialogueCommand(
  rows: AssetRow[],
  fields: DerivedDialogueFieldKeys,
  command: ScriptDialogueDocumentCommand,
): DerivedDialogueCommandPlan | null {
  const blocks = buildScriptDialogueBlocks(rows, fields);

  if (command.type === 'edit' && command.role === 'action') {
    const block = uniqueBlock(blocks, (candidate) => (
      (!command.speaker || normalized(candidate.speaker) === normalized(command.speaker))
      && normalized(candidate.action) === normalized(command.previousText)
      && normalized(candidate.dialogue) === normalized(
        command.previousDialogue ?? command.dialogue,
      )
    ));
    if (!block) return null;
    return {
      type: 'edit',
      block,
      values: {
        speaker: command.speaker?.trim() || block.speaker,
        action: command.nextText,
        dialogue: command.dialogue ?? block.dialogue,
      },
    };
  }

  if (command.type === 'edit' && command.role === 'speech') {
    const previous = parseSourceDialogue(command.previousText);
    const next = parseSourceDialogue(command.nextText);
    if (!previous || !next) return null;
    const block = uniqueBlock(blocks, (candidate) => (
      normalized(candidate.speaker) === normalized(previous.speaker)
      && normalized(candidate.dialogue) === normalized(previous.dialogue)
    ));
    if (!block) return null;
    return {
      type: 'edit',
      block,
      values: {
        speaker: next.speaker,
        action: block.action,
        dialogue: next.dialogue,
      },
    };
  }

  if (command.type === 'insert') {
    const parsed = parseSourceDialogue(command.text);
    if (!parsed) return null;

    let afterRowId: string | null = null;
    let insertAtStart = false;
    if (command.afterText) {
      const anchor = uniqueBlock(
        blocks,
        (candidate) => normalized(sourceTextForDialogueBlock(candidate, 'last'))
          === normalized(command.afterText),
      );
      if (!anchor) return null;
      afterRowId = lastRowId(anchor);
    } else if (command.beforeText) {
      const beforeIndex = blocks.findIndex(
        (candidate) => normalized(sourceTextForDialogueBlock(candidate, 'first'))
          === normalized(command.beforeText),
      );
      if (beforeIndex < 0) return null;
      afterRowId = beforeIndex > 0 ? lastRowId(blocks[beforeIndex - 1]) : null;
      insertAtStart = beforeIndex === 0;
    } else if (blocks.length > 0) {
      afterRowId = lastRowId(blocks[blocks.length - 1]);
    }

    return {
      type: 'insert',
      afterRowId,
      ...(insertAtStart ? { insertAtStart: true } : {}),
      values: {
        speaker: parsed.speaker,
        action: parsed.cue,
        dialogue: parsed.dialogue,
      },
    };
  }

  if (command.type === 'delete') {
    const previousTexts = command.previousTexts.map(normalized).filter(Boolean);
    const block = uniqueBlock(blocks, (candidate) => {
      const candidateTexts = new Set([
        normalized(candidate.action),
        normalized(candidate.dialogue ? `${candidate.speaker}：${candidate.dialogue}` : ''),
      ].filter(Boolean));
      return previousTexts.every((text) => candidateTexts.has(text));
    });
    return block ? { type: 'delete', block } : null;
  }

  return null;
}

export function buildDerivedDialogueTableOperation(
  libraryId: string,
  rows: AssetRow[],
  fields: DerivedDialogueFieldKeys,
  command: ScriptDialogueDocumentCommand,
): DerivedDialogueTableOperation | null {
  const plan = planDerivedDialogueCommand(rows, fields, command);
  if (!plan) return null;

  const operationFields: DerivedDialogueTableOperationFields = {
    libraryId,
    typeFieldId: fields.typeKey,
    nameFieldId: fields.nameKey,
    contentFieldId: fields.contentKey,
  };

  if (plan.type === 'delete') {
    return {
      ...operationFields,
      type: 'delete',
      actionRowId: plan.block.actionRowId ?? null,
      speechRowId: plan.block.speechRowId ?? null,
    };
  }

  const speechType = resolveSpeechTypeForSpeaker(plan.values.speaker, rows, fields);
  if (plan.type === 'insert') {
    return {
      ...operationFields,
      type: 'insert',
      afterRowId: plan.afterRowId,
      insertAtStart: plan.insertAtStart ?? false,
      ...plan.values,
      speechType,
    };
  }

  return {
    ...operationFields,
    type: 'edit',
    actionRowId: plan.block.actionRowId ?? null,
    speechRowId: plan.block.speechRowId ?? null,
    ...plan.values,
    speechType,
  };
}
