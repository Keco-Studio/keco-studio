import { z } from 'zod';
import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryPlotEdge, StoryPlotPlan } from './schema';
import { validateStoryPlotPlan } from './validator';

const StoryPlotGroupingSchema = z.object({
  nodes: z.array(z.object({
    title: z.string().trim().min(1),
    storyNodeIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()).min(1),
}).strict();

export type StoryPlotGrouping = z.infer<typeof StoryPlotGroupingSchema>;

export function parseStoryPlotGrouping(value: unknown): StoryPlotGrouping {
  return StoryPlotGroupingSchema.parse(value);
}

export function buildStoryPlotPlanFromGrouping(
  document: StoryDocument,
  input: unknown
): StoryPlotPlan {
  const grouping = parseStoryPlotGrouping(input);
  const expectedOrder = document.nodes.map((node) => node.label);
  const groupedOrder = grouping.nodes.flatMap((node) => node.storyNodeIds);
  if (
    groupedOrder.length !== expectedOrder.length
    || groupedOrder.some((storyNodeId, index) => storyNodeId !== expectedOrder[index])
  ) {
    throw new Error('Plot grouping must contain every story node exactly once in canonical ordered groups');
  }

  const nodes = grouping.nodes.map((node) => ({
    id: node.storyNodeIds[0],
    title: node.title,
    storyNodeIds: node.storyNodeIds,
  }));
  const plotByStoryNodeId = new Map<string, string>();
  nodes.forEach((plot) => {
    plot.storyNodeIds.forEach((storyNodeId) => plotByStoryNodeId.set(storyNodeId, plot.id));
  });

  for (const storyNode of document.nodes) {
    const ownerPlotNodeId = plotByStoryNodeId.get(storyNode.label);
    for (const option of storyNode.options) {
      const targetPlotNodeId = plotByStoryNodeId.get(option.target);
      if (ownerPlotNodeId && ownerPlotNodeId === targetPlotNodeId) {
        throw new Error(
          `Plot grouping hides option target ${option.target} inside decision ${storyNode.label}`
        );
      }
    }
  }

  const edges: StoryPlotEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: StoryPlotEdge) => {
    if (edge.fromPlotNodeId === edge.toPlotNodeId) return;
    const key = JSON.stringify(edge);
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(edge);
  };

  for (const storyNode of document.nodes) {
    const fromPlotNodeId = plotByStoryNodeId.get(storyNode.label)!;
    if (storyNode.options.length > 0) {
      storyNode.options.forEach((option, optionIndex) => {
        const toPlotNodeId = plotByStoryNodeId.get(option.target);
        if (toPlotNodeId) {
          addEdge({
            fromPlotNodeId,
            toPlotNodeId,
            optionText: option.text,
            optionIndex,
          });
        }
      });
      continue;
    }
    if (!storyNode.next) continue;
    const toPlotNodeId = plotByStoryNodeId.get(storyNode.next);
    if (toPlotNodeId) {
      addEdge({
        fromPlotNodeId,
        toPlotNodeId,
        optionText: null,
        optionIndex: null,
      });
    }
  }

  return validateStoryPlotPlan({
    version: 1,
    entryPlotNodeId: plotByStoryNodeId.get(document.entryLabel)!,
    nodes,
    edges,
  }, expectedOrder);
}
