import { hasDomTextSelection } from '@/components/libraries/utils/domTextSelection';

describe('hasDomTextSelection', () => {
  it('returns false for null / collapsed / empty', () => {
    expect(hasDomTextSelection(null)).toBe(false);
    expect(hasDomTextSelection({ isCollapsed: true, toString: () => 'x' })).toBe(false);
    expect(hasDomTextSelection({ isCollapsed: false, toString: () => '' })).toBe(false);
  });

  it('returns true for a non-empty range', () => {
    expect(hasDomTextSelection({ isCollapsed: false, toString: () => 'dog' })).toBe(true);
  });
});
