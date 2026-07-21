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
    expect(source).not.toMatch(/onMouseEnter|onMouseLeave|useState/);
    expect(source).toContain("from './SimulationWorkbench.module.css'");
  });

  it('uses accessible button navigation in the sidebar', () => {
    const source = read('SimulationSidebar.tsx');
    expect(source).toContain('Keco Simulator');
    expect(source).toMatch(/<nav[^>]+aria-label=/);
    expect(source).toContain('role="menu"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('aria-current');
    expect(source).toContain('aria-expanded');
    expect(source).toMatch(/<button[^>]+aria-label=.*[Cc]ollapse/s);
    expect(source).not.toMatch(/<(?:div|li|span)[^>]+onClick=/);
  });

  it('exposes the workflow and a decorative Studio-native search icon', () => {
    const source = read('SimulationHeader.tsx');
    expect(source).toMatch(/<nav[^>]+aria-label=/);
    expect(source).toContain('aria-current');
    expect(source).toContain('type="search"');
    expect(source).toContain('aria-hidden="true"');
    expect(source).not.toContain('<svg');
  });

  it('uses semantic status and battle health output', () => {
    const toast = read('SimulationToast.tsx');
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');

    const arena = read('Arena.tsx');
    expect(arena).toContain('role="progressbar"');
    expect(arena).toContain('aria-valuenow');
    expect(arena).toContain('aria-valuemin={0}');
    expect(arena).toContain('aria-valuemax={fighter.maxHp}');
    expect(arena).toMatch(/Team \{team\}/);
    expect(arena).toContain('fighter.effect');
    expect(arena).toMatch(/style=\{\{ width:/);
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
  });

  it('scopes prefixed tokens to the simulation root without global leakage', () => {
    const tokens = read('simulationTokens.css');
    expect(tokens.trimStart()).toMatch(/^\[data-simulation-root\]\s*\{/);
    expect(tokens.match(/\[data-simulation-root\]/g)).toHaveLength(1);
    expect(tokens).not.toMatch(/:root|@import\s+url|100vh|\b(?:html|body|button|input)\s*\{/);
    const names = [...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(8);
    expect(names.every((name) => name.startsWith('--simulation-'))).toBe(true);
    expect(tokens).not.toMatch(/:\s*[\d.]+(?:rem|em|vh|vw)\b/);
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
