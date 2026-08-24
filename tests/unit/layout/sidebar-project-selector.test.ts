import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('sidebar project selector', () => {
  const source = read('src/components/layout/components/SidebarProjectsList.tsx');
  const css = read('src/components/layout/Sidebar.module.css');

  it('uses the current project as a compact accessible dropdown trigger', () => {
    expect(source).toContain('currentProject?.name ??');
    expect(source).toContain('aria-haspopup="menu"');
    expect(source).toContain('aria-expanded={isSelectorOpen}');
    expect(source).toContain('role="menu"');
    expect(source).toContain('role="menuitemradio"');
    expect(source).toContain('aria-checked={isCurrentProject}');
    expect(source).toContain('<CheckOutlined');
    expect(source).toContain('Create new');
    expect(source).not.toContain('<span>Projects</span>');
    expect(source).not.toContain('addProjectIcon');

    expect(css).toMatch(/\.projectSelectorTrigger\s*\{/);
    expect(css).toMatch(/\.projectSelectorMenu\s*\{/);
    expect(css).toMatch(/\.projectSelectorOptionSelected(?:\s*\{|\s*,)/);
    expect(css).toMatch(/\.projectSelectorCreate\s*\{/);
  });

  it('commits rename on outside click and snaps sidebar scroll back immediately', () => {
    expect(source).toContain("onContextMenu(e, 'project', project.id)");
    expect(source).toContain('startRename(project)');
    expect(source).toContain("document.addEventListener('pointerdown'");
    expect(source).toContain("window.addEventListener('keydown'");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).toContain('exitRename');
    expect(source).toContain('focusRenameInputAtEnd');
    expect(source).toContain('snapSidebarHorizontalScroll');
    expect(source).toContain('renameInputRef.current?.blur()');
  });

  it('does not let an administrator single-click close the menu before rename double-click', () => {
    expect(source).toContain('pendingProjectSelectionRef');
    expect(source).toContain('cancelPendingProjectSelection');
    expect(source).toContain('queueProjectSelection(project.id)');
    expect(source).toContain('window.setTimeout');
    expect(source).toContain('window.clearTimeout');
  });
});
