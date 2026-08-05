import type { StoryPlotEdge, StoryPlotNode, StoryPlotPlan } from '@/lib/story-plot/schema';
import { validateStoryPlotPlan } from '@/lib/story-plot/validator';
import type { EditableStoryGraph } from './editableGraph';
import type { StoryGraphChange } from './patchEngine';

export type StoryPlotPlanV2 = {
  version: 2;
  entryPlotNodeId: string;
  storyNodeOrder: string[];
  nodes: StoryPlotNode[];
  edges: StoryPlotEdge[];
};

export function updatePlotPlanAfterPatch(
  previous: StoryPlotPlan,
  graph: EditableStoryGraph,
  changes: StoryGraphChange[]
): StoryPlotPlanV2 {
  const storyNodeOrder = graph.nodes.map((node) => node.label);
  const knownLabels = new Set(storyNodeOrder);
  const indexByLabel = new Map(storyNodeOrder.map((label, index) => [label, index]));
  const splitLabels = collectSplitLabels(changes);
  const createdTitles = new Map(changes.flatMap((change) => (
    change.type === 'node_created' && change.plotTitle
      ? [[change.label, change.plotTitle] as const]
      : []
  )));
  const usedIds = new Set<string>();
  const assignedLabels = new Set<string>();
  const nodes: StoryPlotNode[] = [];

  for (const previousNode of previous.nodes) {
    const members = previousNode.storyNodeIds.filter((label) => knownLabels.has(label));
    const splitMembers = members.filter((label) => splitLabels.has(label));
    const remainder = members.filter((label) => !splitLabels.has(label));

    if (splitMembers.length === 0 && remainder.length > 0) {
      const id = uniquePlotId(previousNode.id, usedIds);
      nodes.push({ ...previousNode, id, storyNodeIds: remainder });
      remainder.forEach((label) => assignedLabels.add(label));
      continue;
    }

    if (remainder.length > 0) {
      const preferredId = splitLabels.has(previousNode.id)
        ? remainder[0]
        : previousNode.id;
      nodes.push({
        id: uniquePlotId(preferredId, usedIds),
        title: previousNode.title,
        storyNodeIds: remainder,
      });
      remainder.forEach((label) => assignedLabels.add(label));
    }
    for (const label of splitMembers) {
      nodes.push(singletonPlotNode(label, graph, createdTitles, usedIds));
      assignedLabels.add(label);
    }
  }

  for (const label of storyNodeOrder) {
    if (assignedLabels.has(label)) continue;
    nodes.push(singletonPlotNode(label, graph, createdTitles, usedIds));
    assignedLabels.add(label);
  }

  nodes.sort((left, right) => (
    Math.min(...left.storyNodeIds.map((label) => indexByLabel.get(label)!))
    - Math.min(...right.storyNodeIds.map((label) => indexByLabel.get(label)!))
  ));
  const plotByStoryLabel = new Map<string, string>();
  nodes.forEach((node) => {
    node.storyNodeIds.forEach((label) => plotByStoryLabel.set(label, node.id));
  });
  const edges = derivePlotEdges(graph, plotByStoryLabel);
  const entryPlotNodeId = plotByStoryLabel.get(graph.entryLabel);
  if (!entryPlotNodeId) throw new Error('Story entry does not have a plot membership');

  const result: StoryPlotPlanV2 = {
    version: 2,
    entryPlotNodeId,
    storyNodeOrder,
    nodes,
    edges,
  };
  return validateStoryPlotPlan(
    result,
    storyNodeOrder,
    { allowUnreachable: true }
  ) as StoryPlotPlanV2;
}

function collectSplitLabels(changes: StoryGraphChange[]): Set<string> {
  const labels = new Set<string>();
  for (const change of changes) {
    switch (change.type) {
      case 'node_created':
        labels.add(change.label);
        break;
      case 'choice_added':
        labels.add(change.fromLabel);
        labels.add(change.targetLabel);
        break;
      case 'choice_removed':
        labels.add(change.fromLabel);
        break;
      case 'choice_redirected':
        labels.add(change.fromLabel);
        labels.add(change.fromTargetLabel);
        labels.add(change.toTargetLabel);
        break;
      case 'next_changed':
        labels.add(change.fromLabel);
        labels.add(change.toTargetLabel);
        break;
      case 'ending_changed':
        labels.add(change.fromLabel);
        break;
    }
  }
  return labels;
}

function singletonPlotNode(
  label: string,
  graph: EditableStoryGraph,
  createdTitles: Map<string, string>,
  usedIds: Set<string>
): StoryPlotNode {
  const storyNode = graph.nodes.find((node) => node.label === label);
  if (!storyNode) throw new Error(`Unknown story node ${label}`);
  const incomingChoiceText = graph.nodes.flatMap((node) => node.choices)
    .find((choice) => choice.targetLabel === label)?.text;
  return {
    id: uniquePlotId(label, usedIds),
    title: createdTitles.get(label)
      ?? incomingChoiceText
      ?? storyNode.plotTitle
      ?? compactTitle(storyNode.content, label),
    storyNodeIds: [label],
  };
}

function derivePlotEdges(
  graph: EditableStoryGraph,
  plotByStoryLabel: Map<string, string>
): StoryPlotEdge[] {
  const edges: StoryPlotEdge[] = [];
  const keys = new Set<string>();
  const add = (edge: StoryPlotEdge) => {
    if (edge.fromPlotNodeId === edge.toPlotNodeId) return;
    const key = JSON.stringify(edge);
    if (keys.has(key)) return;
    keys.add(key);
    edges.push(edge);
  };
  for (const node of graph.nodes) {
    const fromPlotNodeId = plotByStoryLabel.get(node.label)!;
    if (node.choices.length > 0) {
      for (const choice of node.choices) {
        add({
          fromPlotNodeId,
          toPlotNodeId: plotByStoryLabel.get(choice.targetLabel)!,
          optionText: choice.text,
          optionIndex: choice.optionIndex,
        });
      }
    } else if (node.nextLabel) {
      add({
        fromPlotNodeId,
        toPlotNodeId: plotByStoryLabel.get(node.nextLabel)!,
        optionText: null,
        optionIndex: null,
      });
    }
  }
  return edges;
}

function uniquePlotId(preferred: string, used: Set<string>): string {
  let id = preferred;
  let suffix = 2;
  while (used.has(id)) {
    id = `${preferred}_${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

function compactTitle(content: string, fallback: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}
