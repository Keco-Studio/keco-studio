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
});
