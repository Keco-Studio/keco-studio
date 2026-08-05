import { describe, expect, it } from '@jest/globals';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph';
import type { StoryGraphChange } from './patchEngine';
import { buildStoryGraphEditPreview } from './preview';
import { validateEditableStoryGraph } from './validator';

function node(label: string, rowIndex: number): EditableStoryNode {
  return {
    label,
    plotTitle: label,
    assetId: `asset-${label}`,
    rowIndex,
    nodeType: 'narration',
    speaker: '',
    content: `${label} content`,
    commands: '',
    nextLabel: null,
    terminal: true,
    choices: [],
    values: { Content: `${label} content`, Secret: 'must-not-leak' },
  };
}

function graph(nodes: EditableStoryNode[]): EditableStoryGraph {
  return {
    entryLabel: nodes[0].label,
    nodes,
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

describe('story graph edit preview', () => {
  it('builds a compact public diff with counts, rows, fields, and warnings', () => {
    const before = graph([
      { ...node('Start', 0), nextLabel: 'OldEnd', terminal: false },
      node('OldEnd', 1),
    ]);
    const after = graph([
      {
        ...node('Start', 0),
        terminal: false,
        choices: [{ optionIndex: 0, text: 'Escape', targetLabel: 'EscapeRoute', commands: '' }],
      },
      node('EscapeRoute', 1),
      node('OldEnd', 2),
    ]);
    const changes: StoryGraphChange[] = [
      { type: 'ending_changed', fromLabel: 'Start', fromTargetLabel: 'OldEnd', terminal: true },
      { type: 'node_created', label: 'EscapeRoute', rowIndex: 1, plotTitle: 'Escape ending' },
      {
        type: 'choice_added', fromLabel: 'Start', optionIndex: 0,
        text: 'Escape', targetLabel: 'EscapeRoute',
      },
    ];

    const preview = buildStoryGraphEditPreview({
      libraryId: 'library-1',
      libraryName: 'Story Conversation',
      before,
      after,
      changes,
      addedFields: ['Option3', 'Option3_Next'],
      beforeValidation: validateEditableStoryGraph(before),
      afterValidation: validateEditableStoryGraph(after),
    });

    expect(preview).toMatchObject({
      type: 'story_graph_edit',
      libraryId: 'library-1',
      libraryName: 'Story Conversation',
      createdNodes: [{
        label: 'EscapeRoute',
        contentSummary: 'EscapeRoute content',
        rowIndex: 2,
      }],
      affectedRows: [1, 2],
      addedFields: ['Option3', 'Option3_Next'],
      warnings: [{ code: 'unreachable_node', label: 'OldEnd' }],
    });
    expect(preview.edgeChanges).toEqual([
      {
        kind: 'ending_changed', fromLabel: 'Start',
        fromTarget: 'OldEnd', toTarget: null,
      },
      {
        kind: 'added', fromLabel: 'Start', text: 'Escape',
        fromTarget: null, toTarget: 'EscapeRoute',
      },
    ]);
    expect(JSON.stringify(preview)).not.toContain('must-not-leak');
  });
});

