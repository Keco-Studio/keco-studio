import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { buildFolderBreadcrumbPath, folderBreadcrumbPathEndsAt } from '@/lib/navigation/folderBreadcrumbs';

describe('buildFolderBreadcrumbPath', () => {
  it('returns every ancestor from the project root to the current folder', () => {
    expect(buildFolderBreadcrumbPath([
      { id: 'root', name: 'Resources Folder', parent_folder_id: null },
      { id: 'one', name: '1', parent_folder_id: 'root' },
      { id: 'two', name: '2', parent_folder_id: 'one' },
    ], 'two')).toEqual([
      { id: 'root', name: 'Resources Folder' },
      { id: 'one', name: '1' },
      { id: 'two', name: '2' },
    ]);
  });

  it('stops safely when a legacy folder cycle is present', () => {
    expect(buildFolderBreadcrumbPath([
      { id: 'a', name: 'A', parent_folder_id: 'b' },
      { id: 'b', name: 'B', parent_folder_id: 'a' },
    ], 'a')).toEqual([
      { id: 'b', name: 'B' },
      { id: 'a', name: 'A' },
    ]);
  });

  it('detects when a cached breadcrumb path matches the active folder', () => {
    expect(folderBreadcrumbPathEndsAt([], 'folder-1')).toBe(false);
    expect(folderBreadcrumbPathEndsAt([{ id: 'root', name: 'Root' }], 'child')).toBe(false);
    expect(folderBreadcrumbPathEndsAt([
      { id: 'root', name: 'Root' },
      { id: 'child', name: 'Child' },
    ], 'child')).toBe(true);
  });

  it('uses sidebar folder caches for immediate Studio breadcrumbs', () => {
    const source = readFileSync('src/lib/contexts/NavigationContext.tsx', 'utf8');
    expect(source).toContain("'folders-libraries'");
    expect(source).toContain('folderBreadcrumbPathEndsAt');
    expect(source).toContain('activeDocument');
    expect(source).toContain('resolvedFolderPath');
  });

  it('uses a document folder as the Studio breadcrumb source', () => {
    const source = readFileSync('src/lib/contexts/NavigationContext.tsx', 'utf8');
    expect(source).toContain('const [documentFolderId, setDocumentFolderId]');
    expect(source).toContain('resolvedDocumentFolderId');
    expect(source).toContain('resolvedLibraryFolderId');
    expect(source).toContain("select('name, folder_id')");
  });

  it('keeps the partial document-name cache separate from the full document cache', () => {
    const source = readFileSync('src/lib/contexts/NavigationContext.tsx', 'utf8');
    expect(source).toContain("queryKey: ['document-name', currentDocumentId]");
    expect(source).not.toMatch(
      /queryKey:\s*queryKeys\.document\(currentDocumentId\)[\s\S]*select\('name, folder_id'\)/
    );
  });
});
