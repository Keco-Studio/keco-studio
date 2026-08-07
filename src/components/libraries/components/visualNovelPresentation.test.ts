import { describe, expect, it } from '@jest/globals';
import { resolveVisualNovelPresentation } from './visualNovelPresentation';

describe('visual novel Type presentation', () => {
  it.each([
    ['1', { kind: 'dialogue', color: 'blue', alignment: 'right' }],
    ['2', { kind: 'dialogue', color: 'pink', alignment: 'left' }],
    ['3', { kind: 'dialogue', color: 'gray', alignment: 'left' }],
    ['4', { kind: 'plain', color: null, alignment: 'center' }],
    ['5', { kind: 'fullscreen', color: null, alignment: 'center' }],
  ] as const)('uses Type %s as a presentation style', (type, expected) => {
    expect(resolveVisualNovelPresentation(type, 'Speaker')).toEqual(expected);
  });

  it('keeps Type 1 dialogue on the right regardless of speaker', () => {
    expect(resolveVisualNovelPresentation('1', 'Orb of Light').alignment).toBe('right');
    expect(resolveVisualNovelPresentation('1', 'Old Man').alignment).toBe('right');
  });

  it('keeps legacy rows without Type readable', () => {
    expect(resolveVisualNovelPresentation(undefined, 'Guide')).toEqual({
      kind: 'dialogue',
      color: 'blue',
      alignment: 'right',
    });
    expect(resolveVisualNovelPresentation(undefined, '')).toEqual({
      kind: 'dialogue',
      color: 'gray',
      alignment: 'left',
    });
  });
});
