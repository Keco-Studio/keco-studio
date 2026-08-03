import { describe, expect, it } from '@jest/globals';
import { buildPersistedPlotGraph } from '@/lib/script-system/buildPersistedPlotGraph';

const plan = {
  version: 1,
  entryPlotNodeId: 'Opening',
  nodes: [
    { id: 'Opening', title: '\u89e6\u53d1\u5206\u652f\u9009\u62e9', storyNodeIds: ['Opening', 'Decision'] },
    { id: 'East', title: '\u5b89\u7a33\u8c28\u614e\u7ebf', storyNodeIds: ['East', 'SafeEnd'] },
    { id: 'West', title: '\u597d\u5947\u63a2\u9669\u7ebf', storyNodeIds: ['West', 'Memory', 'BondEnd'] },
  ],
  edges: [
    {
      fromPlotNodeId: 'Opening', toPlotNodeId: 'East',
      optionText: '\u4e1c\u4fa7\u5ba2\u623f', optionIndex: 0,
    },
    {
      fromPlotNodeId: 'Opening', toPlotNodeId: 'West',
      optionText: '\u897f\u4fa7\u9601\u697c', optionIndex: 1,
    },
  ],
};

describe('persisted story plot graph', () => {
  it('maps plot groups to exact script row indexes and choices to edges', () => {
    const graph = buildPersistedPlotGraph(plan, 7);

    expect(graph?.nodes.map((node) => [node.label, node.rowIndexes])).toEqual([
      ['\u89e6\u53d1\u5206\u652f\u9009\u62e9', [0, 1]],
      ['\u5b89\u7a33\u8c28\u614e\u7ebf', [2, 3]],
      ['\u597d\u5947\u63a2\u9669\u7ebf', [4, 5, 6]],
    ]);
    expect(graph?.edges).toEqual([
      { from: 'Opening', to: 'East', optionText: '\u4e1c\u4fa7\u5ba2\u623f', optionIndex: 0 },
      { from: 'Opening', to: 'West', optionText: '\u897f\u4fa7\u9601\u697c', optionIndex: 1 },
    ]);
  });

  it('rejects invalid metadata and a stale row count', () => {
    expect(buildPersistedPlotGraph({ version: 1, nodes: [] }, 7)).toBeUndefined();
    expect(buildPersistedPlotGraph(plan, 8)).toBeUndefined();
  });
});
