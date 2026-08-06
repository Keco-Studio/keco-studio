import type { FlowGraph } from './buildScriptFlowGraph';
import { parseStoryPlotPlan } from '@/lib/story-plot/schema';
import { validateStoryPlotPlan } from '@/lib/story-plot/validator';

export function buildPersistedPlotGraph(
  value: unknown,
  rowCount: number
): FlowGraph | undefined {
  try {
    const parsed = parseStoryPlotPlan(value);
    const storyNodeIds = parsed.version === 2
      ? parsed.storyNodeOrder
      : parsed.nodes.flatMap((node) => node.storyNodeIds);
    if (storyNodeIds.length !== rowCount) return undefined;
    const plan = validateStoryPlotPlan(parsed, storyNodeIds, { allowUnreachable: true });
    const rowIndexByStoryNodeId = new Map(
      storyNodeIds.map((storyNodeId, rowIndex) => [storyNodeId, rowIndex])
    );

    return coalesceLegacyPlotFragments({
      nodes: plan.nodes.map((node) => {
        const rowIndexes = node.storyNodeIds.map((storyNodeId) => (
          rowIndexByStoryNodeId.get(storyNodeId)!
        ));
        return {
          id: node.id,
          label: node.title,
          rowIndex: rowIndexes[0],
          rowIndexes,
        };
      }),
      edges: plan.edges.map((edge) => edge.optionText === null ? {
        from: edge.fromPlotNodeId,
        to: edge.toPlotNodeId,
      } : {
        from: edge.fromPlotNodeId,
        to: edge.toPlotNodeId,
        optionText: edge.optionText,
        optionIndex: edge.optionIndex,
      }),
    });
  } catch {
    return undefined;
  }
}

function coalesceLegacyPlotFragments(graph: FlowGraph): FlowGraph {
  const nodes = graph.nodes.map((node) => ({ ...node, rowIndexes: [...node.rowIndexes] }));
  let edges = graph.edges.map((edge) => ({ ...edge }));

  while (true) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const candidate = edges.find((edge) => {
      if (edge.optionText !== undefined) return false;
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to || from.label !== to.label) return false;
      const fromLastRow = Math.max(...from.rowIndexes);
      const toFirstRow = Math.min(...to.rowIndexes);
      if (fromLastRow + 1 !== toFirstRow) return false;
      return edges.filter((item) => item.from === from.id).length === 1
        && edges.filter((item) => item.to === to.id).length === 1;
    });
    if (!candidate) break;

    const from = nodeById.get(candidate.from)!;
    const to = nodeById.get(candidate.to)!;
    from.rowIndexes = [...from.rowIndexes, ...to.rowIndexes].sort((left, right) => left - right);
    from.rowIndex = from.rowIndexes[0] ?? from.rowIndex;
    nodes.splice(nodes.indexOf(to), 1);
    const edgeKeys = new Set<string>();
    edges = edges.flatMap((edge) => {
      const rewritten = {
        ...edge,
        from: edge.from === to.id ? from.id : edge.from,
        to: edge.to === to.id ? from.id : edge.to,
      };
      if (rewritten.from === rewritten.to) return [];
      const key = JSON.stringify(rewritten);
      if (edgeKeys.has(key)) return [];
      edgeKeys.add(key);
      return [rewritten];
    });
  }

  return { nodes, edges };
}
