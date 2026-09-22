import { describe, expect, it } from '@jest/globals';
import {
  emailChangeErrorMessage,
  pendingEmailFromUser,
  validateEmailChangeIdentity,
} from '@/lib/auth/emailChange';

describe('email change helpers', () => {
  it('normalizes matching current and new email values', () => {
    expect(validateEmailChangeIdentity(' Current@Example.com ', 'current@example.com', ' New@Example.com ')).toEqual({
      currentEmail: 'current@example.com',
      newEmail: 'new@example.com',
    });
  });

  it('rejects a current-email identity mismatch and unchanged address', () => {
    expect(() => validateEmailChangeIdentity('current@example.com', 'other@example.com', 'new@example.com'))
      .toThrow('Current email does not match your signed-in account.');
    expect(() => validateEmailChangeIdentity('current@example.com', 'current@example.com', 'current@example.com'))
      .toThrow('New email must be different from your current email.');
  });

  it('maps stable Supabase OTP errors', () => {
    expect(emailChangeErrorMessage({ message: 'Token has expired' })).toBe('This verification code has expired.');
    expect(emailChangeErrorMessage({ message: 'Invalid token' })).toBe('That verification code is incorrect.');
    expect(emailChangeErrorMessage({ message: 'Email address is already in use' })).toBe('That email address is already in use.');
  });

  it('reads a pending new email without trusting unrelated metadata', () => {
    expect(pendingEmailFromUser({ email: 'old@example.com', new_email: 'new@example.com' })).toBe('new@example.com');
    expect(pendingEmailFromUser({ email: 'old@example.com', new_email: 'old@example.com' })).toBeNull();
  });
});
