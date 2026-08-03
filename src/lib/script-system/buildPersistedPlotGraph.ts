import type { FlowGraph } from './buildScriptFlowGraph';
import { parseStoryPlotPlan } from '@/lib/story-plot/schema';
import { validateStoryPlotPlan } from '@/lib/story-plot/validator';

export function buildPersistedPlotGraph(
  value: unknown,
  rowCount: number
): FlowGraph | undefined {
  try {
    const parsed = parseStoryPlotPlan(value);
    const storyNodeIds = parsed.nodes.flatMap((node) => node.storyNodeIds);
    if (storyNodeIds.length !== rowCount) return undefined;
    const plan = validateStoryPlotPlan(parsed, storyNodeIds);
    const rowIndexByStoryNodeId = new Map(
      storyNodeIds.map((storyNodeId, rowIndex) => [storyNodeId, rowIndex])
    );

    return {
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
    };
  } catch {
    return undefined;
  }
}
