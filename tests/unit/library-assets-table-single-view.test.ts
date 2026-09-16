import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(process.cwd(), 'src/components/libraries/LibraryAssetsTable.tsx'),
  'utf8',
);

describe('library assets table view', () => {
  it('keeps assets in the table view without a grid-view switcher', () => {
    expect(source).not.toContain('LibraryAssetsGrid');
    expect(source).not.toContain("useState<'grid' | 'table'>");
    expect(source).not.toContain('aria-label="Grid view"');
    expect(source).not.toContain('aria-label="Table view"');
    expect(source).toContain('<LibraryAssetsTableBody');
  });
});
