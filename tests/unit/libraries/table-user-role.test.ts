import { describe, expect, it } from '@jest/globals';
import { resolveTableUserRole } from '@/components/libraries/utils/tableUserRole';

describe('resolveTableUserRole', () => {
  it('uses the role already resolved by the library page', () => {
    expect(resolveTableUserRole('editor', null)).toBe('editor');
  });

  it('falls back to the table role lookup only when the page role is unavailable', () => {
    expect(resolveTableUserRole(undefined, 'admin')).toBe('admin');
  });

  it('treats the loaded project owner as admin before a role request resolves', () => {
    expect(resolveTableUserRole(undefined, null, true)).toBe('admin');
  });
});
