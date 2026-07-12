import type { StoryCommand, StoryDocument, StoryNode } from './schema';
import { buildStoryColumns, STORY_BASE_COLUMNS } from './tableFormat';

export { buildStoryColumns, STORY_BASE_COLUMNS } from './tableFormat';

export interface CompiledStoryTable {
  columns: string[];
  rows: string[][];
}

type OptionPlacement = {
  commandColumnIndexes: Set<number>;
};

export function compileStoryTable(document: StoryDocument): CompiledStoryTable {
  const nodeIndex = validateDocument(document);
  const placement = planOptionCommandPlacement(document);
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

function planOptionCommandPlacement(document: StoryDocument): OptionPlacement {
  const commandColumnIndexes = new Set<number>();
  for (const node of document.nodes) {
    node.options.forEach((option, optionIndex) => {
      if (option.commands.length > 0) {
        commandColumnIndexes.add(optionIndex);
      }
    });
  }

  return { commandColumnIndexes };
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
  const physicalNext = document.nodes[index + 1]?.label;
  const control = node.next
    ? node.next === physicalNext ? '' : `Jump ${node.next}`
    : node.options.length === 0 && index < document.nodes.length - 1 ? 'End' : '';
  const values = new Map<string, string>([
    ['Label', labels.has(node.label) ? node.label : ''],
    ['Type', compileNodeType(node)],
    ['Name', node.speaker ?? ''],
    ['Content', node.content],
    ['Commands', [serializeCommands(node.commands), control]
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

function compileNodeType(node: StoryNode): string {
  if (node.presentationType) return String(node.presentationType);
  switch (node.type) {
    case 'dialogue':
      return '1';
    case 'narration':
      return '3';
    case 'scene':
      return '4';
    case 'system':
      return '5';
  }
}

export function serializeCommands(commands: StoryCommand[]): string {
  return commands.map((command) => command.source).join('; ');
}
