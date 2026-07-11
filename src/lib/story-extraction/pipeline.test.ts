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
    { id: 'start', type: 'dialogue', speaker: '七号', content: '选择路线。', sourceUnitIds: ['fixture:0'] },
    { id: 'left', type: 'narration', speaker: '', content: '左边。', sourceUnitIds: ['fixture:3'] },
    { id: 'right', type: 'narration', speaker: '', content: '右边。', sourceUnitIds: ['fixture:4'] },
  ],
  choices: [
    { id: 'left_choice', text: '走左边', sourceUnitIds: ['fixture:1'] },
    { id: 'right_choice', text: '走右边', sourceUnitIds: ['fixture:1'] },
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
    expect(result.choices[0]).toMatchObject({
      id: 'left_choice',
      fromNodeId: 'start',
      targetNodeId: 'left',
      text: '走左边',
      commandSources: ['cmd_left'],
      sourceUnitIds: ['fixture:1'],
    });
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
