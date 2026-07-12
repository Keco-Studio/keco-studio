import fs from 'node:fs';
import path from 'node:path';
import { computeFormulaValuesForRow, type FormulaEvaluableField } from '@/lib/utils/formula';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('heavy client bundle boundaries', () => {
  it('evaluates arithmetic helpers with native number semantics', () => {
    const fields: FormulaEvaluableField[] = [
      { id: 'a', name: 'a', dataType: 'int' },
      { id: 'b', name: 'b', dataType: 'int' },
      { id: 'arithmetic', name: 'arithmetic', dataType: 'formula', formulaExpression: 'a+b*a-b/a' },
      { id: 'sum', name: 'sum', dataType: 'formula', formulaExpression: 'SUM(a,b,3)' },
      { id: 'average', name: 'average', dataType: 'formula', formulaExpression: 'AVERAGE(a,b,3)' },
      { id: 'min', name: 'min', dataType: 'formula', formulaExpression: 'MIN(a,b,3)' },
      { id: 'max', name: 'max', dataType: 'formula', formulaExpression: 'MAX(a,b,3)' },
      { id: 'round', name: 'round', dataType: 'formula', formulaExpression: 'ROUND(1.23456,3)' },
    ];

    expect(computeFormulaValuesForRow(fields, { a: 6, b: 2 })).toMatchObject({
      arithmetic: 17.6667,
      sum: 11,
      average: 3.6667,
      min: 2,
      max: 6,
      round: 1.235,
    });
  });

  it('uses native arithmetic without the mathjs package', () => {
    const packageJson = JSON.parse(read('package.json')) as { dependencies?: Record<string, string> };
    const formula = read('src/lib/utils/formula.ts');

    expect(packageJson.dependencies).not.toHaveProperty('mathjs');
    expect(formula).not.toContain("from 'mathjs'");
  });

  it('loads the ExcelJS-backed import modal only when requested', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');

    expect(sidebar).not.toContain(
      'import { ImportLibraryModal } from "@/components/libraries/ImportLibraryModal"',
    );
    expect(sidebar).toMatch(
      /const ImportLibraryModal = dynamic\([\s\S]*import\("@\/components\/libraries\/ImportLibraryModal"\)/,
    );
  });
});
