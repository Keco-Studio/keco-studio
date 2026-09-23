import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Script Import navigation style', () => {
  it('uses the Simulator import artwork and navigation dimensions', () => {
    const source = read('src/components/script-system/ScriptSidebar.tsx');
    const css = read('src/components/script-system/ScriptSidebar.module.css');

    expect(source).toContain("import importIcon from '@/assets/images/simulator/import.svg';");
    expect(source).toContain('<Image src={importIcon} alt="" width={18} height={18} aria-hidden="true" />');
    expect(source).toContain('<span className={styles.importCopy}>');
    expect(source).toContain('<strong>Import</strong>');
    expect(css).toMatch(/\.importButton\s*\{[^}]*min-height:\s*44px[^}]*padding:\s*10px[^}]*grid-template-columns:\s*18px\s+minmax\(0,\s*1fr\)[^}]*gap:\s*10px[^}]*font-size:\s*13\.5px/s);
    expect(css).toMatch(/\.importButton:hover\s*\{[^}]*background:\s*var\(--script-surface-1\)/s);
    expect(css).toMatch(/\.importIcon\s*\{[^}]*line-height:\s*1/s);
    expect(css).toMatch(/\.importCopy\s*\{[^}]*display:\s*grid/s);
  });
});
