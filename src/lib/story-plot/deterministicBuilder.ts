import type { StoryDocument } from '@/lib/story-ir/schema';
import type { StoryPlotEdge, StoryPlotNode, StoryPlotPlan } from './schema';
import { validateStoryPlotPlan } from './validator';
import { isStoryPlotHeading, storyPlotHeadingTitle } from './headings';

export function buildDeterministicStoryPlotPlan(document: StoryDocument): StoryPlotPlan {
  const indexByStoryId = new Map(document.nodes.map((node, index) => [node.label, index]));
  const optionByTarget = new Map<string, { text: string; optionIndex: number }>();
  for (const node of document.nodes) {
    node.options.forEach((option, optionIndex) => {
      if (!optionByTarget.has(option.target)) {
        optionByTarget.set(option.target, { text: option.text, optionIndex });
      }
    });
  }

  const boundaries = new Set<number>([0]);
  document.nodes.forEach((node, index) => {
    if (
      (node.type === 'scene' && isStoryPlotHeading(node.content))
      || optionByTarget.has(node.label)
    ) boundaries.add(index);
  });

  const starts = [...boundaries].sort((left, right) => left - right);
  const nodes: StoryPlotNode[] = starts.map((start, plotIndex) => {
    const end = starts[plotIndex + 1] ?? document.nodes.length;
    const first = document.nodes[start];
    const optionTitle = optionByTarget.get(first.label)?.text;
    return {
      id: first.label,
      title: optionTitle || storyPlotHeadingTitle(first.content) || `\u5267\u60c5 ${plotIndex + 1}`,
      storyNodeIds: document.nodes.slice(start, end).map((node) => node.label),
    };
  });

  const plotByStoryId = new Map<string, string>();
  nodes.forEach((plot) => plot.storyNodeIds.forEach((storyId) => plotByStoryId.set(storyId, plot.id)));
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
    const fromPlotNodeId = plotByStoryId.get(storyNode.label)!;
    if (storyNode.options.length > 0) {
      storyNode.options.forEach((option, optionIndex) => {
        const toPlotNodeId = plotByStoryId.get(option.target);
        if (toPlotNodeId) {
          addEdge({ fromPlotNodeId, toPlotNodeId, optionText: option.text, optionIndex });
        }
      });
      continue;
    }
    if (!storyNode.next) continue;
    const toPlotNodeId = plotByStoryId.get(storyNode.next);
    if (toPlotNodeId) {
      addEdge({ fromPlotNodeId, toPlotNodeId, optionText: null, optionIndex: null });
    }
  }

  const entryPlotNodeId = plotByStoryId.get(document.entryLabel);
  if (!entryPlotNodeId || !indexByStoryId.has(document.entryLabel)) {
    throw new Error('Story entry does not belong to a plot node');
  }
  return validateStoryPlotPlan({ version: 1, entryPlotNodeId, nodes, edges }, document.nodes.map((node) => node.label));
}
