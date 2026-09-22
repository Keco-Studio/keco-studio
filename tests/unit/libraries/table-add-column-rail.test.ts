import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(
  path.join(process.cwd(), 'src/components/libraries/LibraryAssetsTable.module.css'),
  'utf8',
);
describe('table add-column rail', () => {
  it('keeps the fixed right-side column separated without changing the table body color', () => {
    expect(css).toMatch(/\.addColumnCell\s*\{[^}]*width:\s*40px[^}]*border-left:\s*1px solid #DDE1E6;[^}]*background:\s*#ffffff;/s);
  });
});
