import { projectFlowGraph } from './projection';
describe('flow graph projects current rows', () => {
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
