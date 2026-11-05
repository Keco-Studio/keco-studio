import { projectFlowGraph, visibleFlowOutlets } from './projection';
describe('flow graph projects current rows', () => {
  const group = { nodes: [{ id: 'scene', label: 'Scene', rowIndex: 0, rowIndexes: [0, 1] }], edges: [] };
  it.each(['', 'Jump B'])('hides internal continuation %s in both wires and output pins', Commands => {
    const rows = [{ id: 'a', values: { Label: 'A', Commands } }, { id: 'b', values: { Label: 'B', Commands: 'End' } }];
    const graph = projectFlowGraph(group, rows);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
    expect(visibleFlowOutlets(graph, rows).map(p => p.rowId)).toEqual(['b']);
  });
  it('splits an ended introduction from a later scene without changing Script commands', () => {
    const rows = [{ id: 'a', values: { Content: '人物介绍', Commands: 'End' } }, { id: 'b', values: { Content: '第一幕', Commands: 'Jump C' } }, { id: 'c', values: { Label: 'C', Commands: 'End' } }];
    const graph = projectFlowGraph(group, rows);
    expect(graph.nodes.map(n => n.rowIndexes)).toEqual([[0], [1], [2]]);
    expect(graph.edges).toEqual([{ from: graph.nodes[1].id, to: graph.nodes[2].id }]);
    expect(visibleFlowOutlets(graph, rows).filter(p => p.rowId === 'a')).toEqual([{ rowId: 'a', kind: 'end' }]);
    expect(rows[0].values.Commands).toBe('End');
  });
  it('keeps a real backward jump visible while hiding the forward continuation', () => {
    const rows = [{ id: 'a', values: { Label: 'A', Commands: 'Jump B' } }, { id: 'b', values: { Label: 'B', Commands: 'Jump A' } }];
    const graph = projectFlowGraph(group, rows);
    expect(graph.edges).toEqual([{ from: 'scene', to: 'scene' }]);
    expect(visibleFlowOutlets(graph, rows).map(p => p.rowId)).toEqual(['b']);
  });
  it('keeps both labeled choice outlets even when a choice leads to the next row', () => {
    const rows = [{ id: 'a', values: { Label: 'A', Option1: 'Continue', Option1_Next: 'B', Option2: 'Again', Option2_Next: 'A' } }, { id: 'b', values: { Label: 'B', Commands: 'End' } }];
    const graph = projectFlowGraph(group, rows);
    expect(graph.nodes.map(n => n.rowIndexes)).toEqual([[0], [1]]);
    expect(visibleFlowOutlets(graph, rows).filter(p => p.rowId === 'a').map(p => p.text)).toEqual(['Continue', 'Again']);
  });
  it('ignores stale plot edges and retains explicit self loops and dynamic options', () => {
    const graph = projectFlowGraph({ nodes: [{ id: 'scene', label: 'Scene', rowIndex: 0, rowIndexes: [0, 1] }], edges: [] }, [
      { id: 'a', values: { Label: 'A', Option12: 'Again', Option12_Next: 'A' } }, { id: 'b', values: { Commands: 'End' } },
    ]);
    expect(graph.edges).toEqual([{ from: 'scene', to: 'scene', optionIndex: 12, optionText: 'Again' }]);
  });
  it('includes previously ungrouped rows so they remain navigable', () => {
    expect(projectFlowGraph({ nodes: [], edges: [] }, [{ id: 'a', values: { Content: 'Lost' } }]).nodes[0].rowIndexes).toEqual([0]);
  });
});
