import type { EditableStoryGraph } from './editableGraph';
import type { StoryGraphChange } from './patchEngine';
import type {
  StoryGraphSummary,
  StoryGraphWarning,
  validateEditableStoryGraph,
} from './validator';

export type StoryGraphEditPreview = {
  type: 'story_graph_edit';
  libraryId: string;
  libraryName: string;
  createdNodes: Array<{
    label: string;
    title: string;
    contentSummary: string;
    rowIndex: number;
    placement: {
      relation: 'before' | 'after' | 'end';
      anchorTitle?: string;
    };
  }>;
  plotGraph: {
    nodes: Array<{
      id: string;
      label: string;
      rowIndex: number;
      rowIndexes: number[];
    }>;
    edges: Array<{
      from: string;
      to: string;
      optionText?: string;
      optionIndex?: number;
    }>;
    createdNodeIds: string[];
  };
  edgeChanges: Array<{
    kind: 'added' | 'removed' | 'redirected' | 'next_changed' | 'ending_changed' | 'entry_changed';
    fromLabel: string;
    text?: string;
    fromTarget?: string | null;
    toTarget?: string | null;
  }>;
  affectedRows: number[];
  addedFields: string[];
  warnings: StoryGraphWarning[];
  before: StoryGraphSummary;
  after: StoryGraphSummary;
};

type ValidationResult = ReturnType<typeof validateEditableStoryGraph>;
type EdgeChange = StoryGraphEditPreview['edgeChanges'][number];

export function buildStoryGraphEditPreview(input: {
  libraryId: string;
  libraryName: string;
  before: EditableStoryGraph;
  after: EditableStoryGraph;
  changes: StoryGraphChange[];
  addedFields: string[];
  beforeValidation: ValidationResult;
  afterValidation: ValidationResult;
}): StoryGraphEditPreview {
  const rows = new Set<number>();
  const createdStoryLabels = new Set(
    input.changes.flatMap((change) => change.type === 'node_created' ? [change.label] : [])
  );
  const createdNodes = input.changes.flatMap((change) => {
    if (change.type !== 'node_created') return [];
    const node = input.after.nodes.find((candidate) => candidate.label === change.label);
    if (!node) return [];
    rows.add(node.rowIndex + 1);
    const plotNode = input.after.plotPlan.nodes.find((plot) => (
      plot.storyNodeIds.includes(change.label)
    ));
    const placement = change.insertBeforeLabel
      ? {
          relation: 'before' as const,
          anchorTitle: storyPlotTitle(input.before, change.insertBeforeLabel),
        }
      : change.insertAfterLabel
        ? {
            relation: 'after' as const,
            anchorTitle: storyPlotTitle(input.before, change.insertAfterLabel),
          }
        : { relation: 'end' as const };
    return [{
      label: node.label,
      title: plotNode?.title ?? node.plotTitle,
      contentSummary: compact(node.content, 160),
      rowIndex: node.rowIndex + 1,
      placement,
    }];
  });
  const edgeChanges: EdgeChange[] = [];
  input.changes.forEach((change) => {
    if (change.type === 'node_created') return;
    const source = input.after.nodes.find((node) => node.label === change.fromLabel)
      ?? input.before.nodes.find((node) => node.label === change.fromLabel);
    if (source) rows.add(source.rowIndex + 1);
    switch (change.type) {
      case 'choice_added':
        edgeChanges.push({
          kind: 'added',
          fromLabel: change.fromLabel,
          text: change.text,
          fromTarget: null,
          toTarget: change.targetLabel,
        });
        return;
      case 'choice_removed':
        edgeChanges.push({
          kind: 'removed',
          fromLabel: change.fromLabel,
          text: change.text,
          fromTarget: change.targetLabel,
          toTarget: null,
        });
        return;
      case 'choice_redirected':
        edgeChanges.push({
          kind: 'redirected',
          fromLabel: change.fromLabel,
          text: change.text,
          fromTarget: change.fromTargetLabel,
          toTarget: change.toTargetLabel,
        });
        return;
      case 'next_changed':
        edgeChanges.push({
          kind: 'next_changed',
          fromLabel: change.fromLabel,
          fromTarget: change.fromTargetLabel,
          toTarget: change.toTargetLabel,
        });
        return;
      case 'ending_changed':
        edgeChanges.push({
          kind: 'ending_changed',
          fromLabel: change.fromLabel,
          fromTarget: change.fromTargetLabel,
          toTarget: null,
        });
        return;
      case 'entry_changed': {
        const target = input.after.nodes.find((node) => node.label === change.toLabel);
        if (target) rows.add(target.rowIndex + 1);
        edgeChanges.push({
          kind: 'entry_changed',
          fromLabel: change.fromLabel,
          fromTarget: change.fromLabel,
          toTarget: change.toLabel,
        });
        return;
      }
    }
  });

  return {
    type: 'story_graph_edit',
    libraryId: input.libraryId,
    libraryName: input.libraryName,
    createdNodes,
    plotGraph: buildPlotGraph(input.after, createdStoryLabels),
    edgeChanges,
    affectedRows: [...rows].sort((left, right) => left - right),
    addedFields: [...input.addedFields],
    warnings: input.afterValidation.warnings,
    before: input.beforeValidation.summary,
    after: input.afterValidation.summary,
  };
}

function storyPlotTitle(graph: EditableStoryGraph, storyLabel: string): string {
  return graph.plotPlan.nodes.find((plot) => plot.storyNodeIds.includes(storyLabel))?.title
    ?? graph.nodes.find((node) => node.label === storyLabel)?.plotTitle
    ?? storyLabel;
}

function buildPlotGraph(
  graph: EditableStoryGraph,
  createdStoryLabels: Set<string>
): StoryGraphEditPreview['plotGraph'] {
  const rowIndexByStoryLabel = new Map(
    graph.nodes.map((node) => [node.label, node.rowIndex] as const)
  );
  const createdNodeIds: string[] = [];
  const nodes = graph.plotPlan.nodes.map((plot) => {
    const rowIndexes = plot.storyNodeIds.map((label) => rowIndexByStoryLabel.get(label) ?? 0);
    if (plot.storyNodeIds.some((label) => createdStoryLabels.has(label))) {
      createdNodeIds.push(plot.id);
    }
    return {
      id: plot.id,
      label: plot.title,
      rowIndex: rowIndexes[0] ?? 0,
      rowIndexes,
    };
  });
  const edges = graph.plotPlan.edges.map((edge) => edge.optionText === null ? {
    from: edge.fromPlotNodeId,
    to: edge.toPlotNodeId,
  } : {
    from: edge.fromPlotNodeId,
    to: edge.toPlotNodeId,
    optionText: edge.optionText,
    optionIndex: edge.optionIndex,
  });
  return { nodes, edges, createdNodeIds };
}

function compact(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
