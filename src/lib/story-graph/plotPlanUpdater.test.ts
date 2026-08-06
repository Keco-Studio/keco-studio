import { describe, expect, it } from '@jest/globals';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph';
import type { StoryGraphChange } from './patchEngine';
import { updatePlotPlanAfterPatch } from './plotPlanUpdater';

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
    content: `${label} content`,
    commands: '',
    nextLabel: null,
    terminal: true,
    choices: [],
    values: {},
    ...overrides,
  };
}

function fixture(): EditableStoryGraph {
  const nodes = [
    node('Start', { nextLabel: 'Decision', terminal: false }),
    node('Decision', {
      plotTitle: 'Opening',
      terminal: false,
      choices: [{ optionIndex: 0, text: 'Take route', targetLabel: 'Target', commands: '' }],
    }),
    node('Target', { plotTitle: 'Route', nextLabel: 'BranchBody', terminal: false }),
    node('BranchBody', { plotTitle: 'Route', nextLabel: 'Merge', terminal: false }),
    node('Merge', { plotTitle: 'Finale', nextLabel: 'End', terminal: false }),
    node('End', { plotTitle: 'Finale' }),
  ].map((item, rowIndex) => ({ ...item, rowIndex }));
  return {
    entryLabel: 'Start',
    nodes,
    plotPlan: {
      version: 2,
      entryPlotNodeId: 'Start',
      storyNodeOrder: nodes.map((item) => item.label),
      nodes: [
        { id: 'Start', title: 'Opening', storyNodeIds: ['Start', 'Decision'] },
        { id: 'Target', title: 'Route', storyNodeIds: ['Target', 'BranchBody'] },
        { id: 'Merge', title: 'Finale', storyNodeIds: ['Merge', 'End'] },
      ],
      edges: [
        { fromPlotNodeId: 'Start', toPlotNodeId: 'Target', optionText: 'Take route', optionIndex: 0 },
        { fromPlotNodeId: 'Target', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
      ],
    },
  };
}

describe('plot plan updater', () => {
  it('updates the plot entry when a patch changes the story entry', () => {
    const graph = fixture();
    graph.entryLabel = 'Decision';
    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, [{
      type: 'entry_changed',
      fromLabel: 'Start',
      toLabel: 'Decision',
    }]);

    expect(updated.entryPlotNodeId).toBe('Decision');
    expect(updated.nodes).toEqual(expect.arrayContaining([
      { id: 'Start', title: 'Start', storyNodeIds: ['Start'] },
      { id: 'Decision', title: 'Opening', storyNodeIds: ['Decision'] },
    ]));
  });

  it('prepends a new entry Plot without splitting the previous entry Plot', () => {
    const graph = fixture();
    graph.nodes.unshift(node('Prologue', {
      plotTitle: '开场白',
      content: '你好',
      nextLabel: 'Start',
      terminal: false,
    }));
    graph.nodes.forEach((item, rowIndex) => { item.rowIndex = rowIndex; });
    graph.entryLabel = 'Prologue';

    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, [
      {
        type: 'node_created',
        label: 'Prologue',
        rowIndex: 0,
        plotTitle: '开场白',
        insertBeforeLabel: 'Start',
      },
      { type: 'entry_changed', fromLabel: 'Start', toLabel: 'Prologue' },
    ]);

    expect(updated.entryPlotNodeId).toBe('Prologue');
    expect(updated.nodes).toEqual(expect.arrayContaining([
      { id: 'Prologue', title: '开场白', storyNodeIds: ['Prologue'] },
      { id: 'Start', title: 'Opening', storyNodeIds: ['Start', 'Decision'] },
    ]));
    expect(updated.nodes.filter((item) => item.title === 'Opening')).toHaveLength(1);
  });

  it('splits changed decision and target boundaries while preserving unaffected groups', () => {
    const graph = fixture();
    const previousFinale = graph.plotPlan.nodes.find((item) => item.id === 'Merge');
    const changes: StoryGraphChange[] = [{
      type: 'choice_added',
      fromLabel: 'Decision',
      optionIndex: 0,
      text: 'Take route',
      targetLabel: 'Target',
    }];

    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, changes);

    expect(updated.nodes.find((item) => item.id === 'Merge')).toEqual(previousFinale);
    expect(updated.nodes).toEqual(expect.arrayContaining([
      { id: 'Start', title: 'Opening', storyNodeIds: ['Start'] },
      { id: 'Decision', title: 'Opening', storyNodeIds: ['Decision'] },
      { id: 'Target', title: 'Take route', storyNodeIds: ['Target'] },
      { id: 'BranchBody', title: 'Route', storyNodeIds: ['BranchBody'] },
    ]));
    expect(updated.edges).toEqual(expect.arrayContaining([
      { fromPlotNodeId: 'Start', toPlotNodeId: 'Decision', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'Decision', toPlotNodeId: 'Target', optionText: 'Take route', optionIndex: 0 },
      { fromPlotNodeId: 'Target', toPlotNodeId: 'BranchBody', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'BranchBody', toPlotNodeId: 'Merge', optionText: null, optionIndex: null },
    ]));
  });

  it('creates a standalone plot node with an explicit patch title', () => {
    const graph = fixture();
    graph.nodes.push(node('EscapeRoute', {
      rowIndex: graph.nodes.length,
      plotTitle: 'Escape ending',
    }));
    const changes: StoryGraphChange[] = [{
      type: 'node_created', label: 'EscapeRoute', rowIndex: 6, plotTitle: 'Escape ending',
    }];

    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, changes);
    expect(updated.nodes.find((item) => item.id === 'EscapeRoute')).toEqual({
      id: 'EscapeRoute', title: 'Escape ending', storyNodeIds: ['EscapeRoute'],
    });
    expect(updated.storyNodeOrder).toEqual(graph.nodes.map((item) => item.label));
  });

  it('keeps the last Story node in its Plot when appending a new final Plot', () => {
    const graph = fixture();
    const end = graph.nodes.find((item) => item.label === 'End')!;
    end.nextLabel = 'CurtainCall';
    end.terminal = false;
    graph.nodes.push(node('CurtainCall', {
      rowIndex: graph.nodes.length,
      plotTitle: '谢幕',
      content: '再见',
    }));

    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, [
      {
        type: 'node_created',
        label: 'CurtainCall',
        rowIndex: 6,
        plotTitle: '谢幕',
      },
      {
        type: 'next_changed',
        fromLabel: 'End',
        fromTargetLabel: null,
        toTargetLabel: 'CurtainCall',
      },
    ]);

    expect(updated.nodes).toEqual(expect.arrayContaining([
      { id: 'Merge', title: 'Finale', storyNodeIds: ['Merge', 'End'] },
      { id: 'CurtainCall', title: '谢幕', storyNodeIds: ['CurtainCall'] },
    ]));
    expect(updated.nodes).not.toContainEqual({
      id: 'End', title: 'Finale', storyNodeIds: ['End'],
    });
    expect(updated.edges).toContainEqual({
      fromPlotNodeId: 'Merge',
      toPlotNodeId: 'CurtainCall',
      optionText: null,
      optionIndex: null,
    });
  });

  it('rederives redirect edges only from the executable graph', () => {
    const graph = fixture();
    graph.nodes.find((item) => item.label === 'Decision')!.choices[0].targetLabel = 'Merge';
    const updated = updatePlotPlanAfterPatch(graph.plotPlan, graph, [{
      type: 'choice_redirected',
      fromLabel: 'Decision',
      optionIndex: 0,
      text: 'Take route',
      fromTargetLabel: 'Target',
      toTargetLabel: 'Merge',
    }]);
    expect(updated.edges).toContainEqual({
      fromPlotNodeId: 'Decision',
      toPlotNodeId: 'Merge',
      optionText: 'Take route',
      optionIndex: 0,
    });
    expect(updated.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ toPlotNodeId: 'Target', optionText: 'Take route' }),
    ]));
  });

  it('keeps a disconnected plot node so the caller can show an unreachable warning', () => {
    const graph = fixture();
    graph.nodes.find((item) => item.label === 'Decision')!.choices = [];
    graph.nodes.find((item) => item.label === 'Decision')!.terminal = true;
    expect(() => updatePlotPlanAfterPatch(graph.plotPlan, graph, [{
      type: 'choice_removed',
      fromLabel: 'Decision',
      optionIndex: 0,
      text: 'Take route',
      targetLabel: 'Target',
    }])).not.toThrow();
  });
});
