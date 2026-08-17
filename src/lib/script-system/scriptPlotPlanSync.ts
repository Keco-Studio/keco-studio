import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import { validateStoryPlotPlan } from '@/lib/story-plot/validator';
import { buildScriptFlowGraph } from './buildScriptFlowGraph';

export type SynchronizedStoryPlotPlan = StoryPlotPlan & {
  version: 2;
  storyNodeOrder: string[];
};

function insertedStoryNodeId(rowId: string, used: Set<string>): string {
  const suffix = rowId.replace(/[^A-Za-z0-9_-]/g, '').replace(/-/g, '') || 'Inserted';
  const base = `Row${suffix}`.slice(0, 60);
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 60 - String(counter).length)}_${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildLocalProjectionPlotPlan(
  rowIds: readonly string[],
  flowRows: Array<Record<string, string>>,
): SynchronizedStoryPlotPlan {
  if (rowIds.length === 0 || rowIds.length !== flowRows.length) {
    throw new Error('PLOT_PLAN_ROW_ORDER_STALE');
  }
  const graph = buildScriptFlowGraph(flowRows);
  const graphNodes = graph.nodes.length > 0
    ? graph.nodes
    : [{ id: 'Plot1', label: '剧情 1', rowIndex: 0, rowIndexes: rowIds.map((_, index) => index) }];
  const ownerByRowIndex = new Map<number, string>();
  for (const node of graphNodes) {
    node.rowIndexes.forEach((rowIndex) => ownerByRowIndex.set(rowIndex, node.id));
  }
  for (let index = 0; index < rowIds.length; index += 1) {
    if (ownerByRowIndex.has(index)) continue;
    const previousOwner = Array.from({ length: index }, (_, offset) => index - offset - 1)
      .map((rowIndex) => ownerByRowIndex.get(rowIndex))
      .find(Boolean);
    const nextOwner = Array.from({ length: rowIds.length - index - 1 }, (_, offset) => index + offset + 1)
      .map((rowIndex) => ownerByRowIndex.get(rowIndex))
      .find(Boolean);
    ownerByRowIndex.set(index, previousOwner ?? nextOwner ?? graphNodes[0].id);
  }

  const usedStoryNodeIds = new Set<string>();
  const storyNodeOrder = rowIds.map((rowId) => (
    insertedStoryNodeId(rowId, usedStoryNodeIds)
  ));
  const nodes = graphNodes.flatMap((node) => {
    const storyNodeIds = storyNodeOrder.filter(
      (_, rowIndex) => ownerByRowIndex.get(rowIndex) === node.id,
    );
    return storyNodeIds.length > 0
      ? [{ id: node.id, title: node.label || node.id, storyNodeIds }]
      : [];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.flatMap((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return [];
    const optionText = edge.optionText?.trim();
    return [{
      fromPlotNodeId: edge.from,
      toPlotNodeId: edge.to,
      ...(optionText && edge.optionIndex !== undefined
        ? { optionText, optionIndex: edge.optionIndex }
        : { optionText: null, optionIndex: null }),
    }];
  });
  const next: SynchronizedStoryPlotPlan = {
    version: 2,
    entryPlotNodeId: nodeIds.has(graphNodes[0].id) ? graphNodes[0].id : nodes[0].id,
    storyNodeOrder,
    nodes,
    edges,
  };
  return validateStoryPlotPlan(
    next,
    storyNodeOrder,
    { allowUnreachable: true },
  ) as SynchronizedStoryPlotPlan;
}

export function patchScriptPlotPlanRowOrder(
  plan: StoryPlotPlan,
  input: { currentRowIds: readonly string[]; nextRowIds: readonly string[] },
): SynchronizedStoryPlotPlan {
  const currentStoryNodeOrder = plan.version === 2
    ? plan.storyNodeOrder
    : plan.nodes.flatMap((node) => node.storyNodeIds);
  if (
    input.currentRowIds.length !== currentStoryNodeOrder.length
    || new Set(input.currentRowIds).size !== input.currentRowIds.length
    || new Set(input.nextRowIds).size !== input.nextRowIds.length
  ) {
    throw new Error('PLOT_PLAN_ROW_ORDER_STALE');
  }

  const storyNodeByRowId = new Map(
    input.currentRowIds.map((rowId, index) => [rowId, currentStoryNodeOrder[index]]),
  );
  const usedStoryNodeIds = new Set(currentStoryNodeOrder);
  const storyNodeOrder = input.nextRowIds.map((rowId) => {
    const existing = storyNodeByRowId.get(rowId);
    if (existing) return existing;
    const inserted = insertedStoryNodeId(rowId, usedStoryNodeIds);
    storyNodeByRowId.set(rowId, inserted);
    return inserted;
  });
  if (storyNodeOrder.length === 0) throw new Error('PLOT_PLAN_EMPTY');

  const ownerByStoryNodeId = new Map<string, string>();
  for (const node of plan.nodes) {
    for (const storyNodeId of node.storyNodeIds) {
      ownerByStoryNodeId.set(storyNodeId, node.id);
    }
  }
  const owners = storyNodeOrder.map((storyNodeId) => (
    ownerByStoryNodeId.get(storyNodeId) ?? null
  ));
  for (let index = 0; index < owners.length; index += 1) {
    if (owners[index]) continue;
    owners[index] = owners.slice(0, index).reverse().find(Boolean)
      ?? owners.slice(index + 1).find(Boolean)
      ?? plan.nodes[0]?.id
      ?? null;
  }

  const nodes = plan.nodes.flatMap((node) => {
    const storyNodeIds = storyNodeOrder.filter((_, index) => owners[index] === node.id);
    return storyNodeIds.length > 0 ? [{ ...node, storyNodeIds }] : [];
  });
  if (nodes.length === 0) throw new Error('PLOT_PLAN_EMPTY');
  const nodeIds = new Set(nodes.map((node) => node.id));
  const next: SynchronizedStoryPlotPlan = {
    version: 2,
    entryPlotNodeId: nodeIds.has(plan.entryPlotNodeId)
      ? plan.entryPlotNodeId
      : nodes[0].id,
    storyNodeOrder,
    nodes,
    edges: plan.edges.filter(
      (edge) => nodeIds.has(edge.fromPlotNodeId) && nodeIds.has(edge.toPlotNodeId),
    ),
  };
  return validateStoryPlotPlan(
    next,
    storyNodeOrder,
    { allowUnreachable: true },
  ) as SynchronizedStoryPlotPlan;
}

export function reconcileScriptPlotPlanRowOrder(
  plan: StoryPlotPlan,
  input: {
    currentRowIds: readonly string[];
    nextRowIds: readonly string[];
    flowRows: Array<Record<string, string>>;
  },
): SynchronizedStoryPlotPlan {
  try {
    return patchScriptPlotPlanRowOrder(plan, input);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'PLOT_PLAN_ROW_ORDER_STALE') {
      throw error;
    }
    return patchScriptPlotPlanRowOrder(
      buildLocalProjectionPlotPlan(input.currentRowIds, input.flowRows),
      input,
    );
  }
}
