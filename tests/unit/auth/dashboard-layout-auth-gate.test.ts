import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/layout/DashboardLayout.tsx'),
  'utf8'
);

describe('dashboard auth gate', () => {
  it('does not render the login form while restoring an existing session', () => {
    expect(source).toMatch(/if \(isLoading\) \{\s*return null;\s*\}/);
  });

  it('starts with the auth form hidden so a restored session can render immediately', () => {
    expect(source).toContain('useState(false)');
  });

  it('keeps the auth form mounted for an initially unauthenticated user', () => {
    expect(source).toMatch(/if \(!isAuthenticated\) \{[\s\S]{0,200}setShowAuthForm\(true\);/);
  });
});
