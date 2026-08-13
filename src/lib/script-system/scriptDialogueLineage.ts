import type { SourceRef } from '@/lib/story-ir/schema';
import { listScriptSourceBlocks, type ScriptSourceBlock } from './scriptDocumentBlocks';

export type DialogueSourceSpan = {
  blockId: string;
  sourceStart: number;
  sourceEnd: number;
  visibleText: string;
};

export function normalizeDialogueSourceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*/g, '：')
    .trim();
}

export function buildDialogueImportSource(markdown: string): {
  text: string;
  spans: DialogueSourceSpan[];
} {
  const blocks = listScriptSourceBlocks(markdown);
  let offset = 0;
  const spans = blocks.map((block) => {
    const visibleText = block.text.trim();
    const sourceStart = offset;
    const sourceEnd = sourceStart + visibleText.length;
    offset = sourceEnd + 2;
    return { blockId: block.blockId, sourceStart, sourceEnd, visibleText };
  });
  return { text: spans.map((span) => span.visibleText).join('\n\n'), spans };
}

export function resolveNodeBlockId(
  refs: readonly SourceRef[],
  spans: readonly DialogueSourceSpan[],
): string | null {
  const candidates = new Set<string>();
  for (const ref of refs) {
    for (const span of spans) {
      if (ref.start <= span.sourceStart && ref.end >= span.sourceEnd) {
        candidates.add(span.blockId);
      }
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function sourceBlocksFromMarkdown(markdown: string): ScriptSourceBlock[] {
  return listScriptSourceBlocks(markdown);
}
