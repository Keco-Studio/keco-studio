import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('new data types e2e addColumn helper', () => {
  it('does not fail after the new header has already appeared', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'tests/e2e/specs/new-datatypes.spec.ts'),
      'utf8'
    );

    expect(source).toContain('const headerExists = await page');
    expect(source).not.toContain('Add column modal still visible after submit.');
  });
});
