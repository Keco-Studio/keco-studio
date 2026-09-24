import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('library table cell render boundaries', () => {
  it('keeps contentEditable input state out of the table parent', () => {
    const editor = read('src/components/libraries/components/CellEditor.tsx');
    const editingHook = read('src/components/libraries/hooks/useCellEditing.ts');

    expect(editor).not.toContain('setEditingCellValue');
    expect(editingHook).not.toContain("useState<string>('')");
  });

  it.each([
    'TextCell.tsx',
    'MediaCell.tsx',
    'BooleanCell.tsx',
    'EnumCell.tsx',
    'FormulaCell.tsx',
  ])('memoizes %s', (fileName) => {
    const source = read(`src/components/libraries/components/${fileName}`);
    expect(source).toMatch(/\bmemo\s*\(/);
  });

  it('uses the compact 28 by 16 Boolean switch size', () => {
    const source = read('src/components/libraries/components/BooleanCell.tsx');
    const switches = source.match(/<Switch[\s\S]*?\/>/g) ?? [];

    expect(switches).toHaveLength(2);
    expect(switches.every((switchSource) => /\bsize="small"/.test(switchSource))).toBe(true);
  });
});
