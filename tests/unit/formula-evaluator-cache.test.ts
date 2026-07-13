import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { evaluateFormulaForRow } from '@/components/libraries/utils/formulaEvaluation';
import { computeFormulaValuesForRow, type FormulaEvaluableField } from '@/lib/utils/formula';

describe('formula evaluator compilation cache', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('compiles a client formula once across repeated row evaluation', () => {
    const functionSpy = jest.spyOn(globalThis, 'Function');
    const properties = [
      { id: 'amount', key: 'amount', name: 'amount', dataType: 'int' },
    ] as PropertyConfig[];
    const row = (amount: number): AssetRow => ({
      id: `row-${amount}`,
      name: `Row ${amount}`,
      propertyValues: { amount },
    } as AssetRow);

    expect(evaluateFormulaForRow('IF(amount > 10, amount, 0)', row(12), properties)).toBe(12);
    expect(evaluateFormulaForRow('IF(amount > 10, amount, 0)', row(8), properties)).toBe(0);
    expect(functionSpy).toHaveBeenCalledTimes(1);
  });

  it('compiles a server formula once across repeated row computation', () => {
    const functionSpy = jest.spyOn(globalThis, 'Function');
    const fields: FormulaEvaluableField[] = [
      { id: 'amount', name: 'amount', dataType: 'int' },
      {
        id: 'total',
        name: 'total',
        dataType: 'formula',
        formulaExpression: 'IF(amount > 10, amount, 0)',
      },
    ];

    expect(computeFormulaValuesForRow(fields, { amount: 12 }).total).toBe(12);
    expect(computeFormulaValuesForRow(fields, { amount: 8 }).total).toBe(0);
    expect(functionSpy).toHaveBeenCalledTimes(1);
  });
});
