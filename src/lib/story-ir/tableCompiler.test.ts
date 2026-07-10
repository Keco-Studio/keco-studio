import { describe, expect, it } from '@jest/globals';
import type { StoryDocument, StoryOption } from './schema';
import { buildStoryColumns, compileStoryTable } from './tableCompiler';

const ref = { sourceId: 'src', unitId: 'src:0', start: 0, end: 1 };

function option(index: number): StoryOption {
  return {
    text: `Choice ${index}`,
    target: `O${index}`,
    commands: [{
      source: `$trust+=${index}`,
      variable: 'trust',
      operator: '+=',
      value: index,
      sourceRefs: [ref],
    }],
    sourceRefs: [ref],
  };
}

function document(optionCount: number): StoryDocument {
  return {
    version: 1,
    entryLabel: 'Start',
    nodes: [{
      label: 'Start',
      type: 'dialogue',
      speaker: 'Guide',
      content: 'Choose',
      commands: [],
      options: Array.from({ length: optionCount }, (_, index) => option(index + 1)),
      sourceRefs: [ref],
    }],
  };
}

function cell(columns: string[], row: string[], name: string): string {
  return row[columns.indexOf(name)];
}

describe('Story IR table compiler', () => {
  it('omits option columns for a linear story', () => {
    expect(compileStoryTable(document(0)).columns).not.toContain('Option0');
  });

  it('creates text, target, and command columns for every option', () => {
    const compiled = compileStoryTable(document(3));
    expect(compiled.columns).toEqual(expect.arrayContaining([
      'Option2',
      'Option2_Next',
      'Option2_Commands',
    ]));
    expect(cell(compiled.columns, compiled.rows[0], 'Option2')).toBe('Choice 3');
    expect(cell(compiled.columns, compiled.rows[0], 'Option2_Next')).toBe('Jump O3');
    expect(cell(compiled.columns, compiled.rows[0], 'Option2_Commands')).toBe('$trust+=3');
  });

  it('sorts dynamic option triplets numerically beyond option nine', () => {
    const columns = buildStoryColumns(12);
    expect(columns.indexOf('Option10')).toBe(columns.indexOf('Option9_Commands') + 1);
    expect(columns.indexOf('Option11_Commands')).toBe(columns.indexOf('Voice') - 1);
  });

  it('serializes node commands and unconditional jumps in order', () => {
    const story = document(0);
    story.nodes[0].commands = [{
      source: '$trust=1',
      variable: 'trust',
      operator: '=',
      value: 1,
      sourceRefs: [ref],
    }];
    story.nodes[0].next = 'Oend';
    const compiled = compileStoryTable(story);

    expect(cell(compiled.columns, compiled.rows[0], 'Commands')).toBe('$trust=1; Jump Oend');
  });
});
