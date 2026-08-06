import { describe, expect, it } from '@jest/globals';
import { summarizeVisiblePlotGraph } from './plotSummary';

describe('visible plot graph summary', () => {
  it('coalesces consecutive ordinary fragments with the same title', () => {
    const result = summarizeVisiblePlotGraph({
      storyNodeOrder: ['Intro', 'Decision', 'Ending'],
      nodes: [
        { id: 'OpeningA', title: 'Opening', storyNodeIds: ['Intro'] },
        { id: 'OpeningB', title: 'Opening', storyNodeIds: ['Decision'] },
        { id: 'Ending', title: 'Ending', storyNodeIds: ['Ending'] },
      ],
      edges: [
        {
          fromPlotNodeId: 'OpeningA',
          toPlotNodeId: 'OpeningB',
          optionText: null,
          optionIndex: null,
        },
        {
          fromPlotNodeId: 'OpeningB',
          toPlotNodeId: 'Ending',
          optionText: 'Leave',
          optionIndex: 0,
        },
      ],
    });

    expect(result).toEqual({
      nodes: [
        {
          id: 'OpeningA',
          title: 'Opening',
          firstLabel: 'Intro',
          lastLabel: 'Decision',
          nodeCount: 2,
          outgoing: [{
            toPlotNodeId: 'Ending',
            optionText: 'Leave',
            optionIndex: 0,
          }],
          storyLabels: ['Intro', 'Decision'],
        },
        {
          id: 'Ending',
          title: 'Ending',
          firstLabel: 'Ending',
          lastLabel: 'Ending',
          nodeCount: 1,
          outgoing: [],
          storyLabels: ['Ending'],
        },
      ],
      edges: [{
        fromPlotNodeId: 'OpeningA',
        toPlotNodeId: 'Ending',
        optionText: 'Leave',
        optionIndex: 0,
      }],
    });
  });
});
