import { describe, expect, it } from '@jest/globals';
import { getNewPasswordValidationError } from '@/lib/auth/passwordPolicy';

describe('new password validation', () => {
  it('requires at least 12 characters', () => {
    expect(getNewPasswordValidationError('Short123!', 'Short123!')).toBe(
      'Password must be at least 12 characters'
    );
    expect(
      getNewPasswordValidationError('LongPassword123!', 'LongPassword123!')
    ).toBeNull();
  });

  it('requires matching confirmation', () => {
    expect(
      getNewPasswordValidationError('LongPassword123!', 'DifferentPassword123!')
    ).toBe('Passwords do not match');
  });
});
