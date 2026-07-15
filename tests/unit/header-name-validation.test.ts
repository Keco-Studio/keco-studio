import { validateHeaderName } from '../../src/lib/utils/headerNameValidation';

describe('header name validation', () => {
  it('accepts letters, numbers, underscores, spaces, accented letters, and hyphens', () => {
    expect(validateHeaderName('Column Name')).toBeNull();
    expect(validateHeaderName('Auto_Header 123')).toBeNull();
    expect(validateHeaderName('Café')).toBeNull();
    expect(validateHeaderName('Café Base')).toBeNull();
    expect(validateHeaderName('Column-Name')).toBeNull();
  });

  it('rejects empty or whitespace-only names', () => {
    expect(validateHeaderName('')).toBe('Header name is required.');
    expect(validateHeaderName('   ')).toBe('Header name is required.');
  });

  it('rejects disallowed characters via validateName', () => {
    expect(validateHeaderName('Column@Name')).toBe(
      'No emojis, HTML tags or !@#$% allowed',
    );
  });
});
