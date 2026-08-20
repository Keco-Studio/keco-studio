import type { StoryDocument, StoryNode } from '@/lib/story-ir/schema';
import type { StoryPlotPlan } from '@/lib/story-plot/schema';
import {
  encodeGddScriptBranchTree,
  serializeGddScriptBranchSnapshot,
  type GddScriptBranchTreeNode,
} from '@/lib/documents/gddScriptBranchSnapshot';

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

function nodeTitle(node: StoryNode | undefined, fallback: string): string {
  return trimLine(node?.content || node?.label || fallback);
}

function hasChoices(document: StoryDocument): boolean {
  return document.nodes.some((node) => node.options.length > 0);
}

type PlotTree = {
  titleById: Map<string, string>;
  edgesById: Map<string, Array<{ to: string; optionText: string | null }>>;
};

function buildPlotTree(plan: StoryPlotPlan): PlotTree {
  const titleById = new Map(plan.nodes.map((node) => [node.id, trimLine(node.title)]));
  const edgesById = new Map<string, Array<{ to: string; optionText: string | null }>>();
  for (const edge of plan.edges) {
    const list = edgesById.get(edge.fromPlotNodeId) ?? [];
    list.push({ to: edge.toPlotNodeId, optionText: edge.optionText ? trimLine(edge.optionText) : null });
    edgesById.set(edge.fromPlotNodeId, list);
  }
  return { titleById, edgesById };
}

export function buildStoryBranchTreeNodes(
  document: StoryDocument,
  plotPlan?: StoryPlotPlan,
): GddScriptBranchTreeNode[] {
  if (!hasChoices(document)) {
    const byLabel = new Map(document.nodes.map((node) => [node.label, node]));
    const root = byLabel.get(document.entryLabel);
    return [{ depth: 0, label: nodeTitle(root, document.entryLabel || 'Scene') }];
  }

  if (!plotPlan) {
    const byLabel = new Map(document.nodes.map((node) => [node.label, node]));
    const root = byLabel.get(document.entryLabel);
    if (!root) return [{ depth: 0, label: 'No branches' }];
    const nodes: GddScriptBranchTreeNode[] = [{ depth: 0, label: nodeTitle(root, root.label) }];
    for (const option of root.options) {
      nodes.push({ depth: 1, label: `${trimLine(option.text)} → ${trimLine(option.target)}` });
    }
    return nodes;
  }

  const tree = buildPlotTree(plotPlan);
  const nodes: GddScriptBranchTreeNode[] = [{
    depth: 0,
    label: tree.titleById.get(plotPlan.entryPlotNodeId) ?? trimLine(plotPlan.entryPlotNodeId),
  }];
  const visiting = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth >= MAX_TREE_DEPTH || visiting.has(id)) return;
    visiting.add(id);
    for (const edge of tree.edgesById.get(id) ?? []) {
      const targetTitle = tree.titleById.get(edge.to) ?? trimLine(edge.to);
      const label = edge.optionText ? `${edge.optionText} → ${targetTitle}` : targetTitle;
      nodes.push({ depth: depth + 1, label });
      if (nodes.length >= 50) {
        visiting.delete(id);
        return;
      }
      walk(edge.to, depth + 1);
    }
    visiting.delete(id);
  };
  walk(plotPlan.entryPlotNodeId, 0);
  return nodes;
}

export function renderStoryBranchTree(document: StoryDocument, plotPlan?: StoryPlotPlan): string {
  if (!hasChoices(document)) return '';
  return buildStoryBranchTreeNodes(document, plotPlan)
    .map((node) => `${'  '.repeat(node.depth)}- ${escapeSnapshotText(node.label)}`)
    .join('\n');
}

export function renderDialogueSnapshot(input: DialogueSnapshotInput): string {
  const treeNodes = buildStoryBranchTreeNodes(input.document, input.plotPlan);
  return serializeGddScriptBranchSnapshot({
    dialogueJobId: input.dialogueJobId,
    chapterKey: input.chapterKey,
    title: input.title,
    projectId: input.projectId,
    dialogueDocumentId: input.dialogueDocumentId,
    scriptLibraryId: input.scriptLibraryId,
    tree: encodeGddScriptBranchTree(treeNodes),
  });
}

/** @deprecated excerpt helpers retained for tests that still assert markdown-era bounds */
export function dialogueSnapshotExcerptLineCount(document: StoryDocument): number {
  return Math.min(
    MAX_EXCERPT_LINES,
    document.nodes.filter((node) => node.content.trim()).length,
  );
}
