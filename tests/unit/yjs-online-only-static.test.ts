import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

const liveSourceFiles = [
  'src/lib/contexts/LibraryDataContext.tsx',
  'src/lib/contexts/YjsContext.tsx',
  'src/lib/library/yjsAssetHydration.ts',
];

describe('Yjs online-only static guard', () => {
  it('does not persist live Yjs documents to IndexedDB', () => {
    for (const file of liveSourceFiles) {
      const source = read(file);
      expect(source).not.toContain('y-indexeddb');
      expect(source).not.toContain('IndexeddbPersistence');
      expect(source).not.toContain('repopulateWithResetPersistence');
      expect(source).not.toContain('library-${libraryId}');
      expect(source).not.toContain('asset-table-${libraryId}');
      expect(source).not.toMatch(/offline[- ]edit/i);
      expect(source).not.toContain('yAssets.clear(');
    }
  });

  it('does not keep the reset-persistence helper or obsolete tests', () => {
    expect(existsSync(path.join(repoRoot, 'src/lib/yjs/persistence.ts'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'tests/unit/yjs-persistence-reset.test.ts'))).toBe(false);
  });

  it('does not ship y-indexeddb as a production dependency', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty('y-indexeddb');
    expect(packageJson.devDependencies).not.toHaveProperty('y-indexeddb');

    const packageLock = read('package-lock.json');
    expect(packageLock).not.toContain('node_modules/y-indexeddb');
  });
});
