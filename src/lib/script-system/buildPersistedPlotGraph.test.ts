import { describe, expect, it } from '@jest/globals';
import { buildPersistedPlotGraph } from './buildPersistedPlotGraph';

describe('persisted plot graph row mapping', () => {
  it('maps plot memberships through canonical story row order', () => {
    const graph = buildPersistedPlotGraph({
      version: 2,
      entryPlotNodeId: 'RightPlot',
      storyNodeOrder: ['LeftStory', 'RightStory'],
      nodes: [
        { id: 'RightPlot', title: '右侧剧情', storyNodeIds: ['RightStory'] },
        { id: 'LeftPlot', title: '左侧剧情', storyNodeIds: ['LeftStory'] },
      ],
      edges: [{
        fromPlotNodeId: 'RightPlot',
        toPlotNodeId: 'LeftPlot',
        optionText: null,
        optionIndex: null,
      }],
    }, 2);

    expect(graph?.nodes).toEqual([
      { id: 'RightPlot', label: '右侧剧情', rowIndex: 1, rowIndexes: [1] },
      { id: 'LeftPlot', label: '左侧剧情', rowIndex: 0, rowIndexes: [0] },
    ]);
  });
});
