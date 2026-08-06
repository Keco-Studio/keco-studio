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
      node({ label: 'Background', type: 'scene', content: '\u5267\u60c5\u80cc\u666f', next: 'Suspense' }),
      node({ label: 'Suspense', type: 'scene', content: '\u60ac\u5ff5\u5bfc\u5165', next: 'Decision' }),
      node({
        label: 'Decision', type: 'dialogue', speaker: '\u5973\u4e3b', content: '\u60f3\u9009\u54ea\u4e00\u5904？',
        options: [
          { text: '\u4e1c\u4fa7\u5ba2\u623f', target: 'East', commands: [], sourceRefs: [ref] },
          { text: '\u897f\u4fa7\u9601\u697c', target: 'West', commands: [], sourceRefs: [ref] },
        ],
      }),
      node({ label: 'East', type: 'dialogue', speaker: '\u7537\u4e3b', content: '\u6211\u9009\u4e1c\u4fa7\u5ba2\u623f。', next: 'SafeEnd' }),
      node({ label: 'SafeEnd', type: 'scene', content: '\u5b89\u7a33\u7ed3\u5c40' }),
      node({ label: 'West', type: 'dialogue', speaker: '\u7537\u4e3b', content: '\u6211\u9009\u897f\u4fa7\u9601\u697c。', next: 'Memory' }),
      node({ label: 'Memory', type: 'scene', content: '\u5973\u4e3b\u7684\u56de\u5fc6', next: 'BondEnd' }),
      node({ label: 'BondEnd', type: 'scene', content: '\u7f81\u7eca\u7ed3\u5c40', next: 'Teaser' }),
      node({ label: 'Teaser', type: 'scene', content: '\u672a\u5b8c\u5f85\u7eed' }),
    ],
  };
}

describe('AI story plot grouping', () => {
  it('keeps story nodes in plot nodes and canonical choices on edges', () => {
    const plan = buildStoryPlotPlanFromGrouping(ancientHouseDocument(), {
      nodes: [
        { title: '\u5267\u60c5\u80cc\u666f', storyNodeIds: ['Background'] },
        { title: '\u60ac\u5ff5\u5bfc\u5165', storyNodeIds: ['Suspense', 'Decision'] },
        { title: '\u5b89\u7a33\u8c28\u614e\u7ebf', storyNodeIds: ['East'] },
        { title: '\u5b89\u7a33\u7ed3\u5c40', storyNodeIds: ['SafeEnd'] },
        { title: '\u597d\u5947\u63a2\u9669\u7ebf', storyNodeIds: ['West'] },
        { title: '\u5973\u4e3b\u7684\u56de\u5fc6', storyNodeIds: ['Memory'] },
        { title: '\u7f81\u7eca\u7ed3\u5c40', storyNodeIds: ['BondEnd'] },
        { title: '\u96e8\u591c\u672a\u7ec8', storyNodeIds: ['Teaser'] },
      ],
    });

    expect(plan.nodes.map((plot) => plot.title)).toEqual([
      '\u5267\u60c5\u80cc\u666f', '\u60ac\u5ff5\u5bfc\u5165', '\u5b89\u7a33\u8c28\u614e\u7ebf', '\u5b89\u7a33\u7ed3\u5c40',
      '\u597d\u5947\u63a2\u9669\u7ebf', '\u5973\u4e3b\u7684\u56de\u5fc6', '\u7f81\u7eca\u7ed3\u5c40', '\u96e8\u591c\u672a\u7ec8',
    ]);
    expect(plan.edges).toEqual(expect.arrayContaining([
      {
        fromPlotNodeId: 'Suspense', toPlotNodeId: 'East',
        optionText: '\u4e1c\u4fa7\u5ba2\u623f', optionIndex: 0,
      },
      {
        fromPlotNodeId: 'Suspense', toPlotNodeId: 'West',
        optionText: '\u897f\u4fa7\u9601\u697c', optionIndex: 1,
      },
    ]));
    expect(plan.nodes.some((plot) => plot.title === '\u4e1c\u4fa7\u5ba2\u623f')).toBe(false);
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
        { title: '\u9519\u8bef\u987a\u5e8f', storyNodeIds: ['Suspense'] },
        { title: '\u80cc\u666f', storyNodeIds: ['Background', 'Decision', 'East', 'SafeEnd', 'West', 'Memory', 'BondEnd', 'Teaser'] },
      ],
    },
    {
      nodes: [
        { title: '\u91cd\u590d', storyNodeIds: ['Background', 'Suspense'] },
        { title: '\u91cd\u590d\u4e8c', storyNodeIds: ['Suspense', 'Decision', 'East', 'SafeEnd', 'West', 'Memory', 'BondEnd', 'Teaser'] },
      ],
    },
  ])('rejects non-contiguous or duplicate grouping', (grouping) => {
    expect(() => buildStoryPlotPlanFromGrouping(ancientHouseDocument(), grouping))
      .toThrow(/ordered|exactly once/i);
  });
});
