import { describe, expect, it } from '@jest/globals';
import { buildPersistedPlotGraph } from './buildPersistedPlotGraph';

describe('persisted plot graph row mapping', () => {
  it('maps plot memberships through canonical story row order', () => {
    const graph = buildPersistedPlotGraph({
      version: 2,
      entryPlotNodeId: 'RightPlot',
      storyNodeOrder: ['LeftStory', 'RightStory'],
      nodes: [
        { id: 'RightPlot', title: '\u53f3\u4fa7\u5267\u60c5', storyNodeIds: ['RightStory'] },
        { id: 'LeftPlot', title: '\u5de6\u4fa7\u5267\u60c5', storyNodeIds: ['LeftStory'] },
      ],
      edges: [{
        fromPlotNodeId: 'RightPlot',
        toPlotNodeId: 'LeftPlot',
        optionText: null,
        optionIndex: null,
      }],
    }, 2);

    expect(graph?.nodes).toEqual([
      { id: 'RightPlot', label: '\u53f3\u4fa7\u5267\u60c5', rowIndex: 1, rowIndexes: [1] },
      { id: 'LeftPlot', label: '\u5de6\u4fa7\u5267\u60c5', rowIndex: 0, rowIndexes: [0] },
    ]);
  });
});
