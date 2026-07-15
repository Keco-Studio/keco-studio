import { describe, expect, it } from '@jest/globals';
import { resolveVisualNovelPresentation } from './visualNovelPresentation';

describe('visual novel Type presentation', () => {
  it.each([
    ['1', { kind: 'dialogue', color: 'blue', alignment: 'left' }],
    ['2', { kind: 'dialogue', color: 'pink', alignment: 'left' }],
    ['3', { kind: 'dialogue', color: 'gray', alignment: 'left' }],
    ['4', { kind: 'plain', color: null, alignment: 'left' }],
    ['5', { kind: 'fullscreen', color: null, alignment: 'center' }],
  ] as const)('uses Type %s as a presentation style', (type, expected) => {
    expect(resolveVisualNovelPresentation(type, 'Speaker')).toEqual(expected);
  });

  it('does not move Type 1 dialogue when the speaker changes', () => {
    expect(resolveVisualNovelPresentation('1', 'Orb of Light').alignment).toBe('left');
    expect(resolveVisualNovelPresentation('1', 'Old Man').alignment).toBe('left');
  });

  it('keeps legacy rows without Type readable', () => {
    expect(resolveVisualNovelPresentation(undefined, 'Guide')).toEqual({
      kind: 'dialogue',
      color: 'blue',
      alignment: 'left',
    });
    expect(resolveVisualNovelPresentation(undefined, '')).toEqual({
      kind: 'dialogue',
      color: 'gray',
      alignment: 'left',
    });
  });
});
