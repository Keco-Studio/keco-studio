import type { ScriptSourceBlock } from './scriptDocumentBlocks';
import { normalizeDialogueSourceText } from './scriptDialogueLineage';

export type DialogueBlockMapping = {
  assetId: string;
  blockId: string;
  documentId: string;
  role: 'action' | 'speech';
  syncedText: string;
};

export type LegacyDialogueCandidate = {
  id: string;
  role: 'action' | 'speech';
  speaker: string;
  text: string;
};

function expectedText(row: LegacyDialogueCandidate): string {
  if (row.role === 'action') return normalizeDialogueSourceText(row.text);
  const speaker = normalizeDialogueSourceText(row.speaker);
  const text = normalizeDialogueSourceText(row.text);
  return normalizeDialogueSourceText(`${speaker}：${text}`);
}

export function matchLegacyDialogueRows(input: {
  blocks: readonly ScriptSourceBlock[];
  rows: readonly LegacyDialogueCandidate[];
  existing: readonly DialogueBlockMapping[];
}): { matched: DialogueBlockMapping[]; unmatchedRowIds: string[] } {
  const used = new Set(input.existing.map((mapping) => mapping.blockId));
  const matched = [...input.existing];
  let previousIndex = -1;
  const unmatchedRowIds: string[] = [];

  for (const row of input.rows) {
    const candidates = input.blocks.filter((block) => {
      if (used.has(block.blockId) || block.nodeIndex <= previousIndex) return false;
      return normalizeDialogueSourceText(block.text) === expectedText(row);
    });
    if (candidates.length !== 1) {
      unmatchedRowIds.push(row.id);
      continue;
    }
    const candidate = candidates[0];
    used.add(candidate.blockId);
    previousIndex = candidate.nodeIndex;
    matched.push({
      assetId: row.id,
      blockId: candidate.blockId,
      documentId: '',
      role: row.role,
      syncedText: candidate.text.trim(),
    });
  }

  return { matched, unmatchedRowIds };
}
