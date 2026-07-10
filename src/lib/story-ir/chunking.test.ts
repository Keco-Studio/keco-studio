import { describe, expect, it } from '@jest/globals';
import type { StoryDocument } from './schema';
import { unitizeSource } from './sourceUnits';
import { chunkSourceUnits, mergeStoryChunks } from './chunking';

describe('Story source chunking', () => {
  it('assigns every authoritative unit to exactly one chunk in order', () => {
    const units = unitizeSource('first line\nsecond line\nthird line', 'src');
    const chunks = chunkSourceUnits(units, { maxChars: 18 });

    expect(chunks.flatMap((chunk) => chunk.units.map((unit) => unit.id)))
      .toEqual(units.map((unit) => unit.id));
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  it('rejects a single source unit that exceeds the chunk limit', () => {
    const units = unitizeSource('a'.repeat(31), 'src');
    expect(() => chunkSourceUnits(units, { maxChars: 30 })).toThrow(/source unit/i);
  });

  it('merges partial documents in source order', () => {
    const make = (entryLabel: string, labels: string[]): StoryDocument => ({
      version: 1,
      entryLabel,
      nodes: labels.map((label) => ({
        label,
        type: 'narration',
        content: label,
        commands: [],
        options: [],
        sourceRefs: [{ sourceId: 'src', unitId: `src:${label}`, start: 0, end: 1 }],
      })),
    });

    expect(mergeStoryChunks([make('Start', ['Start', 'O1']), make('Oend', ['Oend'])]))
      .toMatchObject({ entryLabel: 'Start', nodes: [{ label: 'Start' }, { label: 'O1' }, { label: 'Oend' }] });
  });
});
