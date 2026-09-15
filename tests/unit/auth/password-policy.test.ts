import { describe, expect, it } from '@jest/globals';
import { getNewPasswordValidationError } from '@/lib/auth/passwordPolicy';

describe('new password validation', () => {
  it('requires a password', () => {
    expect(getNewPasswordValidationError('', '')).toBe('Password is required');
  });

  it('allows a matching non-empty password without a client-side length rule', () => {
    expect(getNewPasswordValidationError('Abc123', 'Abc123')).toBeNull();
  });

  it('requires matching confirmation', () => {
    expect(
      getNewPasswordValidationError('Abc123', 'Xyz789')
    ).toBe('Passwords do not match');
  });
});
