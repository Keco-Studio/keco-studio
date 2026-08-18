import { listScriptSourceBlocks } from './scriptDocumentBlocks';
import {
  parseSourceDialogue,
  type ScriptDialogueDocumentCommand,
} from './scriptDialogueDocumentSync';

export type ScriptDocumentReconciliation =
  | { type: 'none' }
  | { type: 'ambiguous' }
  | { type: 'command'; command: ScriptDialogueDocumentCommand };

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function deriveReorder(
  previousIds: string[],
  nextIds: string[],
  textById: Map<string, string>,
): ScriptDialogueDocumentCommand | null {
  const candidates: ScriptDialogueDocumentCommand[] = [];
  for (let fromIndex = 0; fromIndex < previousIds.length; fromIndex += 1) {
    const movingId = previousIds[fromIndex];
    const toIndex = nextIds.indexOf(movingId);
    if (toIndex < 0 || toIndex === fromIndex) continue;
    const reordered = [...previousIds];
    reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movingId);
    if (!sameOrder(reordered, nextIds)) continue;
    const edge = fromIndex > toIndex ? 'before' : 'after';
    const targetId = edge === 'before' ? nextIds[toIndex + 1] : nextIds[toIndex - 1];
    const movingText = textById.get(movingId);
    const targetText = targetId ? textById.get(targetId) : undefined;
    if (!movingText || !targetText) continue;
    candidates.push({ type: 'reorder', movingTexts: [movingText], targetText, edge });
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function deriveScriptDocumentReconciliation(
  previousMarkdown: string,
  markdown: string,
): ScriptDocumentReconciliation {
  const previous = listScriptSourceBlocks(previousMarkdown);
  const next = listScriptSourceBlocks(markdown);
  const previousById = new Map(previous.map((block) => [block.blockId, block]));
  const nextById = new Map(next.map((block) => [block.blockId, block]));
  const removed = previous.filter((block) => !nextById.has(block.blockId));
  const inserted = next.filter((block) => !previousById.has(block.blockId));
  const sharedChanged = previous.filter((block) => {
    const nextBlock = nextById.get(block.blockId);
    return nextBlock && nextBlock.text !== block.text;
  });
  if (removed.length > 0 || inserted.length > 0) {
    if (sharedChanged.length > 0) return { type: 'ambiguous' };
    if (inserted.length === 1 && removed.length === 0) {
      const insertedBlock = inserted[0];
      if (!parseSourceDialogue(insertedBlock.text)) return { type: 'ambiguous' };
      const insertedIndex = next.findIndex((block) => block.blockId === insertedBlock.blockId);
      const previousBlock = next.slice(0, insertedIndex).reverse().find(
        (block) => previousById.has(block.blockId),
      );
      const nextBlock = next.slice(insertedIndex + 1).find(
        (block) => previousById.has(block.blockId),
      );
      const sharedNextOrder = next
        .filter((block) => previousById.has(block.blockId))
        .map((block) => block.blockId);
      if (!sameOrder(sharedNextOrder, previous.map((block) => block.blockId))) {
        return { type: 'ambiguous' };
      }
      return {
        type: 'command',
        command: {
          type: 'insert',
          text: insertedBlock.text,
          blockId: insertedBlock.blockId,
          ...(previousBlock
            ? { afterText: previousBlock.text }
            : nextBlock
              ? { beforeText: nextBlock.text }
              : {}),
        },
      };
    }
    if (removed.length === 1 && inserted.length === 0) {
      const remainingPreviousOrder = previous
        .filter((block) => block.blockId !== removed[0].blockId)
        .map((block) => block.blockId);
      if (!sameOrder(remainingPreviousOrder, next.map((block) => block.blockId))) {
        return { type: 'ambiguous' };
      }
      return {
        type: 'command',
        command: {
          type: 'delete',
          blockId: removed[0].blockId,
          previousTexts: [removed[0].text],
        },
      };
    }
    return { type: 'ambiguous' };
  }

  const changed = sharedChanged;
  if (changed.length > 1) return { type: 'ambiguous' };
  if (changed.length === 1) {
    const before = changed[0];
    const after = nextById.get(before.blockId)!;
    const previousDialogue = parseSourceDialogue(before.text);
    const nextDialogue = parseSourceDialogue(after.text);
    if (Boolean(previousDialogue) !== Boolean(nextDialogue)) return { type: 'ambiguous' };
    if (!previousDialogue || !nextDialogue) {
      return {
        type: 'command',
        command: {
          type: 'edit',
          role: 'narration',
          blockId: before.blockId,
          previousText: before.text,
          nextText: after.text,
        },
      };
    }
    if (previousDialogue.cue !== nextDialogue.cue) {
      return {
        type: 'command',
        command: {
          type: 'edit',
          role: 'action',
          blockId: before.blockId,
          previousText: previousDialogue.cue,
          previousDialogue: previousDialogue.dialogue,
          nextText: nextDialogue.cue,
          speaker: nextDialogue.speaker,
          dialogue: nextDialogue.dialogue,
        },
      };
    }
    return {
      type: 'command',
      command: {
        type: 'edit',
        role: 'speech',
        blockId: before.blockId,
        previousText: `${previousDialogue.speaker}：${previousDialogue.dialogue}`,
        nextText: `${nextDialogue.speaker}：${nextDialogue.dialogue}`,
      },
    };
  }

  const previousIds = previous.map((block) => block.blockId);
  const nextIds = next.map((block) => block.blockId);
  if (sameOrder(previousIds, nextIds)) return { type: 'none' };
  const command = deriveReorder(
    previousIds,
    nextIds,
    new Map(previous.map((block) => [block.blockId, block.text])),
  );
  return command ? { type: 'command', command } : { type: 'ambiguous' };
}
