import fs from 'node:fs';
import path from 'node:path';
import {
  computeFormulaValuesForRow,
  type FormulaEvaluableField,
} from '@/lib/utils/formula';

const formula = (
  id: string,
  name: string,
  expression: string
): FormulaEvaluableField => ({
  id,
  name,
  dataType: 'formula',
  formulaExpression: expression,
});

describe('lightweight formula runtime', () => {
  it('preserves arithmetic, aggregate, and decimal rounding behavior', () => {
    const fields: FormulaEvaluableField[] = [
      { id: 'a', name: 'A', dataType: 'float' },
      { id: 'b', name: 'B', dataType: 'float' },
      formula('sum', 'Sum', 'SUM(A, B, 3)'),
      formula('average', 'Average', 'AVERAGE(A, B)'),
      formula('minimum', 'Minimum', 'MIN(A, B, -4)'),
      formula('maximum', 'Maximum', 'MAX(A, B, 9)'),
      formula('rounded', 'Rounded', 'ROUND(-1.005, 2)'),
      formula('arithmetic', 'Arithmetic', 'A + B'),
      formula('divideByZero', 'DivideByZero', 'A / 0'),
    ];

    expect(computeFormulaValuesForRow(fields, { a: 0.1, b: 0.2 })).toMatchObject({
      sum: 3.3,
      average: 0.15,
      minimum: -4,
      maximum: 9,
      rounded: -1.01,
      arithmetic: 0.3,
      divideByZero: Infinity,
    });
  });

  it('does not include mathjs in the client formula runtime or dependencies', () => {
    const root = process.cwd();
    const formulaSource = fs.readFileSync(
      path.join(root, 'src/lib/utils/formula.ts'),
      'utf8'
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')
    );

    expect(formulaSource).not.toContain('mathjs');
    expect(packageJson.dependencies?.mathjs).toBeUndefined();
    expect(packageJson.devDependencies?.mathjs).toBeUndefined();
    expect(packageLock.packages?.['node_modules/mathjs']).toBeUndefined();
  });
});
