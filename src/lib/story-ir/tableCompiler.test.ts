import { describe, expect, it } from '@jest/globals';
import type { StoryCommand, StoryDocument, StoryNode, StoryOption } from './schema';
import { buildStoryColumns, compileStoryTable } from './tableCompiler';

const ref = { sourceId: 'src', unitId: 'src:0', start: 0, end: 1 };

function command(source: string, value: number): StoryCommand {
  return {
    source,
    variable: 'trust',
    operator: source.includes('+=') ? '+=' : '=',
    value,
    sourceRefs: [ref],
  };
}

function node(label: string, overrides: Partial<StoryNode> = {}): StoryNode {
  return {
    label,
    type: 'narration',
    content: label,
    commands: [],
    options: [],
    sourceRefs: [ref],
    ...overrides,
  };
}

function option(text: string, target: string, commands: StoryCommand[] = []): StoryOption {
  return { text, target, commands, sourceRefs: [ref] };
}

function story(nodes: StoryNode[], entryLabel = 'Start'): StoryDocument {
  return { version: 1, entryLabel, nodes };
}

function cell(
  compiled: ReturnType<typeof compileStoryTable>,
  rowIndex: number,
  column: string
): string {
  return compiled.rows[rowIndex][compiled.columns.indexOf(column)];
}

describe('Story IR table compiler', () => {
  it('always emits the fixed 17-column reference schema', () => {
    const compiled = compileStoryTable(story([
      node('Start', { type: 'dialogue', speaker: 'Guide', content: 'Hello' }),
    ]));

    expect(compiled.columns).toEqual([
      'Label', 'Type', 'Name', 'Content', 'If', 'Commands', 'Fg', 'Fg1', 'Cg',
      'Option0', 'Option0_Next', 'Option1', 'Option1_Next',
      'Option2', 'Option2_Next', 'Voice', 'Bg',
    ]);
    expect(cell(compiled, 0, 'Type')).toBe('1');
  });

  it('uses physical fallthrough and omits ordinary sequential labels', () => {
    const compiled = compileStoryTable(story([
      node('Start', { next: 'Middle' }),
      node('Middle', { next: 'EndNode' }),
      node('EndNode'),
    ]));

    expect(cell(compiled, 0, 'Label')).toBe('Start');
    expect(cell(compiled, 0, 'Commands')).toBe('');
    expect(cell(compiled, 1, 'Label')).toBe('');
    expect(cell(compiled, 1, 'Commands')).toBe('');
    expect(cell(compiled, 2, 'Label')).toBe('');
  });

  it('labels option and non-fallthrough jump targets', () => {
    const compiled = compileStoryTable(story([
      node('Start', { options: [option('Go', 'Branch')] }),
      node('Spacer', { next: 'Merge' }),
      node('Branch', { next: 'Merge' }),
      node('Merge'),
    ]));

    expect(cell(compiled, 0, 'Option0_Next')).toBe('Jump Branch');
    expect(cell(compiled, 1, 'Commands')).toBe('Jump Merge');
    expect(cell(compiled, 2, 'Label')).toBe('Branch');
    expect(cell(compiled, 3, 'Label')).toBe('Merge');
  });

  it('ends a terminal branch before later physical rows', () => {
    const compiled = compileStoryTable(story([
      node('Start', { options: [option('Left', 'Left'), option('Right', 'Right')] }),
      node('Left'),
      node('Right'),
    ]));

    expect(cell(compiled, 1, 'Commands')).toBe('End');
    expect(cell(compiled, 2, 'Commands')).toBe('');
  });

  it('moves option commands to a uniquely entered target', () => {
    const compiled = compileStoryTable(story([
      node('Start', { options: [option('Go', 'Branch', [command('$trust+=1', 1)])] }),
      node('Branch', { commands: [command('$trust+=2', 2)] }),
    ]));

    expect(compiled.columns).not.toContain('Option0_Commands');
    expect(cell(compiled, 1, 'Commands')).toBe('$trust+=1; $trust+=2');
  });

  it('moves identical commands from option-only shared entries', () => {
    const shared = command('$trust+=1', 1);
    const compiled = compileStoryTable(story([
      node('Start', { options: [option('A', 'Shared', [shared]), option('B', 'Shared', [shared])] }),
      node('Shared'),
    ]));

    expect(compiled.columns).not.toContain('Option0_Commands');
    expect(compiled.columns).not.toContain('Option1_Commands');
    expect(cell(compiled, 1, 'Commands')).toBe('$trust+=1');
  });

  it('keeps different shared-target commands on their options', () => {
    const compiled = compileStoryTable(story([
      node('Start', {
        options: [
          option('A', 'Shared', [command('$trust+=1', 1)]),
          option('B', 'Shared', [command('$trust+=2', 2)]),
        ],
      }),
      node('Shared'),
    ]));

    expect(compiled.columns.slice(17)).toEqual(['Option0_Commands', 'Option1_Commands']);
    expect(cell(compiled, 0, 'Option0_Commands')).toBe('$trust+=1');
    expect(cell(compiled, 0, 'Option1_Commands')).toBe('$trust+=2');
    expect(cell(compiled, 1, 'Commands')).toBe('');
  });

  it('keeps option commands when the target also has a non-option entry', () => {
    const compiled = compileStoryTable(story([
      node('Start', { options: [option('Go', 'Shared', [command('$trust+=1', 1)])] }),
      node('Other', { next: 'Shared' }),
      node('Shared'),
    ]));

    expect(compiled.columns.slice(17)).toEqual(['Option0_Commands']);
    expect(cell(compiled, 0, 'Option0_Commands')).toBe('$trust+=1');
  });

  it('appends fourth and later options after the fixed schema', () => {
    expect(buildStoryColumns(4)).toEqual([
      'Label', 'Type', 'Name', 'Content', 'If', 'Commands', 'Fg', 'Fg1', 'Cg',
      'Option0', 'Option0_Next', 'Option1', 'Option1_Next',
      'Option2', 'Option2_Next', 'Voice', 'Bg', 'Option3', 'Option3_Next',
    ]);
  });

  it.each([
    ['missing entry', story([node('Start')], 'Missing'), /entry/i],
    ['missing target', story([node('Start', { next: 'Missing' })]), /target/i],
    ['duplicate label', story([node('Start'), node('Start')]), /duplicate/i],
  ])('rejects %s', (_name, document, message) => {
    expect(() => compileStoryTable(document)).toThrow(message);
  });
});
