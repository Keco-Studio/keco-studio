import type { StoryCommand, StoryDocument, StoryNode } from './schema';

export const STORY_CORE_COLUMNS = [
  'Label',
  'Type',
  'Name',
  'Content',
  'If',
  'Commands',
  'Fg',
  'Fg1',
  'Cg',
] as const;

export interface CompiledStoryTable {
  columns: string[];
  rows: string[][];
}

export function buildStoryColumns(maxOptions: number): string[] {
  if (!Number.isInteger(maxOptions) || maxOptions < 0) {
    throw new Error('Maximum option count must be a non-negative integer');
  }
  const optionColumns = Array.from({ length: maxOptions }, (_, index) => [
    `Option${index}`,
    `Option${index}_Next`,
    `Option${index}_Commands`,
  ]).flat();
  return [...STORY_CORE_COLUMNS, ...optionColumns, 'Voice', 'Bg'];
}

export function compileStoryTable(document: StoryDocument): CompiledStoryTable {
  const maxOptions = Math.max(0, ...document.nodes.map((node) => node.options.length));
  const columns = buildStoryColumns(maxOptions);
  return {
    columns,
    rows: document.nodes.map((node) => compileNode(node, columns)),
  };
}

function compileNode(node: StoryNode, columns: string[]): string[] {
  const values = new Map<string, string>([
    ['Label', node.label],
    ['Type', node.type === 'dialogue' ? '1' : '2'],
    ['Name', node.speaker ?? ''],
    ['Content', node.content],
    ['Commands', serializeNodeCommands(node)],
  ]);

  node.options.forEach((option, index) => {
    values.set(`Option${index}`, option.text);
    values.set(`Option${index}_Next`, `Jump ${option.target}`);
    values.set(`Option${index}_Commands`, serializeCommands(option.commands));
  });

  return columns.map((column) => values.get(column) ?? '');
}

function serializeNodeCommands(node: StoryNode): string {
  return [serializeCommands(node.commands), node.next ? `Jump ${node.next}` : '']
    .filter(Boolean)
    .join('; ');
}

export function serializeCommands(commands: StoryCommand[]): string {
  return commands.map((command) => command.source).join('; ');
}
