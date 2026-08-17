import type { AssetRow } from '@/lib/types/libraryAssets';
import type { FlowGraph } from './buildScriptFlowGraph';

type RowIdentity = Pick<AssetRow, 'id'>;

function sameRowOrder(left: readonly RowIdentity[], right: readonly RowIdentity[]): boolean {
  return left.length === right.length
    && left.every((row, index) => row.id === right[index]?.id);
}

export function reconcileScriptFlowGraph(input: {
  graph: FlowGraph;
  previousRows: readonly RowIdentity[];
  rows: readonly RowIdentity[];
}): FlowGraph {
  if (sameRowOrder(input.previousRows, input.rows)) return input.graph;
  if (input.graph.nodes.length === 0) return input.graph;

  const ownerByRowId = new Map<string, string>();
  for (const node of input.graph.nodes) {
    for (const index of node.rowIndexes) {
      const rowId = input.previousRows[index]?.id;
      if (rowId) ownerByRowId.set(rowId, node.id);
    }
  }

  const owners = input.rows.map((row) => ownerByRowId.get(row.id) ?? null);
  for (let index = 0; index < owners.length; index += 1) {
    if (owners[index]) continue;
    let owner: string | null = null;
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      if (owners[previous]) {
        owner = owners[previous];
        break;
      }
    }
    if (!owner) {
      for (let next = index + 1; next < owners.length; next += 1) {
        if (owners[next]) {
          owner = owners[next];
          break;
        }
      }
    }
    owners[index] = owner ?? input.graph.nodes[0].id;
  }

  const nodes = input.graph.nodes.flatMap((node) => {
    const rowIndexes = owners.flatMap((owner, index) => (
      owner === node.id ? [index] : []
    ));
    return rowIndexes.length > 0
      ? [{ ...node, rowIndex: rowIndexes[0], rowIndexes }]
      : [];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = input.graph.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  return { nodes, edges };
}
