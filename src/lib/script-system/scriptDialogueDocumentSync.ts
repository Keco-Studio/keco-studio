import {
  appendScriptSourceBlock,
  deleteScriptSourceBlocks,
  insertScriptSourceBlock,
  listScriptSourceBlocks,
  moveScriptSourceBlocks,
  replaceScriptSourceBlock,
  type ScriptSourceBlock,
} from './scriptDocumentBlocks';
import { normalizeDialogueSourceText } from './scriptDialogueLineage';

export type ScriptDialogueDocumentCommand =
  | {
      type: 'edit';
      blockId?: string;
      role?: 'action' | 'speech' | 'narration';
      previousText: string;
      nextText: string;
      speaker?: string;
      previousSpeaker?: string;
      previousDialogue?: string;
      dialogue?: string;
    }
  | { type: 'delete'; blockId?: string; previousTexts: string[] }
  | {
      type: 'insert';
      text: string;
      afterText?: string;
      beforeText?: string;
      blockId: string;
      position?: number;
    }
  | {
      type: 'reorder';
      movingTexts: string[];
      targetText: string;
      edge: 'before' | 'after';
    };

export type ParsedSourceDialogue = {
  speaker: string;
  cue: string;
  cueMarkup: string;
  dialogue: string;
};

function formatSourceDialogue(input: ParsedSourceDialogue): string {
  const cue = input.cue.trim();
  const dialogue = input.dialogue.trim();
  return `${input.speaker.trim()}${cue ? `（${cue}）` : ''}：${dialogue}`;
}

export function parseSourceDialogue(value: string): ParsedSourceDialogue | null {
  const match = /^([^：:（(]{1,64})\s*([（(]([^）)]*)[）)])?\s*[：:]\s*(.*)$/.exec(value.trim());
  if (!match) return null;
  const trailingCue = /^[（(]([^）)]*)[）)]\s*(.*)$/.exec(match[4].trim());
  return {
    speaker: match[1].trim(),
    cue: match[3]?.trim() ?? trailingCue?.[1]?.trim() ?? '',
    cueMarkup: match[2] ?? (trailingCue ? `（${trailingCue[1].trim()}）` : ''),
    dialogue: trailingCue?.[2]?.trim() ?? match[4].trim(),
  };
}

