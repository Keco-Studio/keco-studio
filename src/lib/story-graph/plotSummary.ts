export type PlotEdgeSummary = {
  toPlotNodeId: string;
  optionText: string | null;
  optionIndex: number | null;
};

export type PlotNodeSummary = {
  id: string;
  title: string;
  firstLabel: string;
  lastLabel: string;
  nodeCount: number;
  outgoing: PlotEdgeSummary[];
  storyLabels: string[];
};

export type PlotPlanEdgeSummary = {
  fromPlotNodeId: string;
  toPlotNodeId: string;
  optionText: string | null;
  optionIndex: number | null;
};

type PlotNodeInput = { id?: string; title?: string; storyNodeIds?: string[] };
type PlotEdgeInput = {
  fromPlotNodeId?: string;
  toPlotNodeId?: string;
  optionText?: string | null;
  optionIndex?: number | null;
};

function summarizePlotNodes(
  nodes: PlotNodeInput[],
  edges: PlotEdgeInput[]
): PlotNodeSummary[] {
  const outgoingByPlot = new Map<string, PlotEdgeSummary[]>();
  for (const edge of edges) {
    if (!edge.fromPlotNodeId || !edge.toPlotNodeId) {
      throw new Error('Story graph contains an invalid Plot edge.');
    }
    const outgoing = outgoingByPlot.get(edge.fromPlotNodeId) ?? [];
    outgoing.push({
      toPlotNodeId: edge.toPlotNodeId,
      optionText: edge.optionText ?? null,
      optionIndex: edge.optionIndex ?? null,
    });
    outgoingByPlot.set(edge.fromPlotNodeId, outgoing);
  }

  return nodes.map((node) => {
    if (!node.id || !node.title || !node.storyNodeIds?.length) {
      throw new Error('Story graph contains an invalid Plot node.');
    }
    return {
      id: node.id,
      title: node.title,
      firstLabel: node.storyNodeIds[0],
      lastLabel: node.storyNodeIds[node.storyNodeIds.length - 1],
      nodeCount: node.storyNodeIds.length,
      outgoing: outgoingByPlot.get(node.id) ?? [],
      storyLabels: [...node.storyNodeIds],
    };
  });
}

function coalesceVisiblePlotFragments(
  inputNodes: PlotNodeSummary[],
  inputEdges: PlotEdgeInput[],
  storyNodeOrder: string[]
): { nodes: PlotNodeSummary[]; edges: PlotPlanEdgeSummary[] } {
  const nodes = inputNodes.map((node) => ({
    ...node,
    outgoing: [...node.outgoing],
    storyLabels: [...node.storyLabels],
  }));
  let edges: PlotPlanEdgeSummary[] = inputEdges.map((edge) => {
    if (!edge.fromPlotNodeId || !edge.toPlotNodeId) {
      throw new Error('Story graph contains an invalid Plot edge.');
    }
    return {
      fromPlotNodeId: edge.fromPlotNodeId,
      toPlotNodeId: edge.toPlotNodeId,
      optionText: edge.optionText ?? null,
      optionIndex: edge.optionIndex ?? null,
    };
  });
  const storyIndex = new Map(storyNodeOrder.map((label, index) => [label, index]));

  while (true) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const candidate = edges.find((edge) => {
      if (edge.optionText !== null) return false;
      const from = nodeById.get(edge.fromPlotNodeId);
      const to = nodeById.get(edge.toPlotNodeId);
      if (!from || !to || from.title !== to.title) return false;
      if ((storyIndex.get(from.lastLabel) ?? -1) + 1 !== storyIndex.get(to.firstLabel)) {
        return false;
      }
      return edges.filter((item) => item.fromPlotNodeId === from.id).length === 1
        && edges.filter((item) => item.toPlotNodeId === to.id).length === 1;
    });
    if (!candidate) break;

    const from = nodeById.get(candidate.fromPlotNodeId)!;
    const to = nodeById.get(candidate.toPlotNodeId)!;
    from.storyLabels.push(...to.storyLabels);
    from.lastLabel = to.lastLabel;
    from.nodeCount = from.storyLabels.length;
    nodes.splice(nodes.indexOf(to), 1);
    const edgeKeys = new Set<string>();
    edges = edges.flatMap((edge) => {
      const rewritten = {
        ...edge,
        fromPlotNodeId: edge.fromPlotNodeId === to.id ? from.id : edge.fromPlotNodeId,
        toPlotNodeId: edge.toPlotNodeId === to.id ? from.id : edge.toPlotNodeId,
      };
      if (rewritten.fromPlotNodeId === rewritten.toPlotNodeId) return [];
      const key = JSON.stringify(rewritten);
      if (edgeKeys.has(key)) return [];
      edgeKeys.add(key);
      return [rewritten];
    });
  }

  for (const node of nodes) {
    node.outgoing = edges
      .filter((edge) => edge.fromPlotNodeId === node.id)
      .map((edge) => ({
        toPlotNodeId: edge.toPlotNodeId,
        optionText: edge.optionText,
        optionIndex: edge.optionIndex,
      }));
  }
  return { nodes, edges };
}

export function summarizeVisiblePlotGraph({
  storyNodeOrder,
  nodes,
  edges,
}: {
  storyNodeOrder: string[];
  nodes: PlotNodeInput[];
  edges: PlotEdgeInput[];
}): { nodes: PlotNodeSummary[]; edges: PlotPlanEdgeSummary[] } {
  return coalesceVisiblePlotFragments(
    summarizePlotNodes(nodes, edges),
    edges,
    storyNodeOrder
  );
}
