import { buildAgentSelectionContext } from '../../../src/components/libraries/utils/agentSelectionContext';
import type { CellKey } from '../../../src/components/libraries/hooks/useCellSelection';
import type { AssetRow, PropertyConfig } from '../../../src/lib/types/libraryAssets';

const rows = [
  {
    id: 'asset-1',
    libraryId: 'lib-1',
    name: 'Alice',
    rowIndex: 2,
    propertyValues: {
      name: 'Alice',
      age: 18,
      ref: [{ assetId: 'asset-x', fieldId: 'field-x', displayValue: 'Bob' }],
    },
  },
  {
    id: 'asset-2',
    libraryId: 'lib-1',
    name: 'Bob',
    rowIndex: 3,
    propertyValues: { name: 'Bob', age: 19 },
  },
] as AssetRow[];

const properties = [
  {
    id: 'field-name',
    key: 'name',
    name: 'Name',
    dataType: 'string',
    sectionId: 'sec-1',
    valueType: 'string',
    orderIndex: 1,
  },
  {
    id: 'field-age',
    key: 'age',
    name: 'Age',
    dataType: 'int',
    sectionId: 'sec-1',
    valueType: 'number',
    orderIndex: 2,
  },
] as PropertyConfig[];

describe('buildAgentSelectionContext', () => {
  it('serializes selected cells with row and field identifiers', () => {
    const ctx = buildAgentSelectionContext({
      libraryId: 'lib-1',
      libraryName: '角色表',
      sectionName: '基础信息',
      rows,
      visibleProperties: properties,
      selectedCells: new Set<CellKey>(['asset-1-name', 'asset-2-age'] as CellKey[]),
      selectedRowIds: new Set<string>(),
    });

    expect(ctx?.selectionLabel).toBe('角色表 · 选中 2 个单元格');
    expect(ctx?.mode).toBe('cells');
    expect(ctx?.rows).toHaveLength(2);
    expect(ctx?.rows[0].cells[0]).toMatchObject({
      fieldId: 'field-name',
      fieldKey: 'name',
      fieldName: 'Name',
      displayValue: 'Alice',
    });
  });

  it('serializes selected rows using all visible active-section cells', () => {
    const ctx = buildAgentSelectionContext({
      libraryId: 'lib-1',
      libraryName: '角色表',
      sectionName: '基础信息',
      rows,
      visibleProperties: properties,
      selectedCells: new Set<CellKey>(['asset-1-name'] as CellKey[]),
      selectedRowIds: new Set(['asset-1', 'asset-2']),
    });

    expect(ctx?.selectionLabel).toBe('角色表 · 第 2-3 行');
    expect(ctx?.mode).toBe('rows');
    expect(ctx?.selectedCellCount).toBe(4);
    expect(ctx?.rows[0].cells.map((cell) => cell.fieldKey)).toEqual(['name', 'age']);
  });

  it('returns null when no cells or rows are selected', () => {
    expect(
      buildAgentSelectionContext({
        libraryId: 'lib-1',
        libraryName: '角色表',
        rows,
        visibleProperties: properties,
        selectedCells: new Set<CellKey>(),
        selectedRowIds: new Set<string>(),
      })
    ).toBeNull();
  });
});
