import { describe, expect, it } from '@jest/globals';
import {
  hasHorizontalOverflow,
  resolveHorizontalOverflow,
} from '@/components/libraries/components/stickyHorizontalScrollbarState';

describe('hasHorizontalOverflow', () => {
  it('ignores sub-pixel width differences so the proxy scrollbar does not toggle at the boundary', () => {
    expect(hasHorizontalOverflow(801, 800)).toBe(false);
  });

  it('shows the proxy scrollbar only for meaningful horizontal overflow', () => {
    expect(hasHorizontalOverflow(802, 800)).toBe(true);
  });

  it('uses the auto-layout overflow decision instead of table intrinsic width', () => {
    expect(resolveHorizontalOverflow(802, 800, false)).toBe(false);
  });
});
