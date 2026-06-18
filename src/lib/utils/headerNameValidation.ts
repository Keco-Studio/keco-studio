import { validateName } from './nameValidation';

export function validateHeaderName(name: string): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return 'Header name is required.';
  }
  return validateName(trimmedName);
}
