import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('name validation e2e error locators', () => {
  it('uses form dialog errors for duplicate-name checks instead of global error overlays', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'tests/e2e/specs/name-validation.spec.ts'),
      'utf8'
    );

    expect(source).toContain('formDialogError');
    expect(source).not.toContain(
      "page.locator('[class*=\"error\"]').filter({ hasText: /already exists/i })"
    );
  });
});
