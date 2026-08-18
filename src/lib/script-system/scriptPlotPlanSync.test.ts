import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import {
  patchScriptPlotPlanRowOrder,
  reconcileScriptPlotPlanRowOrder,
} from './scriptPlotPlanSync';

const plan: StoryPlotPlan = {
  version: 2,
  entryPlotNodeId: 'Opening',
  storyNodeOrder: ['LineA', 'LineB', 'LineC'],
  nodes: [
    { id: 'Opening', title: 'Opening', storyNodeIds: ['LineA', 'LineB'] },
    { id: 'Ending', title: 'Ending', storyNodeIds: ['LineC'] },
  ],
  edges: [{
    fromPlotNodeId: 'Opening',
    toPlotNodeId: 'Ending',
    optionText: null,
    optionIndex: null,
  }],
};

describe('patchScriptPlotPlanRowOrder', () => {
  it('reorders story nodes by stable table row id without replacing graph identity', () => {
    expect(patchScriptPlotPlanRowOrder(plan, {
      currentRowIds: ['row-a', 'row-b', 'row-c'],
      nextRowIds: ['row-c', 'row-a', 'row-b'],
    })).toEqual({
      ...plan,
      storyNodeOrder: ['LineC', 'LineA', 'LineB'],
      nodes: [
        { id: 'Opening', title: 'Opening', storyNodeIds: ['LineA', 'LineB'] },
        { id: 'Ending', title: 'Ending', storyNodeIds: ['LineC'] },
      ],
    });
  });

  it('adds a deterministic story id to the surrounding plot node', () => {
    const next = patchScriptPlotPlanRowOrder(plan, {
      currentRowIds: ['row-a', 'row-b', 'row-c'],
      nextRowIds: [
        'row-a',
        '66666666-6666-4666-8666-666666666666',
        'row-b',
        'row-c',
      ],
    });

    expect(next.storyNodeOrder).toEqual([
      'LineA',
      'Row66666666666646668666666666666666',
      'LineB',
      'LineC',
    ]);
    expect(next.nodes[0].storyNodeIds).toEqual([
      'LineA',
      'Row66666666666646668666666666666666',
      'LineB',
    ]);
  });

  it('removes deleted story nodes and empty plot nodes with their edges', () => {
    expect(patchScriptPlotPlanRowOrder(plan, {
      currentRowIds: ['row-a', 'row-b', 'row-c'],
      nextRowIds: ['row-a', 'row-b'],
    })).toEqual({
      version: 2,
      entryPlotNodeId: 'Opening',
      storyNodeOrder: ['LineA', 'LineB'],
      nodes: [{ id: 'Opening', title: 'Opening', storyNodeIds: ['LineA', 'LineB'] }],
      edges: [],
    });
  });

  it('rejects a stale current row order', () => {
    expect(() => patchScriptPlotPlanRowOrder(plan, {
      currentRowIds: ['row-a', 'row-b'],
      nextRowIds: ['row-b', 'row-a'],
    })).toThrow('PLOT_PLAN_ROW_ORDER_STALE');
  });

  it('rebuilds an already-stale plan from the current local Flow projection before reordering', () => {
    const currentRowIds = ['row-a', 'row-new-action', 'row-new-speech', 'row-b'];
    const next = reconcileScriptPlotPlanRowOrder(plan, {
      currentRowIds,
      nextRowIds: ['row-b', 'row-a', 'row-new-action', 'row-new-speech'],
      flowRows: [
        { Label: 'Start', Type: '3', Content: 'Opening' },
        { Type: '3', Name: 'Cara', Content: '' },
        { Type: '2', Name: 'Cara', Content: 'New line' },
        { Label: 'Ending', Type: '2', Name: 'Ben', Content: 'Wait' },
      ],
    });

    expect(next.storyNodeOrder).toHaveLength(4);
    expect(new Set(next.storyNodeOrder).size).toBe(4);
    expect(next.nodes.flatMap((node) => node.storyNodeIds)).toEqual(
      expect.arrayContaining(next.storyNodeOrder),
    );
    expect(next.nodes[0]).toEqual(expect.objectContaining({ id: 'Start' }));
  });
});
