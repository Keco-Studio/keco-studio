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

  it('selects projects immediately and has no inline rename path', () => {
    expect(source).toContain("onContextMenu(e, 'project', project.id)");
    expect(source).toContain('selectProject(project.id)');
    expect(source).toContain("window.addEventListener('keydown'");
    expect(source).toContain("event.key === 'Escape'");
    expect(source).not.toContain('startRename');
    expect(source).not.toContain('projectSelectorRenameInput');
    expect(source).not.toContain('onDoubleClick');
    expect(source).not.toContain('pendingProjectSelectionRef');
    expect(source).not.toContain('onSaveRename');
  });

  it('scrolls the selected project into the compact 3-row window when opened', () => {
    expect(source).toContain('selectedOptionRef');
    expect(source).toContain("scrollIntoView({ block: 'nearest' })");
    expect(source).toContain('ref={isCurrentProject ? selectedOptionRef : undefined}');
  });
});
