export function getNewPasswordValidationError(
  password: string,
  confirmation: string
): string | null {
  if (!password) {
    return 'Password is required';
  }
  if (password !== confirmation) {
    return 'Passwords do not match';
  }
  return null;
}
