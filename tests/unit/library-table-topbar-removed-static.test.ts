import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const exists = (file: string) => existsSync(path.join(root, file));

describe('library table header starts at the top of the table frame', () => {
  it('removes the empty top bar and its table search entry point', () => {
    const table = read('src/components/libraries/LibraryAssetsTable.tsx');
    const styles = read('src/components/libraries/LibraryAssetsTable.module.css');

    expect(table).not.toContain('LibraryTableTopBar');
    expect(styles).not.toMatch(/\.tableTopBar\b/);
    expect(exists('src/components/libraries/components/LibraryTableTopBar.tsx')).toBe(false);
    expect(exists('src/components/libraries/components/TableCellFindReplace.tsx')).toBe(false);
    expect(exists('src/components/libraries/components/TableCellFindReplace.module.css')).toBe(false);
    expect(exists('src/components/libraries/hooks/useTableCellFindReplace.ts')).toBe(false);
  });

  it('renders flush with the library content edges without an outer frame', () => {
    const tableStyles = read('src/components/libraries/LibraryAssetsTable.module.css');
    const pageStyles = read('src/app/(dashboard)/[projectId]/[libraryId]/page.module.css');

    expect(tableStyles).toMatch(
      /\.tableShell\s*\{[^}]*margin-top:\s*0;[^}]*border-radius:\s*0;[^}]*border:\s*none;/s,
    );
    expect(tableStyles).toMatch(
      /\.tableContainer\s*\{[^}]*border-bottom-left-radius:\s*0;[^}]*border-bottom-right-radius:\s*0;/s,
    );
    expect(pageStyles).toMatch(/\.tableContainer\s*\{[^}]*padding:\s*0;/s);
  });
});
