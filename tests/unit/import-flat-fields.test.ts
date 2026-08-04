import { readFileSync } from 'node:fs';

describe('flat library import contract', () => {
  it('uses source sheets only as an import detail and writes one field order', () => {
    const source = readFileSync('src/lib/services/importService.ts', 'utf8');
    expect(source).toMatch(/ImportSheetData|sheets/);
    expect(source).toMatch(/getInternalFieldGroupColumns/);
    expect(source).toMatch(/globalFieldOrder/);
    expect(source).not.toMatch(/sectionCount/);
  });
});
