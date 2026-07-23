import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const componentDir = resolve(root, 'src/components/simulation/workbench');
const read = (file: string) => readFileSync(resolve(componentDir, file), 'utf8');

const componentFiles = [
  'SimulationSidebar.tsx',
  'SimulationHeader.tsx',
  'SimulationButton.tsx',
  'SimulationToast.tsx',
  'Arena.tsx',
] as const;

describe('native simulation workbench presentation', () => {
  it('keeps presentation components local, portable and free of the legacy embed', () => {
    const source = componentFiles.map(read).join('\n');
    expect(source).not.toMatch(/keco-simulation-demo|document\.body|supabase/i);
    expect(source).toContain("from './SimulationWorkbench.module.css'");
  });

  it('uses accessible button navigation in the sidebar', () => {
    const source = read('SimulationSidebar.tsx');
    expect(source).toContain('Keco Siumlator');
    expect(source).toContain('Battle &amp; numbers sandbox for game designers.');
    expect(source).toMatch(/<nav[^>]+aria-label=/);
    expect(source).toContain('role="menu"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('aria-current');
    expect(source).toContain('aria-expanded');
    expect(source).toMatch(/<button[^>]+aria-label=.*[Cc]ollapse/s);

    const css = read('SimulationWorkbench.module.css');
    expect(css).toMatch(/\.sidebar\s*\{[^}]*width:\s*228px/s);
    expect(css).toMatch(/\.sidebar\s*\{[^}]*background:\s*var\(--simulation-surface-glass\)/s);
    expect(css).toMatch(/\.sidebarCollapsed\s*\{[^}]*width:\s*28px/s);
  });

  it('exposes the workflow and a decorative Studio-native search icon', () => {
    const source = read('SimulationHeader.tsx');
    expect(source).toMatch(/<nav[^>]+aria-label=/);
    expect(source).toContain('aria-current');
    expect(source).toContain('aria-hidden="true"');
    expect(source).not.toContain('<svg');
    expect(source).toContain('Search libraries, characters, skills');
  });

  it('uses semantic status and battle health output', () => {
    const toast = read('SimulationToast.tsx');
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
    expect(toast).toContain('actionLabel');
    expect(toast).toContain('onAction');

    const arena = read('Arena.tsx');
    expect(arena).toContain('Team A · You');
    expect(arena).toContain('Team B · Enemy');
    expect(arena).toContain('var(--keco-blue)');
    expect(arena).toContain('var(--keco-pink-strong)');
    expect(arena).toContain('EL[');
    expect(arena).toContain('kFloat');
    expect(arena).toContain('fighter.feedback');
  });

  it('preserves the source demo landmarks across all workflow screens', () => {
    const importScreen = read('ImportScreen.tsx');
    expect(importScreen).toContain('Import Studio libraries');
    expect(importScreen).toContain('Studio source table');
    expect(importScreen).toContain('Simulation fields');
    expect(importScreen).toContain('styles.mappingBridge');
    expect(importScreen).toContain('duplicateLibraryNames');
    expect(importScreen).toContain('folderLabelForLibrary');
    expect(importScreen).toContain('formatLibraryLabel');
    expect(importScreen).toContain('selectedLabel');
    expect(importScreen).toContain('/${library.name}');

    const characters = read('CharactersScreen.tsx');
    expect(characters).toContain('Team A · Yours');
    expect(characters).toContain('Team B · Enemy');
    expect(characters).toContain('Studio snapshot');

    const skills = read('SkillsScreen.tsx');
    expect(skills).toContain('Config skills');
    expect(skills).toContain('/ 6 skills');

    const progression = read('ProgressionScreen.tsx');
    expect(progression).toContain('Equipped skills');
    expect(progression).toContain('Skill points');

    const battle = read('BattleScreen.tsx');
    expect(battle).toContain('Single battle');
    expect(battle).toContain('Batch simulation');
    expect(battle).toContain('Start battle');
  });

  it('keeps interaction states in CSS, including keyboard and reduced motion', () => {
    const button = read('SimulationButton.tsx');
    expect(button).not.toMatch(/onMouseEnter|onMouseLeave|useState/);

    const css = read('SimulationWorkbench.module.css');
    expect(css).toMatch(/\.button:hover/);
    expect(css).toMatch(/\.button:active/);
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/\.toast\s*\{[^}]*position:\s*absolute/s);
    expect(css).toMatch(/@keyframes\s+combatFloat/);
    expect(css).toMatch(/@keyframes\s+fighterHit/);
  });

  it('scopes prefixed tokens to the simulation root without global leakage', () => {
    const tokens = read('simulationTokens.css');
    expect(tokens.trimStart()).toMatch(/^\[data-simulation-root\]\s*\{/);
    expect(tokens.match(/\[data-simulation-root\]/g)).toHaveLength(1);
    expect(tokens).not.toMatch(/:root|@import\s+url|100vh|\b(?:html|body|button|input)\s*\{/);
    const simulationNames = [...tokens.matchAll(/(--simulation-[\w-]+)\s*:/g)].map((match) => match[1]);
    expect(simulationNames.length).toBeGreaterThan(8);
    expect(tokens).toContain('--simulation-blue: #0b99ff');
    expect(tokens).toContain('--simulation-pink-strong: #ff69b4');
    expect(tokens).toContain('--simulation-surface-3: #f6f7fb');
    expect(tokens).toContain('--simulation-ink-900: #0f172a');
    expect(tokens).toContain('--simulation-header-height: 64px');
    expect(tokens).toContain('--keco-blue: var(--simulation-blue)');
    expect(tokens).toContain('--ink-900: var(--simulation-ink-900)');
  });

  it('defines constrained workbench regions and responsive navigation/arena layouts', () => {
    const css = read('SimulationWorkbench.module.css');
    expect(css).not.toMatch(/:root|@import\s+url|100vh|document\.body/);
    for (const className of ['root', 'main', 'content']) {
      expect(css).toMatch(new RegExp(`\\.${className}\\s*\\{[^}]*min-width:\\s*0[^}]*min-height:\\s*0`, 's'));
    }
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)[\s\S]*\.search\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)[\s\S]*\.workflowNav\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*\.sidebar\s*\{[^}]*(?:position:\s*absolute|position:\s*fixed)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*\.battleGrid\s*\{[^}]*grid-template-columns:\s*1fr/);
  });
});
