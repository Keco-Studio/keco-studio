import type { AgentSelectionCell, AgentSelectionContext } from '@/lib/agent/selection-context';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from '../hooks/useCellSelection';

export interface BuildAgentSelectionContextInput {
  libraryId: string;
  libraryName?: string;
  sectionName?: string;
  rows: AssetRow[];
  visibleProperties: PropertyConfig[];
  selectedCells: Set<CellKey>;
  selectedRowIds: Set<string>;
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatCellDisplayValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return record.displayValue ?? record.name ?? record.assetId ?? compactJson(record);
        }
        return item;
      })
      .filter((item) => item != null)
      .map(String)
      .join(', ');
  }
  return compactJson(value);
}

function buildCell(row: AssetRow, property: PropertyConfig): AgentSelectionCell {
  const value = row.propertyValues?.[property.key];
  return {
    fieldId: property.id,
    fieldKey: property.key,
    fieldName: property.name,
    dataType: property.dataType,
    value,
    displayValue: formatCellDisplayValue(value),
  };
}

function rowLabelPart(rows: AssetRow[]): string | null {
  const indices = rows
    .map((row) => row.rowIndex)
    .filter((index): index is number => typeof index === 'number')
    .sort((a, b) => a - b);
  if (indices.length === 0 || indices.length !== rows.length) return null;

  const contiguous = indices.every((index, i) => i === 0 || index === indices[i - 1] + 1);
  if (!contiguous) return `选中 ${indices.length} 行`;

  const first = indices[0];
  const last = indices[indices.length - 1];
  return first === last ? `第 ${first} 行` : `第 ${first}-${last} 行`;
}

function resolveCellKey(
  key: CellKey,
  rows: AssetRow[],
  propByKey: Map<string, PropertyConfig>
): { row: AssetRow; property: PropertyConfig } | null {
  for (const row of rows) {
    const prefix = `${row.id}-`;
    if (!key.startsWith(prefix)) continue;
    const propertyKey = key.slice(prefix.length);
    const property = propByKey.get(propertyKey);
    if (!property) return null;
    return { row, property };
  }
  return null;
}

export function buildAgentSelectionContext(
  input: BuildAgentSelectionContextInput
): AgentSelectionContext | null {
  if (!input.libraryId) return null;
  const tableName = input.libraryName || '当前表';

  if (input.selectedRowIds.size > 0) {
    const selectedRows = input.rows.filter((row) => input.selectedRowIds.has(row.id));
    if (selectedRows.length === 0) return null;
    const rows = selectedRows.map((row) => ({
      assetId: row.id,
      rowIndex: row.rowIndex,
      name: row.name,
      cells: input.visibleProperties.map((property) => buildCell(row, property)),
    }));
    const rowLabel = rowLabelPart(selectedRows) ?? `选中 ${selectedRows.length} 行`;
    return {
      source: 'library_table',
      libraryId: input.libraryId,
      libraryName: input.libraryName,
      sectionName: input.sectionName,
      selectionLabel: `${tableName} · ${rowLabel}`,
      mode: 'rows',
      selectedCellCount: rows.reduce((sum, row) => sum + row.cells.length, 0),
      selectedRowCount: rows.length,
      rows,
    };
  }

  if (input.selectedCells.size === 0) return null;

  const propByKey = new Map(input.visibleProperties.map((property) => [property.key, property]));
  const selectedKeysByRowId = new Map<string, Set<string>>();
  for (const key of input.selectedCells) {
    const resolved = resolveCellKey(key, input.rows, propByKey);
    if (!resolved) continue;
    const propertyKeys = selectedKeysByRowId.get(resolved.row.id) ?? new Set<string>();
    propertyKeys.add(resolved.property.key);
    selectedKeysByRowId.set(resolved.row.id, propertyKeys);
  }

  const rows = input.rows
    .filter((row) => selectedKeysByRowId.has(row.id))
    .map((row) => {
      const propertyKeys = selectedKeysByRowId.get(row.id) ?? new Set<string>();
      return {
        assetId: row.id,
        rowIndex: row.rowIndex,
        name: row.name,
        cells: input.visibleProperties
          .filter((property) => propertyKeys.has(property.key))
          .map((property) => buildCell(row, property)),
      };
    });

  if (rows.length === 0) return null;
  const selectedCellCount = rows.reduce((sum, row) => sum + row.cells.length, 0);
  return {
    source: 'library_table',
    libraryId: input.libraryId,
    libraryName: input.libraryName,
    sectionName: input.sectionName,
    selectionLabel: `${tableName} · 选中 ${selectedCellCount} 个单元格`,
    mode: 'cells',
    selectedCellCount,
    selectedRowCount: rows.length,
    rows,
  };
}
