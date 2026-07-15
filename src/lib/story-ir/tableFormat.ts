export const STORY_BASE_COLUMNS = [
  'Label',
  'Type',
  'Name',
  'Content',
  'If',
  'Commands',
  'Fg',
  'Fg1',
  'Cg',
  'Option0',
  'Option0_Next',
  'Option1',
  'Option1_Next',
  'Option2',
  'Option2_Next',
  'Voice',
  'Bg',
] as const;

export const STORY_COLUMN_DESCRIPTIONS: Record<string, string> = {
  Label: 'Story jump node',
  Type: '1 blue dialogue box, 2 pink, 3 gray, 4 no dialogue box, 5 screen center',
  Name: 'Speaker',
  Content: 'Dialogue and options',
  If: 'Trigger condition',
  Commands: 'Command list',
  Fg: 'Left-side portrait',
  Fg1: 'Right-side portrait',
  Cg: 'CG image',
  Voice: 'Voice-over path',
  Bg: 'Background image',
};

export const STORY_COLUMN_WIDTHS: Record<string, number | undefined> = {
  Content: 51,
  Commands: 17,
  Bg: 14,
};

export function buildStoryColumns(
  maxOptions: number,
  commandOptionIndexes: ReadonlySet<number> = new Set()
): string[] {
  if (!Number.isInteger(maxOptions) || maxOptions < 0) {
    throw new Error('Maximum option count must be a non-negative integer');
  }

  const extensions: string[] = [];
  for (let index = 0; index < maxOptions; index += 1) {
    if (index >= 3) {
      extensions.push(`Option${index}`, `Option${index}_Next`);
    }
    if (commandOptionIndexes.has(index)) {
      extensions.push(`Option${index}_Commands`);
    }
  }
  return [...STORY_BASE_COLUMNS, ...extensions];
}

export function isStoryTableColumns(columns: string[]): boolean {
  if (columns.length < STORY_BASE_COLUMNS.length) return false;
  if (!STORY_BASE_COLUMNS.every((column, index) => columns[index] === column)) return false;

  let maxOptions = 3;
  const commandOptionIndexes = new Set<number>();
  for (const column of columns.slice(STORY_BASE_COLUMNS.length)) {
    const optionMatch = /^Option(\d+)(?:_Next)?$/.exec(column);
    if (optionMatch) {
      const index = Number(optionMatch[1]);
      if (index < 3) return false;
      maxOptions = Math.max(maxOptions, index + 1);
      continue;
    }

    const commandMatch = /^Option(\d+)_Commands$/.exec(column);
    if (!commandMatch) return false;
    commandOptionIndexes.add(Number(commandMatch[1]));
  }

  const expected = buildStoryColumns(maxOptions, commandOptionIndexes);
  return expected.length === columns.length
    && expected.every((column, index) => columns[index] === column);
}
