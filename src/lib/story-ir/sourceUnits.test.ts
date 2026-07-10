import { describe, expect, it } from '@jest/globals';
import { MAX_SOURCE_BYTES, unitizeSource } from './sourceUnits';

describe('Story source units', () => {
  it('preserves exact offsets while skipping blank lines', () => {
    expect(unitizeSource('A\n\nB', 'src').map((unit) => [
      unit.id,
      unit.text,
      unit.start,
      unit.end,
    ])).toEqual([
      ['src:0', 'A', 0, 1],
      ['src:1', 'B', 3, 4],
    ]);
  });

  it('preserves CRLF line content without including the line ending', () => {
    expect(unitizeSource('first\r\nsecond', 'src')).toMatchObject([
      { text: 'first', start: 0, end: 5 },
      { text: 'second', start: 7, end: 13 },
    ]);
  });

  it('rejects empty input', () => {
    expect(() => unitizeSource(' \n\n ', 'src')).toThrow(/content/i);
  });

  it('rejects source larger than ten megabytes', () => {
    expect(() => unitizeSource('x'.repeat(MAX_SOURCE_BYTES + 1), 'src')).toThrow(/10 MB/i);
  });
});
