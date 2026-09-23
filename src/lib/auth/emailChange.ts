import { normalizeEmail } from './emailIdentity';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidEmailChange = {
  currentEmail: string;
  newEmail: string;
};

export function validateEmailChangeIdentity(
  authoritativeEmail: string,
  enteredCurrentEmail: string,
  enteredNewEmail: string,
): ValidEmailChange {
  const currentEmail = normalizeEmail(authoritativeEmail);
  const enteredCurrent = normalizeEmail(enteredCurrentEmail);
  const newEmail = normalizeEmail(enteredNewEmail);

  if (enteredCurrent !== currentEmail) {
    throw new Error('Current email does not match your signed-in account.');
  }
  if (!EMAIL_RE.test(newEmail)) throw new Error('Enter a valid new email address.');
  if (newEmail === currentEmail) {
    throw new Error('New email must be different from your current email.');
  }
  return { currentEmail, newEmail };
}

export function pendingEmailFromUser(user: { email?: string | null; new_email?: string | null }): string | null {
  const current = user.email ? normalizeEmail(user.email) : '';
  const pending = user.new_email ? normalizeEmail(user.new_email) : '';
  return pending && pending !== current ? pending : null;
}

export function emailChangeErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  if (/already registered|already been registered|already exists|already in use/i.test(message)) {
    return 'That email address is already in use.';
  }
  if (/expired|expire/i.test(message)) return 'This verification code has expired.';
  if (/invalid token|invalid.*code|otp/i.test(message)) return 'That verification code is incorrect.';
  return 'Unable to change your email right now. Please try again.';
}
