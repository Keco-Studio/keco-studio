import { describe, expect, it } from '@jest/globals';
import {
  combineStoryExtraction,
  parseStoryContentExtraction,
  parseStoryGraphExtraction,
} from './pipeline';

const content = {
  version: 3,
  structuralUnitIds: ['fixture:2'],
  nodes: [
    { id: 'start', type: 'dialogue', presentationType: 2, speaker: 'Seven', content: 'Pick a route.', sourceUnitIds: ['fixture:0'] },
    { id: 'left', type: 'narration', presentationType: 4, speaker: '', content: 'The left side.', sourceUnitIds: ['fixture:3'] },
    { id: 'right', type: 'narration', presentationType: 3, speaker: '', content: 'The right side.', sourceUnitIds: ['fixture:4'] },
  ],
  choices: [
    { id: 'left_choice', text: 'Go left', sourceUnitIds: ['fixture:1'] },
    { id: 'right_choice', text: 'Go right', sourceUnitIds: ['fixture:1'] },
  ],
};

const graph = {
  version: 3,
  entryNodeId: 'start',
  nodeLinks: ['start->', 'left->', 'right->'],
  choiceLinks: ['left_choice->start->left', 'right_choice->start->right'],
  commandLinks: ['cmd_left->choice->left_choice', 'cmd_right->choice->right_choice'],
};

describe('two-stage story extraction pipeline', () => {
  it('combines LLM-created content inventory with a flat graph plan', () => {
    const result = combineStoryExtraction(
      parseStoryContentExtraction(content),
      parseStoryGraphExtraction(graph)
    );

    expect(result.entryNodeId).toBe('start');
    expect(result.nodes[0].nextNodeId).toBe('');
    expect(result.nodes.map((node) => node.presentationType)).toEqual([2, 4, 3]);
    expect(result.choices[0]).toMatchObject({
      id: 'left_choice',
      fromNodeId: 'start',
      targetNodeId: 'left',
      text: 'Go left',
      commandSources: ['cmd_left'],
      sourceUnitIds: ['fixture:1'],
    });
  });

  it('discards an automatic edge from a node whose choices already define its successors', () => {
    const result = combineStoryExtraction(
      parseStoryContentExtraction(content),
      parseStoryGraphExtraction({
        ...graph,
        nodeLinks: ['start->left', 'left->', 'right->'],
      })
    );

    expect(result.nodes.find((node) => node.id === 'start')?.nextNodeId).toBe('');
  });

  it('rejects missing, duplicate, or unknown graph edges', () => {
    expect(() => combineStoryExtraction(
      parseStoryContentExtraction(content),
      parseStoryGraphExtraction({ ...graph, choiceLinks: graph.choiceLinks.slice(1) })
    )).toThrow(/choice.*(?:edges|arrays)/i);
    expect(() => combineStoryExtraction(
      parseStoryContentExtraction(content),
      parseStoryGraphExtraction({ ...graph, nodeLinks: [...graph.nodeLinks, graph.nodeLinks[0]] })
    )).toThrow(/node.*(?:edges|arrays)/i);
    expect(() => combineStoryExtraction(
      parseStoryContentExtraction(content),
      parseStoryGraphExtraction({
        ...graph,
        choiceLinks: ['left_choice->start->missing', 'right_choice->start->right'],
      })
    )).toThrow(/unknown node/i);
  });
});
