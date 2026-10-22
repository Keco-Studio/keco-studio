import fs from 'node:fs';
import path from 'node:path';
import {
  computeFormulaValuesForRow,
  rewriteFormulaFieldReference,
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

  it('rewrites only exact field references when a source field is renamed', () => {
    expect(
      rewriteFormulaFieldReference(
        '=amount + [amount] + [Order amount] + amount_tax + SUM(amount, 1) + "amount"',
        'amount',
        'cost',
      ),
    ).toBe('=cost + [cost] + [Order amount] + amount_tax + SUM(cost, 1) + "amount"');
  });

  it('uses bracket notation when a renamed field cannot be referenced as a bare identifier', () => {
    expect(rewriteFormulaFieldReference('amount + [amount]', 'amount', 'Order amount'))
      .toBe('[Order amount] + [Order amount]');
  });

  it('preserves template literal text while rewriting interpolated field references', () => {
    expect(rewriteFormulaFieldReference('amount + `amount: ${amount}`', 'amount', 'cost'))
      .toBe('cost + `amount: ${cost}`');
  });

  it('rewrites references after regular expressions inside template interpolations', () => {
    expect(rewriteFormulaFieldReference('`${/}/.test("}") ? amount : 0}`', 'amount', 'cost'))
      .toBe('`${/}/.test("}") ? cost : 0}`');
  });

  it('rewrites references after regular expressions following return in template interpolations', () => {
    expect(
      rewriteFormulaFieldReference(
        '`${(() => { return /}/.test("}") })() + amount}`',
        'amount',
        'cost',
      ),
    ).toBe('`${(() => { return /}/.test("}") })() + cost}`');
  });

  it('rewrites references after regular expressions following a control condition', () => {
    expect(
      rewriteFormulaFieldReference(
        '`${(() => { if (true) /}/.test("}"); return 0 })() + amount}`',
        'amount',
        'cost',
      ),
    ).toBe('`${(() => { if (true) /}/.test("}"); return 0 })() + cost}`');
  });

  it('rewrites references after regular expressions following instanceof', () => {
    expect(rewriteFormulaFieldReference('`${foo instanceof /}/ ? amount : 0}`', 'amount', 'cost'))
      .toBe('`${foo instanceof /}/ ? cost : 0}`');
  });
});
