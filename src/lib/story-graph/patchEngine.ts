import type {
  EditableNodeType,
  EditableStoryGraph,
  EditableStoryNode,
} from './editableGraph';
import {
  StoryGraphPatchSchema,
  type StoryGraphPatch,
  type StoryGraphPatchOperation,
} from './patchSchema';

export type StoryGraphChange =
  | { type: 'node_created'; label: string; rowIndex: number; plotTitle?: string }
  | {
      type: 'choice_added'; fromLabel: string; optionIndex: number;
      text: string; targetLabel: string;
    }
  | {
      type: 'choice_removed'; fromLabel: string; optionIndex: number;
      text: string; targetLabel: string;
    }
  | {
      type: 'choice_redirected'; fromLabel: string; optionIndex: number;
      text: string; fromTargetLabel: string; toTargetLabel: string;
    }
  | {
      type: 'next_changed'; fromLabel: string;
      fromTargetLabel: string | null; toTargetLabel: string;
    }
  | {
      type: 'ending_changed'; fromLabel: string;
      fromTargetLabel: string | null; terminal: true;
    };

type NormalizedOperation = StoryGraphPatchOperation & {
  expectedText?: string;
  expectedTargetLabel?: string;
};

export type NormalizedStoryGraphPatch = { operations: NormalizedOperation[] };

export class StoryGraphPatchError extends Error {
  constructor(
    public readonly code: 'STORY_GRAPH_INVALID_PATCH' | 'STORY_GRAPH_AMBIGUOUS_NODE',
    message: string,
    public readonly operationIndex?: number,
    public readonly candidates?: string[]
  ) {
    super(message);
    this.name = 'StoryGraphPatchError';
  }
}

export function applyStoryGraphPatch(
  input: EditableStoryGraph,
  patchInput: StoryGraphPatch
): {
  graph: EditableStoryGraph;
  normalizedPatch: NormalizedStoryGraphPatch;
  changes: StoryGraphChange[];
} {
  const parsed = StoryGraphPatchSchema.safeParse(patchInput);
  if (!parsed.success) {
    throw new StoryGraphPatchError(
      'STORY_GRAPH_INVALID_PATCH',
      `Invalid story graph patch: ${parsed.error.message}`
    );
  }

  const graph = cloneGraph(input);
  const normalized: NormalizedOperation[] = [];
  const changes: StoryGraphChange[] = [];

  parsed.data.operations.forEach((operation, operationIndex) => {
    try {
      applyOperation(graph, operation, normalized, changes);
      graph.nodes.forEach((node, index) => { node.rowIndex = index; });
    } catch (error) {
      if (error instanceof StoryGraphPatchError) {
        if (error.operationIndex === undefined) {
          throw new StoryGraphPatchError(
            error.code,
            error.message,
            operationIndex,
            error.candidates
          );
        }
        throw error;
      }
      throw new StoryGraphPatchError(
        'STORY_GRAPH_INVALID_PATCH',
        error instanceof Error ? error.message : 'Unable to apply story graph patch',
        operationIndex
      );
    }
  });

  return { graph, normalizedPatch: { operations: normalized }, changes };
}

export function applyNormalizedStoryGraphPatch(
  input: EditableStoryGraph,
  normalizedPatch: NormalizedStoryGraphPatch
): ReturnType<typeof applyStoryGraphPatch> {
  const operations = normalizedPatch.operations.map((operation) => {
    const {
      expectedText: _expectedText,
      expectedTargetLabel: _expectedTargetLabel,
      ...raw
    } = operation;
    return raw as StoryGraphPatchOperation;
  });
  const applied = applyStoryGraphPatch(input, { operations });
  if (JSON.stringify(applied.normalizedPatch) !== JSON.stringify(normalizedPatch)) {
    throw new StoryGraphPatchError(
      'STORY_GRAPH_INVALID_PATCH',
      'Approved story graph patch no longer matches its expected edges'
    );
  }
  return applied;
}

