import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('isomorphic service boundaries', () => {
  it.each([
    'src/lib/services/folderService.ts',
    'src/lib/services/libraryService.ts',
    'src/lib/services/projectService.ts',
    'src/lib/services/versionService.ts',
  ])('%s is importable from server code', (servicePath) => {
    expect(read(servicePath)).not.toMatch(/^['"]use client['"];?/m);
  });

  it('keeps agent data access as service-backed authorization wrappers', () => {
    const dataAccess = read('src/lib/agent/data-access.ts');

    expect(dataAccess).toContain("from '@/lib/services/folderService'");
    expect(dataAccess).toContain("from '@/lib/services/libraryService'");
    expect(dataAccess).toContain("from '@/lib/services/libraryAssetsService'");
    expect(dataAccess).not.toContain(".from('");
  });
});
