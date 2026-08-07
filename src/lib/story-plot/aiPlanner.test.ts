import { describe, expect, it } from '@jest/globals';
import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import { buildStoryPlotPlanFromGrouping } from './aiPlanner';

const ref = { sourceId: 'ancient-house', unitId: 'ancient-house:0', start: 0, end: 1 };

function node(input: Partial<StoryNode> & Pick<StoryNode, 'label' | 'type' | 'content'>): StoryNode {
  return { commands: [], options: [], sourceRefs: [ref], ...input };
}

function ancientHouseDocument(): StoryDocument {
  return {
    version: 1,
    entryLabel: 'Background',
    nodes: [
      node({ label: 'Background', type: 'scene', content: 'Plot background', next: 'Suspense' }),
      node({ label: 'Suspense', type: 'scene', content: 'Suspense intro', next: 'Decision' }),
      node({
        label: 'Decision', type: 'dialogue', speaker: 'Heroine', content: 'Which place will you choose?',
        options: [
          { text: 'East guest room', target: 'East', commands: [], sourceRefs: [ref] },
          { text: 'West attic', target: 'West', commands: [], sourceRefs: [ref] },
        ],
      }),
      node({ label: 'East', type: 'dialogue', speaker: 'Hero', content: 'I choose the east guest room.', next: 'SafeEnd' }),
      node({ label: 'SafeEnd', type: 'scene', content: 'Safe ending' }),
      node({ label: 'West', type: 'dialogue', speaker: 'Hero', content: 'I choose the west attic.', next: 'Memory' }),
      node({ label: 'Memory', type: 'scene', content: "Heroine's memory", next: 'BondEnd' }),
      node({ label: 'BondEnd', type: 'scene', content: 'Bond ending', next: 'Teaser' }),
      node({ label: 'Teaser', type: 'scene', content: 'To be continued' }),
    ],
  };
}

describe('AI story plot grouping', () => {
  it('keeps story nodes in plot nodes and canonical choices on edges', () => {
    const plan = buildStoryPlotPlanFromGrouping(ancientHouseDocument(), {
      nodes: [
        { title: 'Plot background', storyNodeIds: ['Background'] },
        { title: 'Suspense intro', storyNodeIds: ['Suspense', 'Decision'] },
        { title: 'Careful route', storyNodeIds: ['East'] },
        { title: 'Safe ending', storyNodeIds: ['SafeEnd'] },
        { title: 'Curious route', storyNodeIds: ['West'] },
        { title: "Heroine's memory", storyNodeIds: ['Memory'] },
        { title: 'Bond ending', storyNodeIds: ['BondEnd'] },
        { title: 'Rainy night unfinished', storyNodeIds: ['Teaser'] },
      ],
    });

    expect(plan.nodes.map((plot) => plot.title)).toEqual([
      'Plot background', 'Suspense intro', 'Careful route', 'Safe ending',
      'Curious route', "Heroine's memory", 'Bond ending', 'Rainy night unfinished',
    ]);
    expect(plan.edges).toEqual(expect.arrayContaining([
      {
        fromPlotNodeId: 'Suspense', toPlotNodeId: 'East',
        optionText: 'East guest room', optionIndex: 0,
      },
      {
        fromPlotNodeId: 'Suspense', toPlotNodeId: 'West',
        optionText: 'West attic', optionIndex: 1,
      },
    ]));
    expect(plan.nodes.some((plot) => plot.title === 'East guest room')).toBe(false);
  });

  it('rejects a grouping that hides an option target inside its decision node', () => {
    expect(() => buildStoryPlotPlanFromGrouping(ancientHouseDocument(), {
      nodes: [
        { title: 'Everything', storyNodeIds: [
          'Background', 'Suspense', 'Decision', 'East', 'SafeEnd', 'West', 'Memory', 'BondEnd', 'Teaser',
        ] },
      ],
    })).toThrow(/decision|option|target/i);
  });

  it.each([
    {
      nodes: [
        { title: 'Wrong order', storyNodeIds: ['Suspense'] },
        { title: 'Background', storyNodeIds: ['Background', 'Decision', 'East', 'SafeEnd', 'West', 'Memory', 'BondEnd', 'Teaser'] },
      ],
    },
    {
      nodes: [
        { title: 'Duplicate', storyNodeIds: ['Background', 'Suspense'] },
        { title: 'Duplicate two', storyNodeIds: ['Suspense', 'Decision', 'East', 'SafeEnd', 'West', 'Memory', 'BondEnd', 'Teaser'] },
      ],
    },
  ])('rejects non-contiguous or duplicate grouping', (grouping) => {
    expect(() => buildStoryPlotPlanFromGrouping(ancientHouseDocument(), grouping))
      .toThrow(/ordered|exactly once/i);
  });
});
