import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('navigation branding and folder create controls', () => {
  it('uses the shared product title and subtitle typography across Studio, Simulation, and Script', () => {
    const studio = read('src/components/layout/Sidebar.module.css');
    const simulation = read('src/components/simulation/workbench/SimulationWorkbench.module.css');
    const script = read('src/components/script-system/ScriptSidebar.module.css');

    for (const source of [studio, simulation, script]) {
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*color:\s*#16325D;/s);
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*font-family:\s*Archivo,\s*sans-serif;/s);
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*font-size:\s*16px;/s);
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*font-weight:\s*700;/s);
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*line-height:\s*100%;/s);
      expect(source).toMatch(/(?:brandTitle|brandText)\b[^}]*text-transform:\s*capitalize;/s);
      expect(source).toMatch(/(?:brandSubtitle|sidebarBrand p)\b[^}]*color:\s*(?:#5B74A7|var\(--branding-theme-secondary-text,\s*#5B74A7\));/s);
    }
  });

  it('uses the shared Create menu on folder pages', () => {
    const toolbar = read('src/components/folders/LibraryToolbar.tsx');
    const topBar = read('src/components/layout/TopBar.tsx');

    expect(toolbar).toContain("const showCreateMenu = mode === 'project' || mode === 'folder' || mode === 'recent' || mode === 'admin';");
    expect(toolbar).toMatch(/<span className=\{styles\.createButtonText\}>\s*Create\s*<\/span>/s);
    expect(toolbar).not.toContain("'Create Library'");
    expect(topBar).toContain("mode={isFolderPage ? 'folder' : 'project'}");
    expect(topBar).toContain('onCreateFolder={handleTopbarCreateFolder}');
    expect(topBar).toContain('onCreateDocument={handleTopbarCreateDocument}');
    expect(topBar).toContain('onImportTable={handleTopbarImportTable}');
    expect(topBar).toContain('onImportDocument={handleTopbarImportDocument}');
  });
});
