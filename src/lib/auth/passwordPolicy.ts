export const MINIMUM_PASSWORD_LENGTH = 12;

export function getNewPasswordValidationError(
  password: string,
  confirmation: string
): string | null {
  if (password !== confirmation) {
    return 'Passwords do not match';
  }
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    return `Password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`;
  }
  return null;
}
