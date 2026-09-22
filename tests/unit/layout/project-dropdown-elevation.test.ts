import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const elevatedShadow = '0 12px 28px rgba(31, 41, 55, 0.22), 0 2px 6px rgba(31, 41, 55, 0.12)';
const expandedTrigger = 'background: #ffffff;';

describe('project dropdown elevation', () => {
  it.each([
    ['Studio', 'src/components/layout/Sidebar.module.css', 'projectSelectorMenu'],
    ['Script Generator', 'src/components/script-system/ScriptSidebar.module.css', 'projectMenu'],
    ['Simulator', 'src/components/simulation/workbench/SimulationWorkbench.module.css', 'projectMenu'],
    ['Map', 'src/features/create-map/CreateMapWorkbench.module.css', 'projectMenu'],
  ])('%s uses a distinct floating-card shadow', (_surface, relativePath, className) => {
    const css = readFileSync(join(root, relativePath), 'utf8');
    const block = css.match(new RegExp(`\\.${className}\\s*\\{[^}]*\\}`, 's'))?.[0];

    expect(block).toContain('top: calc(100% - 1px);');
    expect(block).toContain('border: 1px solid #d7dde5;');
    expect(block).toContain('border-top: none;');
    expect(block).toContain('border-radius: 0 0 8px 8px;');
    expect(block).toContain(`box-shadow: ${elevatedShadow};`);
  });
});

describe('project dropdown connection', () => {
  it.each([
    ['Studio', 'src/components/layout/Sidebar.module.css', 'projectSelectorTrigger'],
    ['Script Generator', 'src/components/script-system/ScriptSidebar.module.css', 'projectButton'],
    ['Simulator', 'src/components/simulation/workbench/SimulationWorkbench.module.css', 'projectButton'],
    ['Map', 'src/features/create-map/CreateMapWorkbench.module.css', 'projectButton'],
  ])('%s transitions the trigger into the connected menu surface', (_surface, relativePath, className) => {
    const css = readFileSync(join(root, relativePath), 'utf8');
    const expandedBlock = css.match(new RegExp(`\\.${className}\\[aria-expanded='true'\\]\\s*\\{[^}]*\\}`, 's'))?.[0];

    expect(expandedBlock).toContain(expandedTrigger);
    expect(expandedBlock).toContain('border-color: #d7dde5;');
    expect(expandedBlock).toContain('border-bottom-color: transparent;');
    expect(expandedBlock).toContain('border-radius: 11px 11px 0 0;');
  });

  it.each([
    ['Script Generator', 'src/components/script-system/ScriptSidebar.module.css'],
    ['Simulator', 'src/components/simulation/workbench/SimulationWorkbench.module.css'],
    ['Map', 'src/features/create-map/CreateMapWorkbench.module.css'],
  ])('%s only shows the focus outline for keyboard navigation', (_surface, relativePath) => {
    const css = readFileSync(join(root, relativePath), 'utf8');

    expect(css).toMatch(/\.projectButton:focus\s*\{\s*outline: none;/);
    expect(css).toMatch(/\.projectButton:focus-visible\s*\{\s*outline: 2px solid #8ecfff;/);
  });
});
