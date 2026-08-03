import { describe, expect, it } from '@jest/globals';
import type { StoryContentExtraction } from '@/lib/story-extraction/pipeline';
import { mergeChunkedStoryContentExtractions } from './chunkedExtraction';

function extraction(unitPrefix: string): StoryContentExtraction {
  return {
    version: 3,
    structuralUnitIds: [`${unitPrefix}:0`],
    nodes: [{
      id: 'scene_1',
      type: 'narration',
      presentationType: 3,
      speaker: '',
      content: `${unitPrefix} scene`,
      sourceUnitIds: [`${unitPrefix}:1`],
    }],
    choices: [{
      id: 'choice_1',
      text: `${unitPrefix} choice`,
      sourceUnitIds: [`${unitPrefix}:2`],
    }],
  };
}

describe('chunked content extraction merge', () => {
  it('assigns collision-free IDs while preserving exact source evidence', () => {
    const merged = mergeChunkedStoryContentExtractions([
      extraction('first'),
      extraction('second'),
    ]);

    expect(merged.nodes.map((node) => node.id)).toEqual([
      'C1N1_scene_1',
      'C2N1_scene_1',
    ]);
    expect(merged.choices.map((choice) => choice.id)).toEqual([
      'C1C1_choice_1',
      'C2C1_choice_1',
    ]);
    expect(merged.structuralUnitIds).toEqual(['first:0', 'second:0']);
    expect(merged.nodes.flatMap((node) => node.sourceUnitIds))
      .toEqual(['first:1', 'second:1']);
  });
});
