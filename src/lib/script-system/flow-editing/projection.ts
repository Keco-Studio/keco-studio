import type { FlowGraph } from '../buildScriptFlowGraph';
import { analyzeFlow, flowText, type FlowRow } from './model';
export function projectFlowGraph(groups: FlowGraph, rows: readonly FlowRow[]): FlowGraph {
  const owner = new Map<number, string>();
  const nodes = groups.nodes.flatMap(node => {
    const indexes = node.rowIndexes.filter(i => rows[i] && !owner.has(i));
    indexes.forEach(i => owner.set(i, node.id));
    return indexes.length ? [{ ...node, rowIndex: indexes[0], rowIndexes: indexes }] : [];
  });
  rows.forEach((row, index) => {
    if (owner.has(index)) return;
    const id = `row:${row.id}`;
    owner.set(index, id);
    nodes.push({ id, label: flowText(row.values.Content).slice(0, 60) || 'End', rowIndex: index, rowIndexes: [index] });
  });
  const indexById = new Map(rows.map((r, i) => [r.id, i]));
  const edges = analyzeFlow(rows).outlets.flatMap(outlet => {
    if (!outlet.targetRowId) return [];
    const from = owner.get(indexById.get(outlet.rowId)!);
    const to = owner.get(indexById.get(outlet.targetRowId)!);
    if (!from || !to || (from === to && outlet.kind === 'sequence')) return [];
    return [{ from, to, ...(outlet.kind === 'option' ? { optionIndex: outlet.optionIndex, optionText: outlet.text } : {}) }];
  });
  return { nodes, edges };
}
