import type { StoryExtraction } from '@/lib/story-extraction/schema';
import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import type { StoryAuditProjection } from './projection';

export type StoryAuditPresentation =
  | 'dialogue_primary'
  | 'dialogue_secondary'
  | 'narration_box'
  | 'prose'
  | 'system';

export interface StoryAuditViewChoice {
  text: string;
  targetRowId: string;
  sourceUnitIds: string[];
  commands: string[];
}

export interface StoryAuditViewRow {
  id: string;
  presentation: StoryAuditPresentation;
  speaker: string;
  content: string;
  sourceUnitIds: string[];
  commands: string[];
  nextRowId: string;
  choices: StoryAuditViewChoice[];
}

export interface StoryAuditViewPath {
  rowIds: string[];
  choiceTexts: string[];
  terminalRowId: string;
  commands: string[];
}

export interface StoryAuditView {
  version: 1;
  entryRowId: string;
  rows: StoryAuditViewRow[];
  paths: StoryAuditViewPath[];
  structuralUnitIds: string[];
}

export function buildStoryAuditView(
  document: StoryDocument,
  extraction: StoryExtraction,
  projection: StoryAuditProjection
): StoryAuditView {
  const nodesById = new Map(document.nodes.map((node) => [node.label, node]));

  return {
    version: 1,
    entryRowId: document.entryLabel,
    rows: document.nodes.map((node) => ({
      id: node.label,
      presentation: presentationFor(node),
      speaker: node.speaker ?? '',
      content: node.content,
      sourceUnitIds: unitIds(node.sourceRefs),
      commands: node.commands.map((command) => command.source),
      nextRowId: node.next ?? '',
      choices: node.options.map((option) => ({
        text: option.text,
        targetRowId: option.target,
        sourceUnitIds: unitIds(option.sourceRefs),
        commands: option.commands.map((command) => command.source),
      })),
    })),
    paths: projection.paths.map((path) => summarizePath(path.labels, nodesById)),
    structuralUnitIds: [...extraction.structuralUnitIds],
  };
}

function summarizePath(
  rowIds: string[],
  nodesById: Map<string, StoryNode>
): StoryAuditViewPath {
  const choiceTexts: string[] = [];
  const commands: string[] = [];

  rowIds.forEach((rowId, index) => {
    const node = nodesById.get(rowId);
    if (!node) throw new Error(`Audit path references unknown row ${rowId}`);
    commands.push(...node.commands.map((command) => command.source));

    const nextRowId = rowIds[index + 1];
    if (!nextRowId) return;
    const selected = node.options.find((option) => option.target === nextRowId);
    if (!selected) return;
    choiceTexts.push(selected.text);
    commands.push(...selected.commands.map((command) => command.source));
  });

  return {
    rowIds: [...rowIds],
    choiceTexts,
    terminalRowId: rowIds.at(-1) ?? '',
    commands,
  };
}

function presentationFor(node: StoryNode): StoryAuditPresentation {
  if (node.presentationType === 1) return 'dialogue_primary';
  if (node.presentationType === 2) return 'dialogue_secondary';
  if (node.presentationType === 3) return 'narration_box';
  if (node.presentationType === 4) return 'prose';
  if (node.presentationType === 5) return 'system';
  if (node.type === 'dialogue') return 'dialogue_primary';
  if (node.type === 'system') return 'system';
  if (node.type === 'scene') return 'prose';
  return 'narration_box';
}

function unitIds(refs: Array<{ unitId?: string }>): string[] {
  return [...new Set(refs.flatMap((ref) => ref.unitId ? [ref.unitId] : []))];
}
