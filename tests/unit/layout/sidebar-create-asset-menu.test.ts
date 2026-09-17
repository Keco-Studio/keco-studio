import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sidebarSource = readFileSync(
  join(process.cwd(), 'src/components/layout/Sidebar.tsx'),
  'utf8',
);

describe('Sidebar Create Asset menus', () => {
  it('wires the project and folder add menus to activate the Assets workspace for editors and admins', () => {
    const menus = sidebarSource.match(/<AddLibraryMenu[\s\S]*?(?=\n\s*<AddLibraryMenu|\n\s*<\/[a-z]|$)/g) ?? [];

    expect(menus).toHaveLength(2);
    for (const menu of menus) {
      expect(menu).toMatch(/onCreateAsset=/);
      expect(menu).toMatch(/userRole === 'admin' \|\| userRole === 'editor'/);
      expect(menu).toMatch(/handleToolbarCreateAsset/);
    }
  });
});
