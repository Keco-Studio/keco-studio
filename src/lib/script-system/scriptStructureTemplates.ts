import type { FlowGraph } from './buildScriptFlowGraph';
import {
  deriveScriptWorkspaceStructure,
  type ScriptStructureCounts,
} from './scriptWorkspaceStructure';

const STORAGE_KEY = 'keco.script.structureTemplates.v1';
const STORAGE_VERSION = 1;
const MAX_NAME_LENGTH = 80;

export type ScriptStructureTemplate = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  graph: FlowGraph;
  counts: ScriptStructureCounts;
  isBuiltIn: boolean;
};

export type SaveScriptStructureTemplateInput = {
  name: string;
  description?: string;
  graph: FlowGraph;
  /** Optional deterministic values used by importers and tests. */
  now?: string;
  id?: string;
};

type StoredTemplates = {
  version: typeof STORAGE_VERSION;
  templates: ScriptStructureTemplate[];
};

function cloneGraph(graph: FlowGraph): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, rowIndexes: [...node.rowIndexes] })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function cloneTemplate(template: ScriptStructureTemplate): ScriptStructureTemplate {
  return {
    ...template,
    graph: cloneGraph(template.graph),
    counts: { ...template.counts },
  };
}

function createTemplate(
  id: string,
  name: string,
  description: string,
  graph: FlowGraph,
): ScriptStructureTemplate {
  return {
    id,
    name,
    description,
    createdAt: 'built-in',
    graph: cloneGraph(graph),
    counts: deriveScriptWorkspaceStructure(graph).counts,
    isBuiltIn: true,
  };
}

function deepFreezeTemplate(template: ScriptStructureTemplate): ScriptStructureTemplate {
  template.graph.nodes.forEach((node) => {
    Object.freeze(node.rowIndexes);
    Object.freeze(node);
  });
  template.graph.edges.forEach(Object.freeze);
  Object.freeze(template.graph.nodes);
  Object.freeze(template.graph.edges);
  Object.freeze(template.graph);
  Object.freeze(template.counts);
  return Object.freeze(template);
}

const linearGraph: FlowGraph = {
  nodes: [
    { id: 'entry', label: 'Opening', rowIndex: 0, rowIndexes: [0] },
    { id: 'scene', label: 'Scene Progression', rowIndex: 1, rowIndexes: [1] },
    { id: 'ending', label: 'Ending', rowIndex: 2, rowIndexes: [2] },
  ],
  edges: [{ from: 'entry', to: 'scene' }, { from: 'scene', to: 'ending' }],
};

const mergeGraph: FlowGraph = {
  nodes: [
    { id: 'entry', label: 'Opening', rowIndex: 0, rowIndexes: [0] },
    { id: 'choice', label: 'Choice', rowIndex: 1, rowIndexes: [1] },
    { id: 'branch-a', label: 'Branch A', rowIndex: 2, rowIndexes: [2] },
    { id: 'branch-b', label: 'Branch B', rowIndex: 3, rowIndexes: [3] },
    { id: 'merge', label: 'Merge', rowIndex: 4, rowIndexes: [4] },
    { id: 'ending', label: 'Ending', rowIndex: 5, rowIndexes: [5] },
  ],
  edges: [
    { from: 'entry', to: 'choice' },
    { from: 'choice', to: 'branch-a', optionIndex: 0, optionText: 'Choose A' },
    { from: 'choice', to: 'branch-b', optionIndex: 1, optionText: 'Choose B' },
    { from: 'branch-a', to: 'merge' },
    { from: 'branch-b', to: 'merge' },
    { from: 'merge', to: 'ending' },
  ],
};

const independentEndingsGraph: FlowGraph = {
  nodes: [
    { id: 'entry', label: 'Opening', rowIndex: 0, rowIndexes: [0] },
    { id: 'choice', label: 'Choice', rowIndex: 1, rowIndexes: [1] },
    { id: 'ending-a', label: 'Ending A', rowIndex: 2, rowIndexes: [2] },
    { id: 'ending-b', label: 'Ending B', rowIndex: 3, rowIndexes: [3] },
  ],
  edges: [
    { from: 'entry', to: 'choice' },
    { from: 'choice', to: 'ending-a', optionIndex: 0, optionText: 'Choose A' },
    { from: 'choice', to: 'ending-b', optionIndex: 1, optionText: 'Choose B' },
  ],
};

export const BUILT_IN_SCRIPT_TEMPLATES: readonly ScriptStructureTemplate[] = Object.freeze([
  deepFreezeTemplate(createTemplate('built-in-linear', 'Linear Scene', 'Progress sequentially toward a single ending', linearGraph)),
  deepFreezeTemplate(createTemplate('built-in-merge', 'Two Branches Rejoin', 'Two choice branches rejoin later in the story', mergeGraph)),
  deepFreezeTemplate(createTemplate(
    'built-in-independent-endings',
    'Two Branches with Separate Endings',
    'Two choices lead to different endings',
    independentEndingsGraph,
  )),
]);

function isGraph(value: unknown): value is FlowGraph {
  if (!value || typeof value !== 'object') return false;
  const graph = value as Partial<FlowGraph>;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return false;
  return graph.nodes.every((node) => (
    node && typeof node.id === 'string' && typeof node.label === 'string'
    && typeof node.rowIndex === 'number' && Array.isArray(node.rowIndexes)
  )) && graph.edges.every((edge) => (
    edge && typeof edge.from === 'string' && typeof edge.to === 'string'
  ));
}

function parseStoredTemplate(value: unknown): ScriptStructureTemplate | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ScriptStructureTemplate>;
  if (
    typeof candidate.id !== 'string'
    || typeof candidate.name !== 'string'
    || typeof candidate.createdAt !== 'string'
    || !isGraph(candidate.graph)
  ) return undefined;
  const graph = cloneGraph(candidate.graph);
  return {
    id: candidate.id,
    name: candidate.name.trim().slice(0, MAX_NAME_LENGTH),
    ...(typeof candidate.description === 'string' && candidate.description.trim()
      ? { description: candidate.description.trim() }
      : {}),
    createdAt: candidate.createdAt,
    graph,
    counts: deriveScriptWorkspaceStructure(graph).counts,
    isBuiltIn: false,
  };
}

export function readScriptStructureTemplates(storage: Pick<Storage, 'getItem'>): ScriptStructureTemplate[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredTemplates>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.templates)) return [];
    return parsed.templates.flatMap((template) => {
      const valid = parseStoredTemplate(template);
      return valid && valid.name ? [cloneTemplate(valid)] : [];
    });
  } catch {
    return [];
  }
}

function writeTemplates(
  storage: Pick<Storage, 'setItem'>,
  templates: ScriptStructureTemplate[],
): void {
  const payload: StoredTemplates = { version: STORAGE_VERSION, templates };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function generatedId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ? `personal-${randomId}` : `personal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function saveScriptStructureTemplate(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  input: SaveScriptStructureTemplateInput,
): ScriptStructureTemplate {
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) throw new Error('Please enter a template name');
  const graph = cloneGraph(input.graph);
  const template: ScriptStructureTemplate = {
    id: input.id ?? generatedId(),
    name,
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
    createdAt: input.now ?? new Date().toISOString(),
    graph,
    counts: deriveScriptWorkspaceStructure(graph).counts,
    isBuiltIn: false,
  };
  writeTemplates(storage, [...readScriptStructureTemplates(storage), template]);
  return cloneTemplate(template);
}

export function deleteScriptStructureTemplate(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  id: string,
): void {
  writeTemplates(
    storage,
    readScriptStructureTemplates(storage).filter((template) => template.id !== id),
  );
}
