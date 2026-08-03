import type { StoryPlotPlan } from './schema';

export function validateStoryPlotPlan(
  plan: StoryPlotPlan,
  storyNodeIds: string[]
): StoryPlotPlan {
  const plotNodesById = new Map<string, StoryPlotPlan['nodes'][number]>();
  for (const node of plan.nodes) {
    if (plotNodesById.has(node.id)) {
      throw new Error(`Duplicate plot node id ${node.id}`);
    }
    plotNodesById.set(node.id, node);
  }

  if (!plotNodesById.has(plan.entryPlotNodeId)) {
    throw new Error(`Unknown entry plot node ${plan.entryPlotNodeId}`);
  }

  const expectedStoryNodeIds = new Set(storyNodeIds);
  const assignedStoryNodeIds = new Set<string>();
  for (const node of plan.nodes) {
    for (const storyNodeId of node.storyNodeIds) {
      if (!expectedStoryNodeIds.has(storyNodeId)) {
        throw new Error(`Unknown story node ${storyNodeId}`);
      }
      if (assignedStoryNodeIds.has(storyNodeId)) {
        throw new Error(`Story node ${storyNodeId} belongs to more than one plot node`);
      }
      assignedStoryNodeIds.add(storyNodeId);
    }
  }
  if (
    assignedStoryNodeIds.size !== expectedStoryNodeIds.size
    || storyNodeIds.some((storyNodeId) => !assignedStoryNodeIds.has(storyNodeId))
  ) {
    throw new Error('Every story node must belong to exactly one plot node');
  }

  const edgeKeys = new Set<string>();
  const optionIndexesBySource = new Map<string, Set<number>>();
  for (const edge of plan.edges) {
    if (
      !plotNodesById.has(edge.fromPlotNodeId)
      || !plotNodesById.has(edge.toPlotNodeId)
    ) {
      throw new Error('Plot edge references an unknown plot node');
    }

    const edgeKey = JSON.stringify([
      edge.fromPlotNodeId,
      edge.toPlotNodeId,
      edge.optionText,
      edge.optionIndex,
    ]);
    if (edgeKeys.has(edgeKey)) {
      throw new Error('Duplicate plot edge');
    }
    edgeKeys.add(edgeKey);

    const ordinaryEdge = edge.optionText === null && edge.optionIndex === null;
    const choiceEdge = edge.optionText !== null
      && edge.optionIndex !== null
      && Number.isInteger(edge.optionIndex)
      && edge.optionIndex >= 0;
    if (!ordinaryEdge && !choiceEdge) {
      throw new Error(
        'Option text and option index must both be null or both identify a nonnegative integer choice'
      );
    }

    if (edge.optionIndex !== null) {
      const sourceIndexes = optionIndexesBySource.get(edge.fromPlotNodeId) ?? new Set<number>();
      if (sourceIndexes.has(edge.optionIndex)) {
        throw new Error(
          `Duplicate option index ${edge.optionIndex} for plot node ${edge.fromPlotNodeId}`
        );
      }
      sourceIndexes.add(edge.optionIndex);
      optionIndexesBySource.set(edge.fromPlotNodeId, sourceIndexes);
    }
  }

  const reachablePlotNodeIds = new Set<string>();
  const pending = [plan.entryPlotNodeId];
  while (pending.length > 0) {
    const plotNodeId = pending.pop()!;
    if (reachablePlotNodeIds.has(plotNodeId)) continue;
    reachablePlotNodeIds.add(plotNodeId);
    for (const edge of plan.edges) {
      if (edge.fromPlotNodeId === plotNodeId) pending.push(edge.toPlotNodeId);
    }
  }
  const unreachableNode = plan.nodes.find((node) => !reachablePlotNodeIds.has(node.id));
  if (unreachableNode) {
    throw new Error(`Unreachable plot node ${unreachableNode.id}`);
  }

  return plan;
}