export function applyScriptDialogueCommand(
  markdown: string,
  command: ScriptDialogueDocumentCommand,
): { markdown: string; changedBlockIds: string[] } {
  const blocks = listScriptSourceBlocks(markdown);
  const matching = (text: string) => {
    const normalized = normalizeDialogueSourceText(text);
    const dialogue = parseSourceDialogue(normalized);
    return blocks.filter((block) => {
      const candidate = normalizeDialogueSourceText(block.text);
      if (candidate === normalized) return true;
      const candidateDialogue = parseSourceDialogue(candidate);
      if (!candidateDialogue) return false;
      if (!dialogue) {
        return normalizeDialogueSourceText(candidateDialogue.cue) === normalized;
      }
      return normalizeDialogueSourceText(candidateDialogue.speaker)
          === normalizeDialogueSourceText(dialogue.speaker)
        && normalizeDialogueSourceText(candidateDialogue.dialogue)
          === normalizeDialogueSourceText(dialogue.dialogue);
    });
  };
  const contiguousCluster = (candidateGroups: ScriptSourceBlock[][]) => {
    const uniqueGroup = candidateGroups.find((group) => group.length === 1);
    if (!uniqueGroup || candidateGroups.some((group) => group.length === 0)) return [];
    const candidateIds = new Set(candidateGroups.flat().map((block) => block.blockId));
    const anchorIndex = blocks.findIndex((block) => block.blockId === uniqueGroup[0].blockId);
    let start = anchorIndex;
    let end = anchorIndex;
    while (start > 0 && candidateIds.has(blocks[start - 1].blockId)) start -= 1;
    while (end < blocks.length - 1 && candidateIds.has(blocks[end + 1].blockId)) end += 1;
    const cluster = blocks.slice(start, end + 1);
    const clusterIds = new Set(cluster.map((block) => block.blockId));
    return candidateGroups.every((group) => group.some((block) => clusterIds.has(block.blockId)))
      ? cluster
      : [];
  };

  if (command.type === 'reorder') {
    if (command.movingTexts.length === 0) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    const movingGroups = command.movingTexts.map((text) => matching(text));
    const targetCandidates = matching(command.targetText);
    if (
      movingGroups.some((candidates) => candidates.length !== 1)
      || targetCandidates.length !== 1
    ) {
      throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    }
    const movingIds = [...new Set(movingGroups.map((candidates) => candidates[0].blockId))];
    const targetId = targetCandidates[0].blockId;
    if (movingIds.includes(targetId)) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    const orderedMovingIds = blocks
      .filter((block) => movingIds.includes(block.blockId))
      .map((block) => block.blockId);
    return {
      markdown: moveScriptSourceBlocks(markdown, {
        movingBlockIds: orderedMovingIds,
        target: { blockId: targetId, edge: command.edge },
      }),
      changedBlockIds: orderedMovingIds,
    };
  }

  if (command.type === 'edit') {
    const stableBlock = command.blockId
      ? blocks.find((block) => block.blockId === command.blockId)
      : undefined;
    let candidates = stableBlock
      ? [stableBlock]
      : command.role === 'action' && (command.previousSpeaker ?? command.speaker)
      ? blocks.filter((block) => {
          const parsed = parseSourceDialogue(block.text);
          return Boolean(parsed)
            && normalizeDialogueSourceText(parsed!.speaker) === normalizeDialogueSourceText(
              command.previousSpeaker ?? command.speaker!,
            )
            && normalizeDialogueSourceText(parsed!.cue) === normalizeDialogueSourceText(command.previousText)
            && normalizeDialogueSourceText(parsed!.dialogue) === normalizeDialogueSourceText(
              command.previousDialogue ?? command.dialogue ?? '',
            );
        })
      : matching(command.previousText);
    if (
      command.role === 'action'
      && (command.previousSpeaker ?? command.speaker)
      && candidates.length === 0
      && command.previousText.trim()
    ) {
      const previousSpeaker = command.previousSpeaker ?? command.speaker!;
      const cueCandidates = blocks.filter((block) => {
        const parsed = parseSourceDialogue(block.text);
        return Boolean(parsed)
          && normalizeDialogueSourceText(parsed!.speaker) === normalizeDialogueSourceText(previousSpeaker)
          && normalizeDialogueSourceText(parsed!.cue) === normalizeDialogueSourceText(command.previousText);
      });
      if (cueCandidates.length === 1) candidates = cueCandidates;
    }
    if (command.role === 'action' && command.speaker && candidates.length === 0) {
      const previousSpeaker = command.previousSpeaker ?? command.speaker;
      // Empty action rows are commonly added after the table was generated from
      // a slightly different source representation. In that case the dialogue
      // text is not a reliable identity; a unique speaker line is.
      if (!command.previousText.trim()) {
        const speakerCandidates = blocks.filter((block) => {
          const parsed = parseSourceDialogue(block.text);
          return Boolean(parsed)
            && normalizeDialogueSourceText(parsed!.speaker) === normalizeDialogueSourceText(previousSpeaker)
            && !parsed!.cue;
        });
        if (speakerCandidates.length === 1) {
          const block = speakerCandidates[0];
          return {
            markdown: replaceScriptSourceBlock(
              markdown,
              block.blockId,
              `${command.speaker}（${command.nextText.trim()}）：${command.dialogue ?? parseSourceDialogue(block.text)!.dialogue}`,
            ),
            changedBlockIds: [block.blockId],
          };
        }
      }
      if (command.blockId && command.previousText.trim() && command.dialogue?.trim()) {
        const speechCandidates = blocks.filter((block) => {
          const parsed = parseSourceDialogue(block.text);
          return Boolean(parsed)
            && normalizeDialogueSourceText(parsed!.speaker) === normalizeDialogueSourceText(previousSpeaker)
            && normalizeDialogueSourceText(parsed!.dialogue) === normalizeDialogueSourceText(
              command.previousDialogue ?? command.dialogue!,
            )
            && !parsed!.cue;
        });
        const cueCandidates = blocks.filter((block) => {
          const parsed = parseSourceDialogue(block.text);
          return Boolean(parsed)
            && normalizeDialogueSourceText(parsed!.speaker) === normalizeDialogueSourceText(previousSpeaker)
            && normalizeDialogueSourceText(parsed!.cue) === normalizeDialogueSourceText(command.previousText)
            && !parsed!.dialogue;
        });
        const cluster = contiguousCluster([speechCandidates, cueCandidates]);
        if (speechCandidates.length === 1 && cueCandidates.length > 1 && cluster.length > 1) {
          const speechBlock = speechCandidates[0];
          const replaced = replaceScriptSourceBlock(
            markdown,
            speechBlock.blockId,
            `${command.speaker}（${command.nextText.trim()}）：${command.dialogue.trim()}`,
          );
          const duplicateIds = cluster
            .filter((block) => block.blockId !== speechBlock.blockId)
            .map((block) => block.blockId);
          return {
            markdown: deleteScriptSourceBlocks(replaced, duplicateIds),
            changedBlockIds: cluster.map((block) => block.blockId),
          };
        }
      }
      const actionCandidates = matching(command.previousText).filter((block) => !parseSourceDialogue(block.text));
      const paired = actionCandidates.flatMap((actionBlock) => {
        const actionIndex = blocks.findIndex((block) => block.blockId === actionBlock.blockId);
        const speechBlock = blocks[actionIndex + 1];
        const speech = speechBlock ? parseSourceDialogue(speechBlock.text) : null;
        return speech
          && normalizeDialogueSourceText(speech.speaker) === normalizeDialogueSourceText(previousSpeaker)
          && normalizeDialogueSourceText(speech.dialogue) === normalizeDialogueSourceText(
            command.previousDialogue ?? command.dialogue ?? '',
          )
          ? [{ actionBlock, speechBlock }]
          : [];
      });
      if (paired.length === 1) {
        const { actionBlock, speechBlock } = paired[0];
        const nextText = command.nextText.trim()
          ? `${command.speaker}（${command.nextText.trim()}）：${command.dialogue ?? ''}`
          : `${command.speaker}：${command.dialogue ?? ''}`;
        const replaced = replaceScriptSourceBlock(markdown, speechBlock.blockId, nextText);
        return {
          markdown: deleteScriptSourceBlocks(replaced, [actionBlock.blockId]),
          changedBlockIds: [actionBlock.blockId, speechBlock.blockId],
        };
      }
      if (actionCandidates.length === 1 && command.dialogue?.trim()) {
        const actionBlock = actionCandidates[0];
        return {
          markdown: replaceScriptSourceBlock(
            markdown,
            actionBlock.blockId,
            `${command.speaker}（${command.nextText.trim()}）：${command.dialogue.trim()}`,
          ),
          changedBlockIds: [actionBlock.blockId],
        };
      }
    }
    if (candidates.length !== 1) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    const block = candidates[0];
    const currentDialogue = parseSourceDialogue(block.text);
    let nextText = command.nextText;
    if (command.role === 'speech' && currentDialogue) {
      const nextDialogue = parseSourceDialogue(command.nextText);
      if (!nextDialogue && /^[^：:]{1,64}[：:]\s*$/.test(command.nextText)) {
        return currentDialogue.cue
          ? {
              markdown: replaceScriptSourceBlock(markdown, block.blockId, currentDialogue.cue),
              changedBlockIds: [block.blockId],
            }
          : {
              markdown: deleteScriptSourceBlocks(markdown, [block.blockId]),
              changedBlockIds: [block.blockId],
            };
      }
      if (!nextDialogue) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
      nextText = `${nextDialogue.speaker}${currentDialogue.cueMarkup}：${nextDialogue.dialogue}`;
    } else if (command.role === 'action' && currentDialogue) {
      nextText = command.nextText.trim()
        ? `${command.speaker ?? currentDialogue.speaker}（${command.nextText.trim()}）：${command.dialogue ?? currentDialogue.dialogue}`
        : `${command.speaker ?? currentDialogue.speaker}：${command.dialogue ?? currentDialogue.dialogue}`;
    } else if (
      command.role === 'action'
      && command.speaker
      && command.dialogue?.trim()
    ) {
      nextText = command.nextText.trim()
        ? `${command.speaker}（${command.nextText.trim()}）：${command.dialogue.trim()}`
        : `${command.speaker}：${command.dialogue.trim()}`;
    }
    return {
      markdown: replaceScriptSourceBlock(markdown, block.blockId, nextText),
      changedBlockIds: [block.blockId],
    };
  }

  if (command.type === 'delete') {
    const stableBlock = command.blockId
      ? blocks.find((block) => block.blockId === command.blockId)
      : undefined;
    if (stableBlock) {
      return {
        markdown: deleteScriptSourceBlocks(markdown, [stableBlock.blockId]),
        changedBlockIds: [stableBlock.blockId],
      };
    }
    if (command.previousTexts.length > 1) {
      const normalizedTexts = command.previousTexts.map(normalizeDialogueSourceText);
      const pairCandidates: Array<typeof blocks> = [];
      for (let start = 0; start <= blocks.length - normalizedTexts.length; start += 1) {
        const candidate = blocks.slice(start, start + normalizedTexts.length);
        if (candidate.every((block, index) => (
          matching(normalizedTexts[index]!).some((match) => match.blockId === block.blockId)
        ))) {
          pairCandidates.push(candidate);
        }
      }
      if (pairCandidates.length === 1) {
        const blockIds = pairCandidates[0].map((block) => block.blockId);
        return {
          markdown: deleteScriptSourceBlocks(markdown, blockIds),
          changedBlockIds: blockIds,
        };
      }
      if (pairCandidates.length > 1) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    }
    const candidates = command.previousTexts.map((text) => matching(text));
    if (
      command.blockId
      && candidates.some((items) => items.length === 1)
      && candidates.some((items) => items.length > 1)
    ) {
      const cluster = contiguousCluster(candidates);
      if (cluster.length > 1) {
        const blockIds = cluster.map((block) => block.blockId);
        return {
          markdown: deleteScriptSourceBlocks(markdown, blockIds),
          changedBlockIds: blockIds,
        };
      }
    }
    if (candidates.some((items) => items.length !== 1)) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    const blockIds = [...new Set(candidates.map((items) => items[0].blockId))];
    return {
      markdown: deleteScriptSourceBlocks(markdown, blockIds),
      changedBlockIds: blockIds,
    };
  }

  const anchorText = command.afterText ?? command.beforeText;
  const existingAnchor = blocks.find((block) => block.blockId === command.blockId);
  if (existingAnchor) {
    const existingDialogue = parseSourceDialogue(existingAnchor.text);
    const incomingDialogue = parseSourceDialogue(command.text);
    if (existingDialogue && incomingDialogue
      && existingDialogue.speaker === incomingDialogue.speaker) {
      const merged = formatSourceDialogue({
        speaker: existingDialogue.speaker,
        cue: incomingDialogue.cue || existingDialogue.cue,
        cueMarkup: '',
        dialogue: incomingDialogue.dialogue || existingDialogue.dialogue,
      });
      return {
        markdown: replaceScriptSourceBlock(markdown, existingAnchor.blockId, merged),
        changedBlockIds: [existingAnchor.blockId],
      };
    }
    return {
      markdown: replaceScriptSourceBlock(markdown, existingAnchor.blockId, command.text),
      changedBlockIds: [existingAnchor.blockId],
    };
  }
  if (!anchorText) {
    return {
      markdown: appendScriptSourceBlock(markdown, {
        blockId: command.blockId,
        text: command.text,
      }),
      changedBlockIds: [command.blockId],
    };
  }
  let candidates = matching(anchorText);
  let edge: 'before' | 'after' = command.afterText ? 'after' : 'before';
  if (command.afterText && command.beforeText) {
    // Neighbors in the dialogue table are often not adjacent in the source
    // document (narration, headings, or notes can sit between them). Keep any
    // after/before pair that preserves document order, preferring the tightest
    // unique window when repeated text creates multiple candidates.
    const afterCandidates = matching(command.afterText);
    const beforeCandidates = matching(command.beforeText);
    const pairs = afterCandidates.flatMap((afterBlock) => {
      const afterIndex = blocks.findIndex((block) => block.blockId === afterBlock.blockId);
      return beforeCandidates.flatMap((beforeBlock) => {
        const beforeIndex = blocks.findIndex((block) => block.blockId === beforeBlock.blockId);
        return beforeIndex > afterIndex
          ? [{ afterBlock, gap: beforeIndex - afterIndex }]
          : [];
      });
    });
    if (pairs.length > 0) {
      const bestGap = Math.min(...pairs.map((pair) => pair.gap));
      const tightest = pairs.filter((pair) => pair.gap === bestGap);
      const uniqueAfterIds = [...new Set(tightest.map((pair) => pair.afterBlock.blockId))];
      if (uniqueAfterIds.length !== 1) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
      candidates = [tightest[0].afterBlock];
      edge = 'after';
    } else if (afterCandidates.length > 0 && beforeCandidates.length === 0) {
      candidates = [afterCandidates[afterCandidates.length - 1]];
      edge = 'after';
    } else if (beforeCandidates.length > 0 && afterCandidates.length === 0) {
      candidates = [beforeCandidates[0]];
      edge = 'before';
    } else {
      throw new Error('SOURCE_MAPPING_AMBIGUOUS');
    }
  }
  if (candidates.length > 1 && command.afterText && !command.beforeText) {
    // A table insertion after the selected row maps to the last matching
    // source occurrence when the generated text is repeated. This preserves
    // the visible row order instead of failing the whole save.
    candidates = [candidates[candidates.length - 1]];
  } else if (candidates.length > 1 && command.beforeText && !command.afterText) {
    candidates = [candidates[0]];
  }
  if (candidates.length !== 1) throw new Error('SOURCE_MAPPING_AMBIGUOUS');
  const block = candidates[0];
  return {
    markdown: insertScriptSourceBlock(markdown, {
      blockId: command.blockId,
      text: command.text,
      anchorBlockId: block.blockId,
      edge,
    }),
    changedBlockIds: [command.blockId],
  };
}
