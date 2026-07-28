export const DOCUMENT_RANGE_CONTEXT_LENGTH = 32;

export type DocumentRangeBlock = {
  blockId: string;
  blockType: 'heading' | 'paragraph';
  text: string;
  headingLevel?: number;
  nearestHeading?: string;
};

export type DocumentRangeReferenceTarget = {
  kind: 'document-range';
  documentId: string;
  startBlockId: string;
  startOffset: number;
  startBefore: string;
  startAfter: string;
  endBlockId: string;
  endOffset: number;
  endBefore: string;
  endAfter: string;
  fallbackLabel: string;
};

export type DocumentRangePoint = {
  blockId: string;
  offset: number;
};

export type CreateDocumentRangeTargetInput = {
  documentId: string;
  blocks: readonly DocumentRangeBlock[];
  anchor: DocumentRangePoint;
  focus: DocumentRangePoint;
};

export type ResolvedDocumentRange = {
  label: string;
  startBlockId: string;
  nearestHeading?: string;
};

function inlineText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function blockIndex(
  blocks: readonly DocumentRangeBlock[],
  blockId: string
): number {
  return blocks.findIndex((block) => block.blockId === blockId);
}

function validPoint(block: DocumentRangeBlock | undefined, offset: number): boolean {
  return Boolean(
    block &&
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset <= block.text.length
  );
}

function orderedPoints(
  blocks: readonly DocumentRangeBlock[],
  anchor: DocumentRangePoint,
  focus: DocumentRangePoint
): { start: DocumentRangePoint; end: DocumentRangePoint } | null {
  const anchorIndex = blockIndex(blocks, anchor.blockId);
  const focusIndex = blockIndex(blocks, focus.blockId);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  if (!validPoint(blocks[anchorIndex], anchor.offset)) return null;
  if (!validPoint(blocks[focusIndex], focus.offset)) return null;

  if (
    anchorIndex < focusIndex ||
    (anchorIndex === focusIndex && anchor.offset <= focus.offset)
  ) {
    return { start: anchor, end: focus };
  }
  return { start: focus, end: anchor };
}

function extractRangeText(
  blocks: readonly DocumentRangeBlock[],
  startIndex: number,
  startOffset: number,
  endIndex: number,
  endOffset: number
): string {
  if (startIndex === endIndex) {
    return inlineText(blocks[startIndex].text.slice(startOffset, endOffset));
  }
  const parts = [blocks[startIndex].text.slice(startOffset)];
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    parts.push(blocks[index].text);
  }
  parts.push(blocks[endIndex].text.slice(0, endOffset));
  return inlineText(parts.join(' '));
}

function boundaryContext(text: string, offset: number) {
  return {
    before: text.slice(
      Math.max(0, offset - DOCUMENT_RANGE_CONTEXT_LENGTH),
      offset
    ),
    after: text.slice(offset, offset + DOCUMENT_RANGE_CONTEXT_LENGTH),
  };
}

export function createDocumentRangeTarget({
  documentId,
  blocks,
  anchor,
  focus,
}: CreateDocumentRangeTargetInput): DocumentRangeReferenceTarget | null {
  const ordered = orderedPoints(blocks, anchor, focus);
  if (!ordered) return null;
  const startIndex = blockIndex(blocks, ordered.start.blockId);
  const endIndex = blockIndex(blocks, ordered.end.blockId);
  const fallbackLabel = extractRangeText(
    blocks,
    startIndex,
    ordered.start.offset,
    endIndex,
    ordered.end.offset
  );
  if (!fallbackLabel) return null;

  const startContext = boundaryContext(
    blocks[startIndex].text,
    ordered.start.offset
  );
  const endContext = boundaryContext(blocks[endIndex].text, ordered.end.offset);
  return {
    kind: 'document-range',
    documentId,
    startBlockId: ordered.start.blockId,
    startOffset: ordered.start.offset,
    startBefore: startContext.before,
    startAfter: startContext.after,
    endBlockId: ordered.end.blockId,
    endOffset: ordered.end.offset,
    endBefore: endContext.before,
    endAfter: endContext.after,
    fallbackLabel,
  };
}

function matchingOffsets(
  text: string,
  context: string,
  side: 'before' | 'after'
): number[] {
  if (!context) return [];
  const matches: number[] = [];
  for (let offset = 0; offset <= text.length; offset += 1) {
    const matchesContext = side === 'before'
      ? text.slice(Math.max(0, offset - context.length), offset) === context
      : text.slice(offset, offset + context.length) === context;
    if (matchesContext) matches.push(offset);
  }
  return matches;
}

function nearestUniqueOffset(offsets: readonly number[], previousOffset: number): number | null {
  if (offsets.length === 0) return null;
  let best = offsets[0];
  let bestDistance = Math.abs(best - previousOffset);
  let tied = false;
  for (const offset of offsets.slice(1)) {
    const distance = Math.abs(offset - previousOffset);
    if (distance < bestDistance) {
      best = offset;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance) {
      tied = true;
    }
  }
  return tied ? null : best;
}

function locateBoundary(
  text: string,
  previousOffset: number,
  before: string,
  after: string,
  role: 'start' | 'end'
): number | null {
  const beforeMatches = matchingOffsets(text, before, 'before');
  const afterMatches = matchingOffsets(text, after, 'after');
  if (before && after) {
    const afterSet = new Set(afterMatches);
    const exactMatches = beforeMatches.filter((offset) => afterSet.has(offset));
    const exact = nearestUniqueOffset(exactMatches, previousOffset);
    if (exact !== null) return exact;
  }

  const primary = role === 'start' ? beforeMatches : afterMatches;
  const secondary = role === 'start' ? afterMatches : beforeMatches;
  return nearestUniqueOffset(primary, previousOffset)
    ?? nearestUniqueOffset(secondary, previousOffset);
}

export function resolveDocumentRange(
  target: DocumentRangeReferenceTarget,
  blocks: readonly DocumentRangeBlock[]
): ResolvedDocumentRange | null {
  const startIndex = blockIndex(blocks, target.startBlockId);
  const endIndex = blockIndex(blocks, target.endBlockId);
  if (startIndex < 0 || endIndex < startIndex) return null;

  const startOffset = locateBoundary(
    blocks[startIndex].text,
    target.startOffset,
    target.startBefore,
    target.startAfter,
    'start'
  );
  const endOffset = locateBoundary(
    blocks[endIndex].text,
    target.endOffset,
    target.endBefore,
    target.endAfter,
    'end'
  );
  if (startOffset === null || endOffset === null) return null;
  if (startIndex === endIndex && endOffset <= startOffset) return null;

  const label = extractRangeText(
    blocks,
    startIndex,
    startOffset,
    endIndex,
    endOffset
  );
  if (!label) return null;
  return {
    label,
    startBlockId: target.startBlockId,
    ...(blocks[startIndex].nearestHeading
      ? { nearestHeading: blocks[startIndex].nearestHeading }
      : {}),
  };
}
