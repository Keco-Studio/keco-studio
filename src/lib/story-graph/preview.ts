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
  createdNodes: Array<{ label: string; contentSummary: string; rowIndex: number }>;
  edgeChanges: Array<{
    kind: 'added' | 'removed' | 'redirected' | 'next_changed' | 'ending_changed';
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
  const createdNodes = input.changes.flatMap((change) => {
    if (change.type !== 'node_created') return [];
    const node = input.after.nodes.find((candidate) => candidate.label === change.label);
    if (!node) return [];
    rows.add(node.rowIndex + 1);
    return [{
      label: node.label,
      contentSummary: compact(node.content, 160),
      rowIndex: node.rowIndex + 1,
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
    }
  });

  return {
    type: 'story_graph_edit',
    libraryId: input.libraryId,
    libraryName: input.libraryName,
    createdNodes,
    edgeChanges,
    affectedRows: [...rows].sort((left, right) => left - right),
    addedFields: [...input.addedFields],
    warnings: input.afterValidation.warnings,
    before: input.beforeValidation.summary,
    after: input.afterValidation.summary,
  };
}

function compact(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
