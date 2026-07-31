import {
  nestingDepthAfterMove,
  wouldCreateIdCycle,
} from '@/components/layout/sidebarNesting';

describe('sidebarNesting', () => {
  it('detects cycles when moving under a descendant', () => {
    const parentById = new Map<string, string | null>([
      ['a', null],
      ['b', 'a'],
      ['c', 'b'],
    ]);
    expect(wouldCreateIdCycle(parentById, 'a', 'c')).toBe(true);
    expect(wouldCreateIdCycle(parentById, 'a', null)).toBe(false);
    expect(wouldCreateIdCycle(parentById, 'c', 'a')).toBe(false);
  });

  it('computes depth after move', () => {
    const parentById = new Map<string, string | null>([
      ['a', null],
      ['b', 'a'],
    ]);
    expect(nestingDepthAfterMove(parentById, 'c', null)).toBe(1);
    expect(nestingDepthAfterMove(parentById, 'c', 'b')).toBe(3);
  });
});
