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

  it('keeps disconnected persisted Plot nodes visible with their titles', () => {
    const graph = buildPersistedPlotGraph({
      version: 2,
      entryPlotNodeId: 'FinalMerge',
      storyNodeOrder: ['Node104', 'Node105', 'Node109'],
      nodes: [
        {
          id: 'FinalMerge',
          title: 'Final merge',
          storyNodeIds: ['Node104', 'Node105'],
        },
        { id: 'CurtainCall', title: 'Curtain call', storyNodeIds: ['Node109'] },
      ],
      edges: [],
    }, 3);

    expect(graph?.nodes).toEqual([
      {
        id: 'FinalMerge', label: 'Final merge', rowIndex: 0, rowIndexes: [0, 1],
      },
      {
        id: 'CurtainCall', label: 'Curtain call', rowIndex: 2, rowIndexes: [2],
      },
    ]);
  });

  it('coalesces legacy adjacent Plot fragments with the same visible title', () => {
    const graph = buildPersistedPlotGraph({
      version: 2,
      entryPlotNodeId: 'Prologue',
      storyNodeOrder: ['Prologue', 'Node1', 'Node2'],
      nodes: [
        { id: 'Prologue', title: 'Prologue', storyNodeIds: ['Prologue'] },
        { id: 'Node1', title: 'Plot 1', storyNodeIds: ['Node1'] },
        { id: 'Node2', title: 'Plot 1', storyNodeIds: ['Node2'] },
      ],
      edges: [
        {
          fromPlotNodeId: 'Prologue', toPlotNodeId: 'Node1',
          optionText: null, optionIndex: null,
        },
        {
          fromPlotNodeId: 'Node1', toPlotNodeId: 'Node2',
          optionText: null, optionIndex: null,
        },
      ],
    }, 3);

    expect(graph).toEqual({
      nodes: [
        { id: 'Prologue', label: 'Prologue', rowIndex: 0, rowIndexes: [0] },
        { id: 'Node1', label: 'Plot 1', rowIndex: 1, rowIndexes: [1, 2] },
      ],
      edges: [{ from: 'Prologue', to: 'Node1' }],
    });
  });
});
