export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isDuplicateEmailError(error: unknown): boolean {
  let message = '';

  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String((error as { message: unknown }).message);
  }

  return /already registered|already been registered|already exists|email address is already in use/i.test(
    message
  );
}
