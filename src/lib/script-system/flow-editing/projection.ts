import type { FlowGraph } from '../buildScriptFlowGraph';
import { analyzeFlow, flowText, type FlowOutlet, type FlowRow } from './model';

/** Only hide an ordinary continuation to the next row inside the same node. */
export function visibleFlowOutlets(graph: FlowGraph, rows: readonly FlowRow[], rowIds = rows.map(r => r.id)): FlowOutlet[] {
  const internalNext = new Map<string, string>();
  for (const node of graph.nodes) {
    node.rowIndexes.forEach((index, offset) => {
      const next = node.rowIndexes[offset + 1];
      if (next !== undefined) internalNext.set(rowIds[index], rowIds[next]);
    });
  }
  return analyzeFlow(rows).outlets.filter(outlet =>
    !((outlet.kind === 'sequence' || outlet.kind === 'jump') && outlet.targetRowId
      && internalNext.get(outlet.rowId) === outlet.targetRowId));
}

export function projectFlowGraph(groups: FlowGraph, rows: readonly FlowRow[]): FlowGraph {
  const owner = new Map<number, string>();
  const outlets = new Map<string, FlowOutlet[]>();
  for (const outlet of analyzeFlow(rows).outlets) {
    outlets.set(outlet.rowId, [...(outlets.get(outlet.rowId) ?? []), outlet]);
  }
  const usedIds = new Set(groups.nodes.map(n => n.id));
  const newId = (row: FlowRow) => {
    let id = `row:${row.id}`;
    while (usedIds.has(id)) id += ':split';
    usedIds.add(id);
    return id;
  };
  const nodes = groups.nodes.flatMap(node => {
    const indexes = [...new Set(node.rowIndexes)].filter(i => rows[i] && !owner.has(i)).sort((a, b) => a - b);
    const segments: number[][] = [];
    for (const index of indexes) {
      const previous = segments.at(-1)?.at(-1);
      const exits = previous === undefined ? [] : outlets.get(rows[previous].id) ?? [];
      const continues = exits.length === 1 && ['sequence', 'jump'].includes(exits[0].kind)
        && exits[0].targetRowId === rows[index].id;
      if (continues) segments[segments.length - 1].push(index);
      else segments.push([index]);
    }
    return segments.map((segment, part) => {
      const id = part === 0 ? node.id : newId(rows[segment[0]]);
      segment.forEach(i => owner.set(i, id));
      return { ...node, id, label: part === 0 ? node.label : flowText(rows[segment[0]].values.Content).slice(0, 60) || 'End', rowIndex: segment[0], rowIndexes: segment };
    });
  });
  rows.forEach((row, index) => {
    if (owner.has(index)) return;
    const id = newId(row);
    owner.set(index, id);
    nodes.push({ id, label: flowText(row.values.Content).slice(0, 60) || 'End', rowIndex: index, rowIndexes: [index] });
  });
  const indexById = new Map(rows.map((r, i) => [r.id, i]));
  const edges = visibleFlowOutlets({ nodes, edges: [] }, rows).flatMap(outlet => {
    if (!outlet.targetRowId) return [];
    const from = owner.get(indexById.get(outlet.rowId)!);
    const to = owner.get(indexById.get(outlet.targetRowId)!);
    if (!from || !to || (from === to && outlet.kind === 'sequence')) return [];
    return [{ from, to, ...(outlet.kind === 'option' ? { optionIndex: outlet.optionIndex, optionText: outlet.text } : {}) }];
  });
  return { nodes, edges };
}
