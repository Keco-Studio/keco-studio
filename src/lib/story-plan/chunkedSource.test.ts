import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from './sourceSegments';
import { chunkStorySource } from './chunkedSource';

describe('chunked story source', () => {
  it('preserves exact source units and prefers story boundaries', () => {
    const source = segmentStorySource([
      '【Scene one】',
      'Lin Mo: The diary in the office.',
      'Su Wan: We must go again.',
      '【Branch point A】',
      'Lin Mo: Survey first.',
      '→ Ending one: Lost door',
      '【Branch point B】',
      'Lin Mo: Leave now.',
      '【Branch point A1】',
      '→ Ending two: Eternal exile',
    ].join('\n'), 'fixture');

    const chunks = chunkStorySource(source, 50);
    const originalIds = source.units.map((unit) => unit.id);
    const chunkIds = chunks.flatMap((chunk) => chunk.units.map((unit) => unit.id));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunkIds).toEqual(originalIds);
    expect(chunks.every((chunk) => chunk.segments.every((segment) => (
      chunk.units.some((unit) => unit.id === segment.unitId)
    )))).toBe(true);
  });

  it('keeps a very long indivisible unit intact', () => {
    const source = segmentStorySource(`【Scene one】\n${'LongParagraph'.repeat(100)}`, 'fixture');
    const chunks = chunkStorySource(source, 20);

    expect(chunks.flatMap((chunk) => chunk.units.map((unit) => unit.text)))
      .toEqual(source.units.map((unit) => unit.text));
    expect(chunks).toHaveLength(1);
  });
});
