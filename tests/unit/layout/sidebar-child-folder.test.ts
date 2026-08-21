import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('sidebar child folder creation contract', () => {
  const modalSource = read('src/components/folders/NewFolderModal.tsx');
  const sidebarSource = read('src/components/layout/Sidebar.tsx');

  it('passes an optional parent folder through the shared modal', () => {
    expect(modalSource).toContain('parentFolderId?: string | null');
    expect(modalSource).toMatch(/createFolder\(supabase,\s*\{[\s\S]*parentFolderId:/);
  });

  it('keeps child-folder parent state separate from content placement', () => {
    expect(sidebarSource).toContain('pendingFolderParentId');
    expect(sidebarSource).toMatch(/<NewFolderModal[\s\S]*parentFolderId=\{pendingFolderParentId\}/);
  });

  it('offers child-folder creation from the folder action menu', () => {
    expect(sidebarSource).toMatch(
      /open=\{Boolean\(folderAddMenu\)\}[\s\S]*onCreateFolder=\{[\s\S]*folderAddMenu\.folderId/,
    );
  });
});
