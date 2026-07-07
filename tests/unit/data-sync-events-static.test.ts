import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

const coreFiles = [
  'src/components/layout/hooks/useSidebarRealtime.ts',
  'src/components/layout/hooks/useSidebarWindowEvents.ts',
  'src/components/layout/hooks/useSidebarAssets.ts',
  'src/components/layout/hooks/useSidebarContextMenuActions.ts',
  'src/components/layout/Sidebar.tsx',
  'src/app/(dashboard)/[projectId]/page.tsx',
  'src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx',
  'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx',
  'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx',
  'src/lib/contexts/LibraryDataContext.tsx',
];

const dataSyncEvents = [
  'projectCreated',
  'projectUpdated',
  'projectDeleted',
  'folderCreated',
  'folderUpdated',
  'folderDeleted',
  'libraryCreated',
  'libraryUpdated',
  'libraryDeleted',
  'assetCreated',
  'assetUpdated',
  'assetDeleted',
  'schemaUpdated',
  'referenceSourceUpdated',
  'libraryRestored',
  'libraryCellValuesReplaced',
];

describe('data sync events static guard', () => {
  it('uses typed invalidation instead of core data-sync CustomEvents', () => {
    for (const file of coreFiles) {
      const source = read(file);
      for (const eventName of dataSyncEvents) {
        expect(source).not.toContain(`new CustomEvent('${eventName}'`);
        expect(source).not.toContain(`addEventListener('${eventName}'`);
        expect(source).not.toContain(`removeEventListener('${eventName}'`);
        expect(source).not.toContain(`addEventListener('${eventName}' as any`);
        expect(source).not.toContain(`removeEventListener('${eventName}' as any`);
      }
    }
  });

  it('keeps UI command events out of the data-sync ban', () => {
    const projectPage = read('src/app/(dashboard)/[projectId]/page.tsx');
    expect(projectPage).toContain('library-page-view-mode-change');
    expect(projectPage).toContain('library-toolbar-view-mode-change');
  });
});
