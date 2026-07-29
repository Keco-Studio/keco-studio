import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('folder-scoped document creation', () => {
  it('exposes folder document creation on the row plus menu, not right-click', () => {
    const contextMenu = read('src/components/layout/ContextMenu.tsx');
    expect(contextMenu).toContain("| 'new-document'");
    expect(contextMenu).toMatch(
      /type === 'folder'[\s\S]*Folder actions are on the row "\+" menu[\s\S]*return null/
    );

    const addMenu = read('src/components/libraries/AddLibraryMenu.tsx');
    expect(addMenu).toContain('onCreateDocument');
    expect(addMenu).toContain('Create new document');
  });

  it('routes the folder id through the sidebar plus-menu action boundary', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toMatch(
      /folderAddMenu[\s\S]*onCreateDocument[\s\S]*openNewDocumentInFolder\(folderAddMenu\.folderId\)/
    );
    expect(sidebar).toMatch(/type === 'folder'\) return/);
  });

  it('sets the selected folder before opening the existing modal', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toMatch(
      /openNewDocumentInFolder[\s\S]*setSelectedFolderId\(folderId\)[\s\S]*openNewDocument\(\)/
    );
    expect(sidebar).toMatch(
      /handleCreateDocument[\s\S]*setSelectedFolderId\(null\)[\s\S]*openNewDocument\(\)/
    );
  });
});
