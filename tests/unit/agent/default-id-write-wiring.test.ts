import { readFileSync } from 'node:fs';

const preExecuteFiles = [
  'src/lib/agent/tools/create-asset.ts',
  'src/lib/agent/tools/update-asset.ts',
];

describe('Agent default ID cleanup wiring', () => {
  it.each(preExecuteFiles)('%s removes the unused default before semantic field resolution', (file) => {
    const source = readFileSync(file, 'utf8');
    const cleanupIndex = source.indexOf('removeUnusedDefaultIdField(');
    const resolutionIndex = source.indexOf('resolvePropertyValues(', cleanupIndex);
    const refreshIndex = source.lastIndexOf('getLibraryProperties(', resolutionIndex);

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(resolutionIndex).toBeGreaterThan(cleanupIndex);
    expect(refreshIndex).toBeGreaterThan(cleanupIndex);
    expect(source).toContain('if (cleanup.removed)');
    expect(source).toContain('getLibraryProperties(');
  });

  it('keeps update_row preview read-only and removes the field before confirmed import', () => {
    const source = readFileSync('src/lib/agent/workflows/update-row.ts', 'utf8');
    const importIndex = source.indexOf('async function executeImport(');
    const previewSource = source.slice(0, importIndex);
    const importSource = source.slice(importIndex);
    const cleanupIndex = importSource.indexOf('removeUnusedDefaultIdField(');
    const writeIndex = importSource.indexOf('updateAssetService(');

    expect(importIndex).toBeGreaterThan(-1);
    expect(previewSource).not.toContain('removeUnusedDefaultIdField(');
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(cleanupIndex);
  });
});
