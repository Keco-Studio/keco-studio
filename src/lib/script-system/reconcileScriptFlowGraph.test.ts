import type { AssetRow } from '@/lib/types/libraryAssets';
import type { FlowGraph } from './buildScriptFlowGraph';
import { reconcileScriptFlowGraph } from './reconcileScriptFlowGraph';

function row(id: string): Pick<AssetRow, 'id'> {
  return { id };
}

const graph: FlowGraph = {
  nodes: [
    { id: 'first', label: 'First', rowIndex: 0, rowIndexes: [0, 1] },
    { id: 'second', label: 'Second', rowIndex: 2, rowIndexes: [2] },
  ],
  edges: [{ from: 'first', to: 'second' }],
};

describe('reconcileScriptFlowGraph', () => {
  it('keeps graph identity and assigns inserted rows to their surrounding node', () => {
    expect(reconcileScriptFlowGraph({
      graph,
      previousRows: [row('a'), row('b'), row('c')],
      rows: [row('a'), row('new'), row('b'), row('c')],
    })).toEqual({
      nodes: [
        { id: 'first', label: 'First', rowIndex: 0, rowIndexes: [0, 1, 2] },
        { id: 'second', label: 'Second', rowIndex: 3, rowIndexes: [3] },
      ],
      edges: [{ from: 'first', to: 'second' }],
    });
  });

  it('tracks rows by id through reorder instead of retaining stale indexes', () => {
    expect(reconcileScriptFlowGraph({
      graph,
      previousRows: [row('a'), row('b'), row('c')],
      rows: [row('c'), row('a'), row('b')],
    }).nodes).toEqual([
      { id: 'first', label: 'First', rowIndex: 1, rowIndexes: [1, 2] },
      { id: 'second', label: 'Second', rowIndex: 0, rowIndexes: [0] },
    ]);
  });

  it('removes an empty node and only its incident edges', () => {
    expect(reconcileScriptFlowGraph({
      graph,
      previousRows: [row('a'), row('b'), row('c')],
      rows: [row('a'), row('b')],
    })).toEqual({
      nodes: [
        { id: 'first', label: 'First', rowIndex: 0, rowIndexes: [0, 1] },
      ],
      edges: [],
    });
  });

  it('returns the same graph object when row ids and order did not change', () => {
    expect(reconcileScriptFlowGraph({
      graph,
      previousRows: [row('a'), row('b'), row('c')],
      rows: [row('a'), row('b'), row('c')],
    })).toBe(graph);
  });
});