function applyOperation(
  graph: EditableStoryGraph,
  operation: StoryGraphPatchOperation,
  normalized: NormalizedOperation[],
  changes: StoryGraphChange[]
): void {
  switch (operation.type) {
    case 'create_node': {
      if (graph.nodes.some((node) => node.label === operation.node.label)) {
        invalid(`Story node ${operation.node.label} already exists`);
      }
      const nextLabel = operation.node.nextLabel
        ? resolveNode(graph, operation.node.nextLabel).label
        : null;
      const insertIndex = operation.insertAfterLabel
        ? graph.nodes.indexOf(resolveNode(graph, operation.insertAfterLabel)) + 1
        : graph.nodes.length;
      const plotTitle = operation.node.plotTitle ?? compactTitle(
        operation.node.content,
        operation.node.label
      );
      const created = createNode(operation.node.label, operation.node.nodeType, {
        content: operation.node.content,
        speaker: operation.node.speaker ?? '',
        plotTitle,
        nextLabel,
      });
      graph.nodes.splice(insertIndex, 0, created);
      normalized.push({
        ...operation,
        node: { ...operation.node, ...(nextLabel ? { nextLabel } : {}) },
        ...(operation.insertAfterLabel
          ? { insertAfterLabel: graph.nodes[insertIndex - 1].label }
          : {}),
      });
      changes.push({
        type: 'node_created',
        label: created.label,
        rowIndex: insertIndex,
        ...(operation.node.plotTitle ? { plotTitle: operation.node.plotTitle } : {}),
      });
      return;
    }
    case 'add_choice': {
      const from = resolveNode(graph, operation.fromLabel);
      const target = resolveNode(graph, operation.targetLabel);
      if (from.nextLabel) {
        invalid(`Story node ${from.label} still has ordinary successor ${from.nextLabel}`);
      }
      const used = new Set(from.choices.map((choice) => choice.optionIndex));
      const optionIndex = Array.from({ length: 10 }, (_, index) => index)
        .find((index) => !used.has(index));
      if (optionIndex === undefined) invalid(`Story node ${from.label} already has 10 choices`);
      from.choices.push({
        optionIndex,
        text: operation.text,
        targetLabel: target.label,
        commands: operation.commands ?? '',
      });
      from.choices.sort((left, right) => left.optionIndex - right.optionIndex);
      from.terminal = false;
      normalized.push({ ...operation, fromLabel: from.label, targetLabel: target.label });
      changes.push({
        type: 'choice_added', fromLabel: from.label, optionIndex,
        text: operation.text, targetLabel: target.label,
      });
      return;
    }
    case 'redirect_choice': {
      const from = resolveNode(graph, operation.fromLabel);
      const target = resolveNode(graph, operation.targetLabel);
      const choice = requireChoice(from, operation.optionIndex);
      const previous = choice.targetLabel;
      choice.targetLabel = target.label;
      normalized.push({
        ...operation,
        fromLabel: from.label,
        targetLabel: target.label,
        expectedText: choice.text,
        expectedTargetLabel: previous,
      });
      changes.push({
        type: 'choice_redirected', fromLabel: from.label,
        optionIndex: operation.optionIndex, text: choice.text,
        fromTargetLabel: previous, toTargetLabel: target.label,
      });
      return;
    }
    case 'remove_choice': {
      const from = resolveNode(graph, operation.fromLabel);
      const choice = requireChoice(from, operation.optionIndex);
      from.choices = from.choices.filter((candidate) => (
        candidate.optionIndex !== operation.optionIndex
      ));
      if (from.choices.length === 0) from.terminal = true;
      normalized.push({
        ...operation,
        fromLabel: from.label,
        expectedText: choice.text,
        expectedTargetLabel: choice.targetLabel,
      });
      changes.push({
        type: 'choice_removed', fromLabel: from.label,
        optionIndex: operation.optionIndex, text: choice.text,
        targetLabel: choice.targetLabel,
      });
      return;
    }
    case 'set_next': {
      const from = resolveNode(graph, operation.fromLabel);
      const target = resolveNode(graph, operation.targetLabel);
      if (from.choices.length > 0) {
        invalid(`Story node ${from.label} still has choices`);
      }
      const previous = from.nextLabel;
      from.nextLabel = target.label;
      from.terminal = false;
      normalized.push({ ...operation, fromLabel: from.label, targetLabel: target.label });
      changes.push({
        type: 'next_changed', fromLabel: from.label,
        fromTargetLabel: previous, toTargetLabel: target.label,
      });
      return;
    }
    case 'set_end': {
      const from = resolveNode(graph, operation.fromLabel);
      if (from.choices.length > 0) {
        invalid(`Story node ${from.label} still has choices`);
      }
      const previous = from.nextLabel;
      from.nextLabel = null;
      from.terminal = true;
      normalized.push({ ...operation, fromLabel: from.label });
      changes.push({
        type: 'ending_changed', fromLabel: from.label,
        fromTargetLabel: previous, terminal: true,
      });
      return;
    }
  }
}

function resolveNode(graph: EditableStoryGraph, reference: string): EditableStoryNode {
  const byLabel = graph.nodes.find((node) => node.label === reference);
  if (byLabel) return byLabel;
  const byTitle = graph.nodes.filter((node) => node.plotTitle === reference);
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    throw new StoryGraphPatchError(
      'STORY_GRAPH_AMBIGUOUS_NODE',
      `Plot title ${reference} matches multiple story nodes`,
      undefined,
      byTitle.map((node) => node.label)
    );
  }
  return invalid(`Story node ${reference} was not found`);
}

function requireChoice(node: EditableStoryNode, optionIndex: number) {
  const choice = node.choices.find((candidate) => candidate.optionIndex === optionIndex);
  if (!choice) invalid(`Story node ${node.label} has no choice in slot ${optionIndex}`);
  return choice;
}

function cloneGraph(graph: EditableStoryGraph): EditableStoryGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      choices: node.choices.map((choice) => ({ ...choice })),
      values: { ...node.values },
    })),
    plotPlan: structuredClone(graph.plotPlan),
  };
}

function createNode(
  label: string,
  nodeType: EditableNodeType,
  input: {
    content: string;
    speaker: string;
    plotTitle: string;
    nextLabel: string | null;
  }
): EditableStoryNode {
  return {
    label,
    plotTitle: input.plotTitle,
    assetId: null,
    rowIndex: -1,
    nodeType,
    speaker: input.speaker,
    content: input.content,
    commands: '',
    nextLabel: input.nextLabel,
    terminal: input.nextLabel === null,
    choices: [],
    values: {
      Label: label,
      Type: nodeTypeValue(nodeType),
      Name: input.speaker,
      Content: input.content,
      Commands: input.nextLabel ? `Jump ${input.nextLabel}` : 'End',
    },
  };
}

function nodeTypeValue(type: EditableNodeType): string {
  return { dialogue: '1', narration: '3', scene: '4', system: '5' }[type];
}

function compactTitle(content: string, fallback: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}

function invalid(message: string): never {
  throw new StoryGraphPatchError('STORY_GRAPH_INVALID_PATCH', message);
}
