import type { SourceUnit, StoryDocument } from './schema';

export interface StorySourceChunk {
  index: number;
  units: SourceUnit[];
  characterCount: number;
}

export interface ChunkSourceOptions {
  maxChars: number;
}

export function chunkSourceUnits(
  units: SourceUnit[],
  options: ChunkSourceOptions
): StorySourceChunk[] {
  if (!Number.isInteger(options.maxChars) || options.maxChars < 1) {
    throw new Error('Chunk character limit must be a positive integer');
  }

  const chunks: StorySourceChunk[] = [];
  let current: SourceUnit[] = [];
  let currentLength = 0;

  for (const unit of units) {
    if (unit.text.length > options.maxChars) {
      throw new Error(`Source unit ${unit.id} exceeds the model context limit`);
    }
    const nextLength = currentLength + (current.length > 0 ? 1 : 0) + unit.text.length;
    if (current.length > 0 && nextLength > options.maxChars) {
      chunks.push({ index: chunks.length, units: current, characterCount: currentLength });
      current = [];
      currentLength = 0;
    }
    currentLength += (current.length > 0 ? 1 : 0) + unit.text.length;
    current.push(unit);
  }

  if (current.length > 0) {
    chunks.push({ index: chunks.length, units: current, characterCount: currentLength });
  }
  return chunks;
}

export function mergeStoryChunks(documents: StoryDocument[]): StoryDocument {
  if (documents.length === 0) throw new Error('No converted story chunks to merge');
  return {
    version: 1,
    entryLabel: documents[0].entryLabel,
    nodes: documents.flatMap((document) => document.nodes),
  };
}
