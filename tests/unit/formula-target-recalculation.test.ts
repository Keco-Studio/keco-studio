import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  computeFormulaValueForField,
  type FormulaEvaluableField,
} from '@/lib/utils/formula';
import { collectFormulaFieldRecalculationRows } from '@/lib/services/libraryAssetsService';

describe('target-only formula recalculation (issue #224)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('evaluates the target and its dependencies without evaluating unrelated formulas', () => {
    const functionSpy = jest.spyOn(globalThis, 'Function');
    const fields: FormulaEvaluableField[] = [
      { id: 'base', name: 'base', dataType: 'int' },
      {
        id: 'dependency',
        name: 'dependency',
        dataType: 'formula',
        formulaExpression: 'IF(base > 0, base, 0)',
      },
      {
        id: 'target',
        name: 'target',
        dataType: 'formula',
        formulaExpression: 'IF(dependency > 0, dependency, 0)',
      },
      {
        id: 'unrelated',
        name: 'unrelated',
        dataType: 'formula',
        formulaExpression: 'IF(base > 1, base, 1)',
      },
    ];

    expect(computeFormulaValueForField(fields, 'target', { base: 4 })).toBe(4);
    expect(functionSpy).toHaveBeenCalledTimes(2);
  });

  it('writes an empty result after a prior formula value and writes again when its source recovers', () => {
    const fields: FormulaEvaluableField[] = [
      { id: 'source', name: 'source', dataType: 'int' },
      {
        id: 'target',
        name: 'target',
        dataType: 'formula',
        formulaExpression: 'source * 2',
      },
    ];

    expect(collectFormulaFieldRecalculationRows(fields, 'target', [
      { id: 'asset-1', propertyValues: { source: 6, target: 12 } },
    ])).toEqual([
      { asset_id: 'asset-1', field_id: 'target', value_json: 12 },
    ]);

    expect(collectFormulaFieldRecalculationRows(fields, 'target', [
      { id: 'asset-1', propertyValues: { source: '', target: 12 } },
    ])).toEqual([
      { asset_id: 'asset-1', field_id: 'target', value_json: null },
    ]);

    expect(collectFormulaFieldRecalculationRows(fields, 'target', [
      { id: 'asset-1', propertyValues: { source: 7, target: null } },
    ])).toEqual([
      { asset_id: 'asset-1', field_id: 'target', value_json: 14 },
    ]);
  });

  it('wires service recalculation to the target-only evaluator', () => {
    const service = readFileSync(
      path.join(process.cwd(), 'src/lib/services/libraryAssetsService.ts'),
      'utf8'
    );
    const start = service.indexOf('async function recalculateAndPersistFormulaFieldValues');
    const end = service.indexOf('\n// Small helper', start);
    const implementation = service.slice(start, end);

    expect(implementation).toContain('collectFormulaFieldRecalculationRows(');
    expect(implementation).not.toContain('computeFormulaValuesForRow(');
  });

  it('runs independent asset and snapshot reads concurrently', () => {
    const assetService = readFileSync(
      path.join(process.cwd(), 'src/lib/services/libraryAssetsService.ts'),
      'utf8'
    );
    const createAssetStart = assetService.indexOf('export async function createAsset');
    const createAssetEnd = assetService.indexOf('\n/**', createAssetStart);
    expect(assetService.slice(createAssetStart, createAssetEnd)).toContain('await Promise.all([');

    const versionService = readFileSync(
      path.join(process.cwd(), 'src/lib/services/versionService.ts'),
      'utf8'
    );
    const snapshotStart = versionService.indexOf('async function createLibrarySnapshot');
    const snapshotEnd = versionService.indexOf('\n/**', snapshotStart);
    expect(versionService.slice(snapshotStart, snapshotEnd)).toContain('await Promise.all([');
  });
});
