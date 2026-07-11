import type { StoryCommand, StoryDocument, StoryNode } from './schema';
import { buildStoryColumns, STORY_BASE_COLUMNS } from './tableFormat';

export { buildStoryColumns, STORY_BASE_COLUMNS } from './tableFormat';

export interface CompiledStoryTable {
  columns: string[];
  rows: string[][];
}

type IncomingEdge =
  | { kind: 'entry' }
  | { kind: 'next'; sourceLabel: string }
  | {
      kind: 'option';
      sourceLabel: string;
      optionIndex: number;
      commands: StoryCommand[];
    };

type OptionPlacement = {
  movedCommandsByTarget: Map<string, StoryCommand[]>;
  commandColumnIndexes: Set<number>;
};

export function compileStoryTable(document: StoryDocument): CompiledStoryTable {
  const nodeIndex = validateDocument(document);
  const incoming = analyzeIncomingEdges(document);
  const placement = planOptionCommandPlacement(document, incoming);
  const maxOptions = Math.max(0, ...document.nodes.map((node) => node.options.length));
  const columns = buildStoryColumns(maxOptions, placement.commandColumnIndexes);
  const labels = requiredLabels(document, nodeIndex);

  return {
    columns,
    rows: document.nodes.map((node, index) => compileNode(
      node,
      index,
      document,
      columns,
      labels,
      placement
    )),
  };
}

function validateDocument(document: StoryDocument): Map<string, number> {
  const nodeIndex = new Map<string, number>();
  document.nodes.forEach((node, index) => {
    if (nodeIndex.has(node.label)) {
      throw new Error(`Duplicate story label "${node.label}"`);
    }
    nodeIndex.set(node.label, index);
  });

  if (!nodeIndex.has(document.entryLabel)) {
    throw new Error(`Story entry target "${document.entryLabel}" does not exist`);
  }

  for (const node of document.nodes) {
    if (node.next && !nodeIndex.has(node.next)) {
      throw new Error(`Story target "${node.next}" from "${node.label}" does not exist`);
    }
    for (const option of node.options) {
      if (!nodeIndex.has(option.target)) {
        throw new Error(`Story option target "${option.target}" from "${node.label}" does not exist`);
      }
    }
  }

  return nodeIndex;
}

function analyzeIncomingEdges(document: StoryDocument): Map<string, IncomingEdge[]> {
  const incoming = new Map(document.nodes.map((node) => [node.label, [] as IncomingEdge[]]));
  incoming.get(document.entryLabel)?.push({ kind: 'entry' });

  for (const node of document.nodes) {
    if (node.next) {
      incoming.get(node.next)?.push({ kind: 'next', sourceLabel: node.label });
    }
    node.options.forEach((option, optionIndex) => {
      incoming.get(option.target)?.push({
        kind: 'option',
        sourceLabel: node.label,
        optionIndex,
        commands: option.commands,
      });
    });
  }
  return incoming;
}

function planOptionCommandPlacement(
  document: StoryDocument,
  incoming: Map<string, IncomingEdge[]>
): OptionPlacement {
  const movedCommandsByTarget = new Map<string, StoryCommand[]>();
  const safeTargets = new Set<string>();

  for (const node of document.nodes) {
    const edges = incoming.get(node.label) ?? [];
    const optionEdges = edges.filter(
      (edge): edge is Extract<IncomingEdge, { kind: 'option' }> => edge.kind === 'option'
    );
    if (
      node.label !== document.entryLabel
      && optionEdges.length > 0
      && optionEdges.length === edges.length
      && optionEdges.every((edge) => sameCommands(edge.commands, optionEdges[0].commands))
    ) {
      safeTargets.add(node.label);
      if (optionEdges[0].commands.length > 0) {
        movedCommandsByTarget.set(node.label, optionEdges[0].commands);
      }
    }
  }

  const commandColumnIndexes = new Set<number>();
  for (const node of document.nodes) {
    node.options.forEach((option, optionIndex) => {
      if (option.commands.length > 0 && !safeTargets.has(option.target)) {
        commandColumnIndexes.add(optionIndex);
      }
    });
  }

  return { movedCommandsByTarget, commandColumnIndexes };
}

function requiredLabels(
  document: StoryDocument,
  nodeIndex: Map<string, number>
): Set<string> {
  const labels = new Set<string>([document.entryLabel]);
  document.nodes.forEach((node, index) => {
    node.options.forEach((option) => labels.add(option.target));
    if (node.next && nodeIndex.get(node.next) !== index + 1) {
      labels.add(node.next);
    }
  });
  return labels;
}

function compileNode(
  node: StoryNode,
  index: number,
  document: StoryDocument,
  columns: string[],
  labels: Set<string>,
  placement: OptionPlacement
): string[] {
  const movedCommands = placement.movedCommandsByTarget.get(node.label) ?? [];
  const physicalNext = document.nodes[index + 1]?.label;
  const control = node.next
    ? node.next === physicalNext ? '' : `Jump ${node.next}`
    : node.options.length === 0 && index < document.nodes.length - 1 ? 'End' : '';
  const values = new Map<string, string>([
    ['Label', labels.has(node.label) ? node.label : ''],
    ['Type', node.type === 'dialogue' ? '1' : '2'],
    ['Name', node.speaker ?? ''],
    ['Content', node.content],
    ['Commands', [serializeCommands(movedCommands), serializeCommands(node.commands), control]
      .filter(Boolean)
      .join('; ')],
  ]);

  node.options.forEach((option, optionIndex) => {
    values.set(`Option${optionIndex}`, option.text);
    values.set(`Option${optionIndex}_Next`, `Jump ${option.target}`);
    if (placement.commandColumnIndexes.has(optionIndex)) {
      values.set(`Option${optionIndex}_Commands`, serializeCommands(option.commands));
    }
  });

  return columns.map((column) => values.get(column) ?? '');
}

function sameCommands(left: StoryCommand[], right: StoryCommand[]): boolean {
  return serializeCommands(left) === serializeCommands(right);
}

export function serializeCommands(commands: StoryCommand[]): string {
  return commands.map((command) => command.source).join('; ');
}
