import { describe, expect, it } from '@jest/globals';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph';
import { applyStoryGraphPatch, StoryGraphPatchError } from './patchEngine';

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
    values: { Label: label, Type: '3', Content: label, Commands: 'End' },
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

describe('story graph patch engine', () => {
  it('inserts a prologue before the current entry and makes it the new entry', () => {
    const before = graph([
      node('Node1', { nextLabel: 'Node2', terminal: false }),
      node('Node2'),
    ]);

    const result = applyStoryGraphPatch(before, {
      operations: [
        {
          type: 'create_node',
          node: {
            label: 'Prologue',
            nodeType: 'narration',
            plotTitle: 'Prologue',
            content: 'Hello',
            nextLabel: 'Node1',
          },
          insertBeforeLabel: 'Node1',
        },
        { type: 'set_entry', entryLabel: 'Prologue' },
      ],
    });

    expect(result.graph.entryLabel).toBe('Prologue');
    expect(result.graph.nodes.map((item) => item.label)).toEqual(['Prologue', 'Node1', 'Node2']);
    expect(result.graph.nodes[0]).toMatchObject({
      nextLabel: 'Node1',
      content: 'Hello',
      plotTitle: 'Prologue',
    });
    expect(result.changes).toEqual([
      expect.objectContaining({ type: 'node_created', label: 'Prologue', rowIndex: 0 }),
      { type: 'entry_changed', fromLabel: 'Node1', toLabel: 'Prologue' },
    ]);
  });

  it('applies ordered operations to create a new branch without discarding the old route', () => {
    const before = graph([
      node('Intro', { nextLabel: 'Decision', terminal: false }),
      node('Decision', { nextLabel: 'OldEnd', terminal: false }),
      node('OldEnd'),
    ]);

    const result = applyStoryGraphPatch(before, {
      operations: [
        { type: 'set_end', fromLabel: 'Decision' },
        {
          type: 'create_node',
          node: {
            label: 'EscapeRoute',
            nodeType: 'narration',
            content: 'The hero leaves through the back door.',
            plotTitle: 'Escape ending',
          },
          insertAfterLabel: 'Decision',
        },
        {
          type: 'add_choice',
          fromLabel: 'Decision',
          text: 'Escape',
          targetLabel: 'EscapeRoute',
        },
      ],
    });

    expect(before.nodes).toHaveLength(3);
    expect(result.graph.nodes.map((item) => item.label)).toEqual([
      'Intro', 'Decision', 'EscapeRoute', 'OldEnd',
    ]);
    expect(result.graph.nodes.find((item) => item.label === 'Decision')).toMatchObject({
      nextLabel: null,
      terminal: false,
      choices: [{
        optionIndex: 0,
        text: 'Escape',
        targetLabel: 'EscapeRoute',
        commands: '',
      }],
    });
    expect(result.changes.map((change) => change.type)).toEqual([
      'ending_changed', 'node_created', 'choice_added',
    ]);
  });

  it('redirects and removes choices while sealing their previous values', () => {
    const before = graph([
      node('Decision', {
        terminal: false,
        choices: [
          { optionIndex: 0, text: 'Left', targetLabel: 'LeftEnd', commands: '' },
          { optionIndex: 2, text: 'Right', targetLabel: 'RightEnd', commands: '$trust+=1' },
        ],
      }),
      node('LeftEnd'),
      node('RightEnd'),
    ]);

    const result = applyStoryGraphPatch(before, {
      operations: [
        {
          type: 'redirect_choice',
          fromLabel: 'Decision',
          optionIndex: 0,
          targetLabel: 'RightEnd',
        },
        { type: 'remove_choice', fromLabel: 'Decision', optionIndex: 2 },
      ],
    });

    expect(result.normalizedPatch.operations).toEqual([
      expect.objectContaining({
        type: 'redirect_choice',
        expectedText: 'Left',
        expectedTargetLabel: 'LeftEnd',
      }),
      expect.objectContaining({
        type: 'remove_choice',
        expectedText: 'Right',
        expectedTargetLabel: 'RightEnd',
      }),
    ]);
    expect(result.graph.nodes[0].choices).toEqual([
      { optionIndex: 0, text: 'Left', targetLabel: 'RightEnd', commands: '' },
    ]);
  });

  it('sets an ordinary next edge and allocates the first free choice slot', () => {
    const before = graph([
      node('Start'),
      node('Target'),
      node('Decision', {
        terminal: false,
        choices: [{ optionIndex: 1, text: 'Existing', targetLabel: 'Target', commands: '' }],
      }),
    ]);

    const result = applyStoryGraphPatch(before, {
      operations: [
        { type: 'set_next', fromLabel: 'Start', targetLabel: 'Target' },
        { type: 'add_choice', fromLabel: 'Decision', text: 'New', targetLabel: 'Start' },
      ],
    });

    expect(result.graph.nodes[0]).toMatchObject({
      nextLabel: 'Target',
      terminal: false,
    });
    expect(
      result.graph.nodes[2].choices.find((choice) => choice.optionIndex === 0)
    ).toMatchObject({ optionIndex: 0, text: 'New' });
  });

  it('resolves exact labels before exact plot-title fallback', () => {
    const before = graph([
      node('Opening', { plotTitle: 'Shared title' }),
      node('Target', { plotTitle: 'Opening' }),
    ]);

    const result = applyStoryGraphPatch(before, {
      operations: [{ type: 'set_next', fromLabel: 'Opening', targetLabel: 'Target' }],
    });
    expect(result.graph.nodes[0].nextLabel).toBe('Target');
  });

  it('rejects ambiguous exact plot titles with candidate labels', () => {
    const before = graph([
      node('A', { plotTitle: 'Shared' }),
      node('B', { plotTitle: 'Shared' }),
      node('End'),
    ]);

    expect(() => applyStoryGraphPatch(before, {
      operations: [{ type: 'set_next', fromLabel: 'Shared', targetLabel: 'End' }],
    })).toThrow(expect.objectContaining({
      code: 'STORY_GRAPH_AMBIGUOUS_NODE',
      candidates: ['A', 'B'],
    }));
  });

  it('rejects operations that silently discard an existing route or choice set', () => {
    const before = graph([
      node('Linear', { nextLabel: 'End', terminal: false }),
      node('Decision', {
        terminal: false,
        choices: [{ optionIndex: 0, text: 'Go', targetLabel: 'End', commands: '' }],
      }),
      node('End'),
    ]);

    for (const operations of [
      [{ type: 'add_choice', fromLabel: 'Linear', text: 'New', targetLabel: 'End' }],
      [{ type: 'set_next', fromLabel: 'Decision', targetLabel: 'End' }],
      [{ type: 'set_end', fromLabel: 'Decision' }],
    ] as const) {
      expect(() => applyStoryGraphPatch(before, { operations: [...operations] }))
        .toThrow(StoryGraphPatchError);
    }
  });
});
