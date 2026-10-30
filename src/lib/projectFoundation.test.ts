import {
  GAME_GENRE_PRESETS,
  normalizeFoundationTag,
  normalizeFoundationTags,
} from '@/lib/projectFoundation';

describe('project Foundation tags', () => {
  it('collapses whitespace and restores canonical preset spelling', () => {
    expect(normalizeFoundationTag('  visual   novel ', GAME_GENRE_PRESETS)).toBe('Visual Novel');
  });

  it('deduplicates case-insensitively and keeps at most 20 tags', () => {
    const values = ['rpg', 'RPG', ...Array.from({ length: 25 }, (_, index) => `Custom ${index}`)];
    const result = normalizeFoundationTags(values, GAME_GENRE_PRESETS);
    expect(result[0]).toBe('RPG');
    expect(result).toHaveLength(20);
    expect(new Set(result.map((value) => value.toLowerCase())).size).toBe(20);
  });

  it('drops blank tags without imposing a character limit', () => {
    const long = 'A'.repeat(500);
    expect(normalizeFoundationTags([' ', long], [])).toEqual([long]);
  });
});
