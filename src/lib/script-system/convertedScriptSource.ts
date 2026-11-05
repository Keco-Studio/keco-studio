import { appendScriptSourceBlock, listScriptSourceBlocks } from './scriptDocumentBlocks';
import { parseSourceDialogue } from './scriptDialogueDocumentSync';
import { normalizeDialogueSourceText } from './scriptDialogueLineage';

function identity(text: string): string {
  text = text.replace(/^\*\*(.+)\*\*$/, '$1').replace(/^\*(.+)\*$/, '$1');
  const dialogue = parseSourceDialogue(text);
  return dialogue
    ? JSON.stringify([dialogue.speaker, dialogue.cue, dialogue.dialogue].map(normalizeDialogueSourceText))
    : normalizeDialogueSourceText(text);
}

/** Preserve existing dialogue anchors while replacing formatting/control syntax. */
export function buildConvertedScriptSource(markdown: string, scriptText: string): string {
  const remaining = [...listScriptSourceBlocks(markdown)];
  let result = '';
  for (const line of scriptText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)) {
    const match = remaining.findIndex(block => identity(block.text) === identity(line));
    const blockId = match >= 0 ? remaining.splice(match, 1)[0].blockId : crypto.randomUUID();
    result = appendScriptSourceBlock(result, { blockId, text: line });
  }
  return result;
}
