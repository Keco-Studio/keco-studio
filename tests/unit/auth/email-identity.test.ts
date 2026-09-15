import { describe, expect, it } from '@jest/globals';
import {
  isDuplicateEmailError,
  normalizeEmail,
} from '@/lib/auth/emailIdentity';

describe('email identity helpers', () => {
  it('normalizes only surrounding whitespace and letter case', () => {
    expect(normalizeEmail('  User.Name+tag@Example.COM  ')).toBe(
      'user.name+tag@example.com'
    );
    expect(normalizeEmail('a.b@gmail.com')).not.toBe(
      normalizeEmail('ab@gmail.com')
    );
    expect(normalizeEmail('user+one@example.com')).not.toBe(
      normalizeEmail('user@example.com')
    );
  });

  it.each([
    new Error('User already registered'),
    { message: 'A user with this email address has already been registered' },
    { message: 'Email address is already in use' },
  ])('recognizes provider duplicate-email errors', (error) => {
    expect(isDuplicateEmailError(error)).toBe(true);
  });

  it.each([
    new Error('Network request failed'),
    { message: 'Password should be at least 12 characters' },
    null,
  ])('does not classify unrelated failures as duplicate email', (error) => {
    expect(isDuplicateEmailError(error)).toBe(false);
  });
});
