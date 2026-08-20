const MAX_TREE_NODES = 50;
const MAX_TREE_DEPTH = 12;
const MAX_LABEL_LENGTH = 240;

export type GddScriptBranchTreeNode = {
  depth: number;
  label: string;
};

export type GddScriptBranchSnapshotAttributes = {
  dialogueJobId: string;
  chapterKey: string;
  title: string;
  projectId: string;
  dialogueDocumentId: string;
  scriptLibraryId: string;
  tree: string;
};

const REQUIRED_PROPERTIES = [
  'dialogueJobId',
  'chapterKey',
  'title',
  'projectId',
  'dialogueDocumentId',
  'scriptLibraryId',
  'tree',
] as const;

function hasExactProperties(
  attributes: Readonly<Record<string, string>>,
  properties: readonly string[],
): boolean {
  const keys = Object.keys(attributes);
  return (
    keys.length === properties.length
    && properties.every((property) => Object.hasOwn(attributes, property))
  );
}

function trimLabel(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_LABEL_LENGTH
    ? `${normalized.slice(0, MAX_LABEL_LENGTH - 1)}…`
    : normalized;
}

export function encodeGddScriptBranchTree(nodes: GddScriptBranchTreeNode[]): string {
  return JSON.stringify(
    nodes.slice(0, MAX_TREE_NODES).map((node) => ({
      d: Math.max(0, Math.min(MAX_TREE_DEPTH, Math.floor(node.depth))),
      t: trimLabel(node.label),
    })),
  );
}

export function parseGddScriptBranchTree(tree: string): GddScriptBranchTreeNode[] | null {
  if (typeof tree !== 'string' || tree.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(tree) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_TREE_NODES) {
      return null;
    }
    const nodes: GddScriptBranchTreeNode[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') return null;
      const depth = (item as { d?: unknown }).d;
      const label = (item as { t?: unknown }).t;
      if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > MAX_TREE_DEPTH) {
        return null;
      }
      if (typeof label !== 'string' || label.trim().length === 0) return null;
      nodes.push({ depth, label: trimLabel(label) });
    }
    return nodes;
  } catch {
    return null;
  }
}

export function parseGddScriptBranchSnapshotAttributes(
  attributes: Readonly<Record<string, string>>,
): GddScriptBranchSnapshotAttributes | null {
  if (!hasExactProperties(attributes, REQUIRED_PROPERTIES)) return null;
  const tree = parseGddScriptBranchTree(attributes.tree);
  if (!tree) return null;
  for (const key of REQUIRED_PROPERTIES) {
    if (attributes[key].trim().length === 0) return null;
  }
  return {
    dialogueJobId: attributes.dialogueJobId,
    chapterKey: attributes.chapterKey,
    title: attributes.title,
    projectId: attributes.projectId,
    dialogueDocumentId: attributes.dialogueDocumentId,
    scriptLibraryId: attributes.scriptLibraryId,
    tree: attributes.tree,
  };
}

export function gddScriptFlowChartHref(projectId: string, scriptLibraryId: string): string {
  return `/script-system/${encodeURIComponent(projectId)}/script/${encodeURIComponent(scriptLibraryId)}`;
}

export function gddDialogueDocumentHref(projectId: string, dialogueDocumentId: string): string {
  return `/${encodeURIComponent(projectId)}/doc/${encodeURIComponent(dialogueDocumentId)}`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function serializeGddScriptBranchSnapshot(
  attributes: GddScriptBranchSnapshotAttributes,
): string {
  if (!parseGddScriptBranchSnapshotAttributes(attributes)) {
    throw new Error('Invalid GddScriptBranchSnapshot attributes');
  }
  const ordered = REQUIRED_PROPERTIES.map(
    (key) => `${key}="${escapeAttribute(attributes[key])}"`,
  ).join(' ');
  return `<GddScriptBranchSnapshot ${ordered} />`;
}
