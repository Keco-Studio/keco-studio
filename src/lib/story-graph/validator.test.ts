import { describe, expect, it } from '@jest/globals';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph';
import { validateEditableStoryGraph } from './validator';

function node(
  label: string,
  overrides: Partial<EditableStoryNode> = {}
): EditableStoryNode {
  return {
    label,
    plotTitle: label,
    assetId: `asset-${label}`,
    rowIndex: 0,
    nodeType: 'narration',
    speaker: '',
    content: label,
    commands: '',
    nextLabel: null,
    terminal: true,
    choices: [],
    values: {},
    ...overrides,
  };
}

function graph(nodes: EditableStoryNode[]): EditableStoryGraph {
  return {
    entryLabel: nodes[0].label,
    nodes: nodes.map((item, index) => ({ ...item, rowIndex: index })),
    plotPlan: {
      version: 2,
      entryPlotNodeId: nodes[0].label,
      storyNodeOrder: nodes.map((item) => item.label),
      nodes: nodes.map((item) => ({
        id: item.label,
        title: item.plotTitle,
        storyNodeIds: [item.label],
      })),
      edges: [],
    },
  };
}

describe('editable story graph validator', () => {
  it('counts a branching DAG and warns without rejecting disconnected content', () => {
    const input = graph([
      node('Start', {
        terminal: false,
        choices: [
          { optionIndex: 0, text: 'Left', targetLabel: 'LeftEnd', commands: '' },
          { optionIndex: 1, text: 'Right', targetLabel: 'RightEnd', commands: '' },
        ],
      }),
      node('LeftEnd'),
      node('RightEnd'),
      node('UnusedEnding'),
    ]);

    const result = validateEditableStoryGraph(input);

    expect(result.warnings).toEqual([
      { code: 'unreachable_node', label: 'UnusedEnding' },
    ]);
    expect(result.summary).toEqual({
      nodeCount: 4,
      edgeCount: 2,
      endingCount: 3,
      unreachableCount: 1,
      entryToEndingPathCount: '2',
    });
  });

  it.each([
    {
      name: 'a missing entry',
      mutate: (input: EditableStoryGraph) => { input.entryLabel = 'Missing'; },
    },
    {
      name: 'a duplicate label',
      mutate: (input: EditableStoryGraph) => { input.nodes[1].label = 'Start'; },
    },
    {
      name: 'an invalid label',
      mutate: (input: EditableStoryGraph) => { input.nodes[1].label = 'not valid'; },
    },
    {
      name: 'a missing target',
      mutate: (input: EditableStoryGraph) => {
        input.nodes[0].nextLabel = 'Missing';
        input.nodes[0].terminal = false;
      },
    },
    {
      name: 'choices plus an ordinary successor',
      mutate: (input: EditableStoryGraph) => {
        input.nodes[0].choices = [
          { optionIndex: 0, text: 'Go', targetLabel: 'End', commands: '' },
        ];
      },
    },
    {
      name: 'more than ten choices',
      mutate: (input: EditableStoryGraph) => {
        input.nodes[0].nextLabel = null;
        input.nodes[0].choices = Array.from({ length: 11 }, (_, optionIndex) => ({
          optionIndex,
          text: String(optionIndex),
          targetLabel: 'End',
          commands: '',
        }));
      },
    },
    {
      name: 'stale story node order',
      mutate: (input: EditableStoryGraph) => {
        if (input.plotPlan.version === 2) input.plotPlan.storyNodeOrder = ['Start'];
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const input = graph([
      node('Start', { nextLabel: 'End', terminal: false }),
      node('End'),
    ]);
    mutate(input);
    expect(() => validateEditableStoryGraph(input)).toThrow(
      expect.objectContaining({ code: 'STORY_GRAPH_INVALID_PATCH' })
    );
  });

  it('rejects a cycle', () => {
    const input = graph([
      node('A', { nextLabel: 'B', terminal: false }),
      node('B', { nextLabel: 'A', terminal: false }),
    ]);
    expect(() => validateEditableStoryGraph(input)).toThrow(
      expect.objectContaining({ code: 'STORY_GRAPH_INVALID_PATCH' })
    );
  });
});

