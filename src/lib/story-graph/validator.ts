import { STORY_LABEL_PATTERN } from './constants.ts';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph.ts';

export type StoryGraphWarning = { code: 'unreachable_node'; label: string };

export type StoryGraphSummary = {
  nodeCount: number;
  edgeCount: number;
  endingCount: number;
  unreachableCount: number;
  entryToEndingPathCount: string;
};

export class StoryGraphValidationError extends Error {
  readonly code = 'STORY_GRAPH_INVALID_PATCH' as const;

  constructor(message: string, public readonly label?: string) {
    super(message);
    this.name = 'StoryGraphValidationError';
  }
}

export function validateEditableStoryGraph(graph: EditableStoryGraph): {
  warnings: StoryGraphWarning[];
  summary: StoryGraphSummary;
} {
  if (graph.plotPlan.version !== 2) invalid('Editable story graphs require plot plan version 2');

  const nodesByLabel = new Map<string, EditableStoryNode>();
  for (const node of graph.nodes) {
    if (!STORY_LABEL_PATTERN.test(node.label)) invalid(`Invalid story label ${node.label}`, node.label);
    if (nodesByLabel.has(node.label)) invalid(`Duplicate story label ${node.label}`, node.label);
    nodesByLabel.set(node.label, node);
  }
  if (!nodesByLabel.has(graph.entryLabel)) {
    invalid(`Story entry ${graph.entryLabel} does not exist`, graph.entryLabel);
  }

  const orderedLabels = graph.nodes.map((node) => node.label);
  if (!sameStrings(graph.plotPlan.storyNodeOrder, orderedLabels)) {
    invalid('Plot storyNodeOrder does not match canonical graph order');
  }
  validatePlotMembership(graph, nodesByLabel);

  let edgeCount = 0;
  for (const node of graph.nodes) {
    if (node.choices.length > 10) invalid(`Story node ${node.label} has more than 10 choices`, node.label);
    const optionIndexes = new Set<number>();
    for (const choice of node.choices) {
      if (
        !Number.isInteger(choice.optionIndex)
        || choice.optionIndex < 0
        || choice.optionIndex > 9
        || optionIndexes.has(choice.optionIndex)
      ) {
        invalid(`Story node ${node.label} has an invalid choice slot`, node.label);
      }
      optionIndexes.add(choice.optionIndex);
      requireTarget(nodesByLabel, choice.targetLabel, node.label);
      edgeCount += 1;
    }
    if (node.choices.length > 0 && node.nextLabel) {
      invalid(`Story node ${node.label} has choices and an ordinary successor`, node.label);
    }
    if (node.nextLabel) {
      requireTarget(nodesByLabel, node.nextLabel, node.label);
      edgeCount += 1;
    }
    const hasOutgoing = node.choices.length > 0 || Boolean(node.nextLabel);
    if (hasOutgoing && node.terminal) {
      invalid(`Story node ${node.label} is terminal but has outgoing edges`, node.label);
    }
    if (!hasOutgoing && !node.terminal) {
      invalid(`Story node ${node.label} has no outgoing edge and is not terminal`, node.label);
    }
  }

  assertAcyclic(graph, nodesByLabel);
  const reachable = collectReachable(graph.entryLabel, nodesByLabel);
  const warnings = graph.nodes
    .filter((node) => !reachable.has(node.label))
    .map((node) => ({ code: 'unreachable_node' as const, label: node.label }));
  const pathMemo = new Map<string, bigint>();
  const pathCount = countEndingPaths(graph.entryLabel, nodesByLabel, pathMemo);

  return {
    warnings,
    summary: {
      nodeCount: graph.nodes.length,
      edgeCount,
      endingCount: graph.nodes.filter((node) => node.terminal).length,
      unreachableCount: warnings.length,
      entryToEndingPathCount: pathCount.toString(),
    },
  };
}

function validatePlotMembership(
  graph: EditableStoryGraph,
  nodesByLabel: Map<string, EditableStoryNode>
): void {
  const memberships = new Map<string, number>();
  for (const plotNode of graph.plotPlan.nodes) {
    for (const label of plotNode.storyNodeIds) {
      if (!nodesByLabel.has(label)) invalid(`Plot membership references unknown node ${label}`, label);
      memberships.set(label, (memberships.get(label) ?? 0) + 1);
    }
  }
  for (const label of nodesByLabel.keys()) {
    if (memberships.get(label) !== 1) {
      invalid(`Story node ${label} must have exactly one plot membership`, label);
    }
  }
  const entryPlot = graph.plotPlan.nodes.find(
    (node) => node.id === graph.plotPlan.entryPlotNodeId
  );
  if (!entryPlot?.storyNodeIds.includes(graph.entryLabel)) {
    invalid('Entry plot node does not contain the story entry', graph.entryLabel);
  }
}

function assertAcyclic(
  graph: EditableStoryGraph,
  nodesByLabel: Map<string, EditableStoryNode>
): void {
  const colors = new Map<string, 0 | 1 | 2>();
  const visit = (label: string): void => {
    const color = colors.get(label) ?? 0;
    if (color === 1) invalid(`Story graph contains a cycle at ${label}`, label);
    if (color === 2) return;
    colors.set(label, 1);
    outgoing(nodesByLabel.get(label)!).forEach(visit);
    colors.set(label, 2);
  };
  graph.nodes.forEach((node) => visit(node.label));
}

function collectReachable(
  entryLabel: string,
  nodesByLabel: Map<string, EditableStoryNode>
): Set<string> {
  const reached = new Set<string>();
  const pending = [entryLabel];
  while (pending.length > 0) {
    const label = pending.pop()!;
    if (reached.has(label)) continue;
    reached.add(label);
    pending.push(...outgoing(nodesByLabel.get(label)!));
  }
  return reached;
}

function countEndingPaths(
  label: string,
  nodesByLabel: Map<string, EditableStoryNode>,
  memo: Map<string, bigint>
): bigint {
  const cached = memo.get(label);
  if (cached !== undefined) return cached;
  const node = nodesByLabel.get(label)!;
  const count = node.terminal
    ? BigInt(1)
    : outgoing(node).reduce(
      (total, target) => total + countEndingPaths(target, nodesByLabel, memo),
      BigInt(0)
    );
  memo.set(label, count);
  return count;
}

function outgoing(node: EditableStoryNode): string[] {
  return node.choices.length > 0
    ? node.choices.map((choice) => choice.targetLabel)
    : node.nextLabel ? [node.nextLabel] : [];
}

function requireTarget(
  nodesByLabel: Map<string, EditableStoryNode>,
  targetLabel: string,
  ownerLabel: string
): void {
  if (!nodesByLabel.has(targetLabel)) {
    invalid(`Story node ${ownerLabel} targets missing node ${targetLabel}`, ownerLabel);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function invalid(message: string, label?: string): never {
  throw new StoryGraphValidationError(message, label);
}
