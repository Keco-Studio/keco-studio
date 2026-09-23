import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

describe('right panel compression', () => {
  it('uses an expanding Agent slot so the workspace content contracts with the panel', () => {
    const component = readFileSync(join(root, 'src/components/agent/ChatPanel.tsx'), 'utf8');
    const css = readFileSync(join(root, 'src/components/agent/ChatPanel.module.css'), 'utf8');

    expect(component).toContain('styles.panelSlot');
    expect(component).toContain('styles.panelSlotOpen');
    expect(css).toMatch(/\.panelSlot\s*\{[^}]*flex: 0 0 0;/s);
    expect(css).toMatch(/\.panelSlotOpen\s*\{[^}]*flex-basis: clamp\(300px, var\(--agent-panel-width-ratio\), 390px\);/s);
  });

  it('uses explicit Detail and History grid tracks that leave the table in the remaining width', () => {
    const page = readFileSync(join(root, 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx'), 'utf8');
    const css = readFileSync(join(root, 'src/app/(dashboard)/[projectId]/[libraryId]/page.module.css'), 'utf8');

    expect(page).toContain('styles.versionHistorySlot');
    expect(css).toMatch(/\.mainContent\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 0 0;/s);
    expect(css).toContain('.mainContent:has(.assetDetailSlot:not(:empty))');
    expect(css).toContain('.mainContent:has(.versionHistorySlot:not(:empty))');
  });
});
