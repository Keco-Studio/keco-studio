import { describe, expect, it } from '@jest/globals';
import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import { buildDeterministicStoryPlotPlan } from './deterministicBuilder';

const ref = { sourceId: 'story', unitId: 'story:0', start: 0, end: 1 };

function node(input: Partial<StoryNode> & Pick<StoryNode, 'label' | 'type' | 'content'>): StoryNode {
  return {
    commands: [],
    options: [],
    sourceRefs: [ref],
    ...input,
  };
}

describe('deterministic plot grouping', () => {
  it('groups headings and branch targets while keeping choices on edges', () => {
    const document: StoryDocument = {
      version: 1,
      entryLabel: 'Background',
      nodes: [
        node({ label: 'Background', type: 'scene', content: '\u5267\u60c5\u80cc\u666f', next: 'Opening' }),
        node({ label: 'Opening', type: 'scene', content: '\u5f00\u573a\u5bf9\u8bdd', next: 'Decision' }),
        node({
          label: 'Decision', type: 'dialogue', content: '\u5982\u4f55\u51b3\u65ad？', speaker: '\u4f60',
          options: [
            { text: '\u7a33\u5b88\u6d3e\u8def\u7ebf', target: 'Stable', commands: [], sourceRefs: [ref] },
            { text: '\u5fe0\u541b\u8def\u7ebf', target: 'Loyal', commands: [], sourceRefs: [ref] },
          ],
        }),
        node({ label: 'Stable', type: 'narration', content: '\u62f1\u624b', speaker: '\u4f60', next: 'StableLine' }),
        node({ label: 'StableLine', type: 'dialogue', content: '\u81e3\u4ee5\u4e3a\u5f53\u629a\u6c11。', speaker: '\u4f60' }),
        node({ label: 'Loyal', type: 'narration', content: '\u518d\u62dc', speaker: '\u4f60', next: 'LoyalLine' }),
        node({ label: 'LoyalLine', type: 'dialogue', content: '\u81e3\u613f\u4e3a\u965b\u4e0b\u6267\u7b14。', speaker: '\u4f60' }),
      ],
    };

    const result = buildDeterministicStoryPlotPlan(document);

    expect(result.nodes.map((plot) => [plot.title, plot.storyNodeIds])).toEqual([
      ['\u5267\u60c5\u80cc\u666f', ['Background']],
      ['\u5f00\u573a\u5bf9\u8bdd', ['Opening', 'Decision']],
      ['\u7a33\u5b88\u6d3e\u8def\u7ebf', ['Stable', 'StableLine']],
      ['\u5fe0\u541b\u8def\u7ebf', ['Loyal', 'LoyalLine']],
    ]);
    expect(result.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Background', toPlotNodeId: 'Opening', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Stable', optionText: '\u7a33\u5b88\u6d3e\u8def\u7ebf', optionIndex: 0 },
      { fromPlotNodeId: 'Opening', toPlotNodeId: 'Loyal', optionText: '\u5fe0\u541b\u8def\u7ebf', optionIndex: 1 },
    ]));
  });
});
