import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findAccountedStorageWrites, runAccountedStorageWriteCheck } from '../../../scripts/check-accounted-storage-writes';

describe('accounted storage write guard', () => {
  it('fails with the file and line for an unallowlisted direct upload', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'storage-write-guard-'));
    const fixture = path.join(rootDir, 'unsafe.ts');
    writeFileSync(fixture, "\nconst result = storage.from('map-assets').upload('path.png', file);\n");
    const output: string[] = [];
    try {
      expect(findAccountedStorageWrites(rootDir, new Set())).toEqual([
        { file: 'unsafe.ts', line: 2, bucketId: 'map-assets', operation: 'upload' },
      ]);
      expect(runAccountedStorageWriteCheck({ rootDir, allowlist: new Set(), writeOutput: line => output.push(line) }).exitCode).toBe(1);
      expect(output).toEqual(['unsafe.ts:2 direct upload to accounted bucket map-assets']);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('accepts an allowlisted coordinator and ignores test fixtures', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'storage-write-guard-'));
    try {
      writeFileSync(path.join(rootDir, 'coordinator.ts'), "const bucket = storage.from('map-assets');\nawait bucket.upload('path.png', file);\n");
      writeFileSync(path.join(rootDir, 'test.test.ts'), "storage.from('map-assets').remove(['path.png']);\n");
      expect(runAccountedStorageWriteCheck({ rootDir, allowlist: new Set(['coordinator.ts']) })).toEqual({ exitCode: 0, violations: [] });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('ignores other worktrees while reporting direct writes in the scan root', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'storage-write-guard-'));
    try {
      writeFileSync(path.join(rootDir, 'unsafe.ts'), "storage.from('map-assets').upload('path.png', file);\n");
      const worktreeDir = path.join(rootDir, '.worktrees', 'other-checkout');
      mkdirSync(worktreeDir, { recursive: true });
      writeFileSync(path.join(worktreeDir, 'unsafe.ts'), "storage.from('map-assets').upload('path.png', file);\n");

      expect(findAccountedStorageWrites(rootDir, new Set())).toEqual([
        { file: 'unsafe.ts', line: 1, bucketId: 'map-assets', operation: 'upload' },
      ]);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
