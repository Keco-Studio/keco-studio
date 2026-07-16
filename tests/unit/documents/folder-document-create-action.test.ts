import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), 'utf8');

describe('folder-scoped document creation', () => {
  it('exposes a typed New document context-menu action for folders', () => {
    const contextMenu = read('src/components/layout/ContextMenu.tsx');
    expect(contextMenu).toContain("| 'new-document'");
    expect(contextMenu).toMatch(/type === 'folder'[\s\S]*New document/);
    expect(contextMenu).toContain("handleAction('new-document')");
  });

  it('routes the folder id through the sidebar action boundary', () => {
    const actions = read(
      'src/components/layout/hooks/useSidebarContextMenuActions.ts'
    );
    expect(actions).toContain('openNewDocumentInFolder: (folderId: string) => void');
    expect(actions).toMatch(
      /action === 'new-document'[\s\S]*contextMenu\.type === 'folder'[\s\S]*openNewDocumentInFolder\(contextMenu\.id\)/
    );
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
