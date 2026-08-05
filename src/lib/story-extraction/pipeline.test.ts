import { describe, expect, it } from '@jest/globals';
import {
  combineStoryExtraction,
  normalizeStoryContentExtractionContract,
  normalizeStoryGraphExtractionContract,
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

  it('normalizes safe near-contract Extractor output without changing evidence', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: '3',
      structuralUnitIds: ['fixture:0', 12],
      nodes: [
        {
          id: 'invalid scene id',
          type: 'action',
          speaker: '',
          content: '\u706f\u5149\u7184\u706d。',
          sourceUnitIds: ['fixture:1'],
          nextNodeId: 'model-added-extra',
        },
        {
          id: 'dialogue',
          type: 'dialogue',
          speaker: '\u6797\u9ed8',
          content: '\u6211\u4eec\u56de\u6765\u4e86。',
          sourceUnitIds: ['fixture:2'],
        },
      ],
      choices: [{
        id: 'invalid choice id',
        text: '\u7ee7\u7eed\u524d\u8fdb',
        sourceUnitIds: ['fixture:3'],
        targetNodeId: 'model-added-extra',
      }],
      explanation: 'extra prose field',
    });

    expect(normalized).toEqual({
      version: 3,
      structuralUnitIds: ['fixture:0'],
      nodes: [
        {
          id: 'Node1', type: 'narration', presentationType: 3, speaker: '',
          content: '\u706f\u5149\u7184\u706d。', sourceUnitIds: ['fixture:1'],
        },
        {
          id: 'dialogue', type: 'dialogue', presentationType: 1, speaker: '\u6797\u9ed8',
          content: '\u6211\u4eec\u56de\u6765\u4e86。', sourceUnitIds: ['fixture:2'],
        },
      ],
      choices: [{ id: 'Choice1', text: '\u7ee7\u7eed\u524d\u8fdb', sourceUnitIds: ['fixture:3'] }],
    });
  });

  it('removes exact duplicate visible claims before graph planning', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [
        {
          id: 'first', type: 'narration', presentationType: 3, speaker: '',
          content: '\u98ce\u5439\u8fc7\u5730\u94c1\u53e3。', sourceUnitIds: ['modal:test:56'],
        },
        {
          id: 'duplicate', type: 'narration', presentationType: 3, speaker: '',
          content: '\u98ce\u5439\u8fc7\u5730\u94c1\u53e3。', sourceUnitIds: ['modal:test:56'],
        },
      ],
      choices: [],
    });

    expect(normalized.nodes.map((node) => node.id)).toEqual(['first']);
  });

  it('merges partially overlapping duplicate node claims before graph planning', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [
        {
          id: 'first', type: 'narration', presentationType: 3, speaker: '',
          content: '\u963f\u57ce\u63e1\u7740\u90a3\u628a\u82b1。', sourceUnitIds: ['modal:test:55', 'modal:test:56'],
        },
        {
          id: 'duplicate', type: 'narration', presentationType: 3, speaker: '',
          content: '\u963f\u57ce\u63e1\u7740\u90a3\u628a\u82b1。', sourceUnitIds: ['modal:test:56', 'modal:test:57'],
        },
      ],
      choices: [],
    });

    expect(normalized.nodes).toEqual([
      expect.objectContaining({
        id: 'first',
        sourceUnitIds: ['modal:test:55', 'modal:test:56', 'modal:test:57'],
      }),
    ]);
  });

  it('keeps a choice and drops an option-preview node claiming the same source text', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [
        {
          id: 'prompt', type: 'narration', presentationType: 3, speaker: '',
          content: '\u963f\u57ce\u4e70\u4e0d\u4e70\u82b1？', sourceUnitIds: ['modal:test:55'],
        },
        {
          id: 'preview', type: 'narration', presentationType: 3, speaker: '',
          content: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'],
        },
      ],
      choices: [{ id: 'buy', text: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'] }],
    });

    expect(normalized.nodes.map((node) => node.id)).toEqual(['prompt']);
    expect(normalized.choices.map((choice) => choice.id)).toEqual(['buy']);
  });

  it('recognizes a labeled choice as the same claim as its option-preview node', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [
        {
          id: 'prompt', type: 'narration', presentationType: 3, speaker: '',
          content: '\u963f\u57ce\u4e70\u4e0d\u4e70\u82b1？', sourceUnitIds: ['modal:test:55'],
        },
        {
          id: 'preview', type: 'narration', presentationType: 3, speaker: '',
          content: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'],
        },
      ],
      choices: [{ id: 'buy', text: '\u9009\u62e9 A（\u4e70\u82b1）', sourceUnitIds: ['modal:test:56'] }],
    });

    expect(normalized.nodes.map((node) => node.id)).toEqual(['prompt']);
  });

  it('merges duplicate choices claiming the same option source unit', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [{
        id: 'prompt', type: 'narration', presentationType: 3, speaker: '',
        content: '\u963f\u57ce\u4e70\u4e0d\u4e70\u82b1？', sourceUnitIds: ['modal:test:55'],
      }],
      choices: [
        { id: 'buy', text: '\u9009\u62e9 A（\u4e70\u82b1）', sourceUnitIds: ['modal:test:56'] },
        { id: 'buy_again', text: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'] },
      ],
    });

    expect(normalized.choices).toEqual([
      expect.objectContaining({ id: 'buy', text: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'] }),
    ]);
  });

  it('removes only the choice-owned unit from a partially overlapping preview node', () => {
    const normalized = normalizeStoryContentExtractionContract({
      version: 3,
      structuralUnitIds: [],
      nodes: [
        {
          id: 'prompt', type: 'narration', presentationType: 3, speaker: '',
          content: '\u963f\u57ce\u4e70\u4e0d\u4e70\u82b1？', sourceUnitIds: ['modal:test:55'],
        },
        {
          id: 'preview', type: 'narration', presentationType: 3, speaker: '',
          content: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56', 'modal:test:57'],
        },
      ],
      choices: [{ id: 'buy', text: '\u4e70\u82b1', sourceUnitIds: ['modal:test:56'] }],
    });

    expect(normalized.nodes.find((node) => node.id === 'preview')?.sourceUnitIds)
      .toEqual(['modal:test:57']);
  });

  it('normalizes omitted empty Graph Planner arrays without changing links', () => {
    expect(normalizeStoryGraphExtractionContract({
      version: '3',
      entryNodeId: 'start',
      nodeLinks: ['start->end', 'end->'],
    })).toEqual({
      version: 3,
      entryNodeId: 'start',
      nodeLinks: ['start->end', 'end->'],
      choiceLinks: [],
      commandLinks: [],
    });
  });

  it('fills missing ordinary node links without crossing sibling choice targets', () => {
    const normalized = normalizeStoryGraphExtractionContract({
      version: 3,
      entryNodeId: 'start',
      nodeLinks: ['start->'],
      choiceLinks: [
        'left_choice->start->left',
        'right_choice->start->right',
      ],
      commandLinks: [],
    }, parseStoryContentExtraction(content));

    expect(normalized.nodeLinks).toEqual([
      'start->',
      'left->',
      'right->',
    ]);
  });

  it('normalizes structured Graph Planner edges into the canonical link format', () => {
    expect(normalizeStoryGraphExtractionContract({
      version: 3,
      entryNodeId: 'start',
      nodeLinks: [
        { nodeId: 'start', nextNodeId: '' },
        { nodeId: 'left', nextNodeId: '' },
        { nodeId: 'right', nextNodeId: '' },
      ],
      choiceLinks: [
        { choiceId: 'left_choice', fromNodeId: 'start', targetNodeId: 'left' },
        { choiceId: 'right_choice', fromNodeId: 'start', targetNodeId: 'right' },
      ],
      commandLinks: [
        { commandId: 'cmd_left', kind: 'choice', ownerId: 'left_choice' },
      ],
    })).toEqual({
      version: 3,
      entryNodeId: 'start',
      nodeLinks: ['start->', 'left->', 'right->'],
      choiceLinks: ['left_choice->start->left', 'right_choice->start->right'],
      commandLinks: ['cmd_left->choice->left_choice'],
    });
  });
});
