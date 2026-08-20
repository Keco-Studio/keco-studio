import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';

const MAX_EXCERPT_LINES = 8;
const MAX_LINE_LENGTH = 240;
const MAX_TREE_DEPTH = 12;

export type DialogueSnapshotInput = {
  dialogueJobId: string;
  chapterKey: string;
  title: string;
  projectId: string;
  dialogueDocumentId: string;
  scriptLibraryId: string;
  document: StoryDocument;
  plotPlan?: StoryPlotPlan;
};

function trimLine(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_LINE_LENGTH ? `${normalized.slice(0, MAX_LINE_LENGTH - 1)}…` : normalized;
}

export function escapeSnapshotText(value: string): string {
  return trimLine(value).replace(/[\\`*_{}[\]()#+.!|>~-]/g, '\\$&');
}

function markerValue(value: string): string {
  return value.replace(/["\\\r\n]/g, (match) => `\\${match}`);
}

function nodeTitle(node: StoryNode | undefined, fallback: string): string {
  return escapeSnapshotText(node?.content || node?.label || fallback);
}

function excerptLines(document: StoryDocument): string[] {
  return document.nodes
    .filter((node) => node.content.trim())
    .slice(0, MAX_EXCERPT_LINES)
    .map((node) => {
      const text = escapeSnapshotText(node.content);
      return node.speaker ? `- **${escapeSnapshotText(node.speaker)}:** ${text}` : `- ${text}`;
    });
}

function hasChoices(document: StoryDocument): boolean {
  return document.nodes.some((node) => node.options.length > 0);
}

function choiceLines(document: StoryDocument): string[] {
  return document.nodes.flatMap((node) => node.options.map((option) => (
    `- ${escapeSnapshotText(option.text)} → \`${escapeSnapshotText(option.target)}\``
  ))).slice(0, 50);
}

type PlotTree = {
  titleById: Map<string, string>;
  edgesById: Map<string, Array<{ to: string; optionText: string | null }>>;
};

function buildPlotTree(plan: StoryPlotPlan): PlotTree {
  const titleById = new Map(plan.nodes.map((node) => [node.id, escapeSnapshotText(node.title)]));
  const edgesById = new Map<string, Array<{ to: string; optionText: string | null }>>();
  for (const edge of plan.edges) {
    const list = edgesById.get(edge.fromPlotNodeId) ?? [];
    list.push({ to: edge.toPlotNodeId, optionText: edge.optionText ? escapeSnapshotText(edge.optionText) : null });
    edgesById.set(edge.fromPlotNodeId, list);
  }
  return { titleById, edgesById };
}

export function renderStoryBranchTree(document: StoryDocument, plotPlan?: StoryPlotPlan): string {
  if (!hasChoices(document)) return '';
  if (!plotPlan) {
    const byLabel = new Map(document.nodes.map((node) => [node.label, node]));
    const root = byLabel.get(document.entryLabel);
    if (!root) return '- No branches';
    const lines = [`- ${nodeTitle(root, root.label)}`];
    for (const option of root.options) lines.push(`  - ${escapeSnapshotText(option.text)} → ${escapeSnapshotText(option.target)}`);
    return lines.join('\n');
  }

  const tree = buildPlotTree(plotPlan);
  const lines = [`- ${tree.titleById.get(plotPlan.entryPlotNodeId) ?? escapeSnapshotText(plotPlan.entryPlotNodeId)}`];
  const visiting = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth >= MAX_TREE_DEPTH || visiting.has(id)) return;
    visiting.add(id);
    for (const edge of tree.edgesById.get(id) ?? []) {
      const targetTitle = tree.titleById.get(edge.to) ?? escapeSnapshotText(edge.to);
      const label = edge.optionText ? `${edge.optionText} → ${targetTitle}` : targetTitle;
      lines.push(`${'  '.repeat(depth + 1)}- ${label}`);
      walk(edge.to, depth + 1);
    }
    visiting.delete(id);
  };
  walk(plotPlan.entryPlotNodeId, 0);
  return lines.join('\n');
}

export function renderDialogueSnapshot(input: DialogueSnapshotInput): string {
  const excerpt = excerptLines(input.document);
  const choices = choiceLines(input.document);
  const branched = hasChoices(input.document);
  const tree = branched ? renderStoryBranchTree(input.document, input.plotPlan) : '';
  const lines = [
    '<!-- KECO_GDD_DIALOGUE_SNAPSHOT',
    `dialogueJobId="${markerValue(input.dialogueJobId)}"`,
    `chapterKey="${markerValue(input.chapterKey)}"`,
    `dialogueDocumentId="${markerValue(input.dialogueDocumentId)}"`,
    `scriptLibraryId="${markerValue(input.scriptLibraryId)}"`,
    '-->',
    `### Dialogue: ${escapeSnapshotText(input.title)}`,
    '',
    `[Open Dialogue Document](/${encodeURIComponent(input.projectId)}/doc/${encodeURIComponent(input.dialogueDocumentId)}) · [Open Script FlowChart](/script-system/${encodeURIComponent(input.projectId)}/script/${encodeURIComponent(input.scriptLibraryId)})`,
    '',
    '**Excerpt**',
    '',
    ...(excerpt.length > 0 ? excerpt : ['- No dialogue content']),
  ];
  if (branched) {
    lines.push('', '**Choices**', '', ...(choices.length > 0 ? choices : ['- No choices']), '', '**Branch tree**', '', tree || '- No branches');
  }
  lines.push('<!-- /KECO_GDD_DIALOGUE_SNAPSHOT -->');
  return lines.join('\n');
}
