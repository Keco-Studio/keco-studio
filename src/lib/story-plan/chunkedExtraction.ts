import type { StoryContentExtraction } from '@/lib/story-extraction/pipeline';

const MAX_STORY_ID_LENGTH = 64;

export function mergeChunkedStoryContentExtractions(
  chunks: StoryContentExtraction[]
): StoryContentExtraction {
  return {
    version: 3,
    structuralUnitIds: [...new Set(
      chunks.flatMap((chunk) => chunk.structuralUnitIds)
    )],
    nodes: chunks.flatMap((chunk, chunkIndex) => chunk.nodes.map((node, nodeIndex) => ({
      ...node,
      id: chunkedId('N', chunkIndex, nodeIndex, node.id),
    }))),
    choices: chunks.flatMap((chunk, chunkIndex) => (
      chunk.choices.map((choice, choiceIndex) => ({
        ...choice,
        id: chunkedId('C', chunkIndex, choiceIndex, choice.id),
      }))
    )),
  };
}

function chunkedId(
  kind: 'N' | 'C',
  chunkIndex: number,
  itemIndex: number,
  sourceId: string
): string {
  const prefix = `C${chunkIndex + 1}${kind}${itemIndex + 1}_`;
  const unprefixed = sourceId.replace(/^(?:C\d+[NC]\d+_)+/, '');
  return `${prefix}${unprefixed.slice(0, MAX_STORY_ID_LENGTH - prefix.length)}`;
}
