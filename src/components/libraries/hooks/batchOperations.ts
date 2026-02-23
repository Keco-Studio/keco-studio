import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

/** Paste anchor: row and column index of the top-left cell (based on current row list) */
export type PasteAnchor = { rowIndex: number; colIndex: number };

/** Clipboard matrix: 2D array matching copy layout, rows x columns */
export type ClipboardMatrix = Array<Array<string | number | null>>;

/** Pure function: apply one paste to current row snapshot; returns rows to update and rows to create */
export type ApplyPasteResult = {
  /** Updates to existing rows, sorted by rowIndex ascending for writing back to Yjs in order */
  updates: Array<{ rowIndex: number; row: AssetRow }>;
  /** New rows to append (no id), order is append order */
  creates: Array<{ name: string; propertyValues: Record<string, any> }>;
  /** Whether there is a type mismatch (caller should only show message, not apply) */
  typeMismatch: boolean;
};

const SUPPORTED_TYPES = ['string', 'int', 'float'] as const;

function isTypeCompatible(
  sourceType: string | null | undefined,
  targetType: string | undefined
): boolean {
  if (!sourceType || !SUPPORTED_TYPES.includes(sourceType as any)) return false;
  if (!targetType || !SUPPORTED_TYPES.includes(targetType as any)) return false;
  return sourceType === targetType;
}

function convertCellValue(
  cellValue: string | number | null | undefined,
  property: PropertyConfig,
  isNameField: boolean
): string | number | null {
  if (cellValue === null || cellValue === undefined || cellValue === '') return null;
  if (isNameField) return String(cellValue);
  if (property.dataType === 'int') {
    const n = parseInt(String(cellValue), 10);
    return isNaN(n) ? null : n;
  }
  if (property.dataType === 'float') {
    if (typeof cellValue === 'number' && !isNaN(cellValue)) return cellValue;
    const n = parseFloat(String(cellValue));
    return isNaN(n) ? null : n;
  }
  if (property.dataType === 'string') return String(cellValue);
  return null;
}

/**
 * Apply one paste to the current row snapshot (pure function, unit-testable).
 * Uses anchor as top-left; pastes matrix onto rows by row/column; missing rows are treated as new rows.
 *
 * @param rows Current row list snapshot (typically from yRows.toArray())
 * @param properties Column definitions (order matches table)
 * @param anchor Paste start { rowIndex, colIndex }
 * @param matrix Clipboard 2D array
 * @param sourcePropertyKeys Optional; column key order from copy, for type compatibility check
 */
export function applyPasteToRows(
  rows: AssetRow[],
  properties: PropertyConfig[],
  anchor: PasteAnchor,
  matrix: ClipboardMatrix,
  sourcePropertyKeys?: string[]
): ApplyPasteResult {
  const nameFieldKey = properties.find((p) => p.name === 'name' && p.dataType === 'string')?.key;
  const updatesByRowIndex = new Map<
    number,
    { row: AssetRow; name?: string; propertyValues: Record<string, any> }
  >();
  const createsByOffset = new Map<number, { name: string; propertyValues: Record<string, any> }>();
  let typeMismatch = false;

  for (let r = 0; r < matrix.length; r++) {
    const clipboardRow = matrix[r];
    if (!clipboardRow || !Array.isArray(clipboardRow)) continue;
    for (let c = 0; c < clipboardRow.length; c++) {
      const cellValue = clipboardRow[c];
      const targetRowIndex = anchor.rowIndex + r;
      const targetColIndex = anchor.colIndex + c;
      if (targetColIndex >= properties.length) continue;

      const targetProperty = properties[targetColIndex];
      const isNameField =
        targetProperty.name === 'name' && targetProperty.dataType === 'string';
      const typeSupported =
        targetProperty.dataType && SUPPORTED_TYPES.includes(targetProperty.dataType as any);
      if (!typeSupported && !isNameField) continue;

      if (!isNameField && sourcePropertyKeys && sourcePropertyKeys[c] !== undefined) {
        const sourceKey = sourcePropertyKeys[c];
        const sourceProp = properties.find((p) => p.key === sourceKey);
        if (sourceProp?.dataType && targetProperty.dataType) {
          if (!isTypeCompatible(sourceProp.dataType, targetProperty.dataType)) {
            typeMismatch = true;
            continue;
          }
        }
      }

      const convertedValue = convertCellValue(cellValue, targetProperty, isNameField);

      if (targetRowIndex >= rows.length) {
        const offset = targetRowIndex - rows.length;
        if (!createsByOffset.has(offset)) {
          createsByOffset.set(offset, { name: '', propertyValues: {} });
        }
        const data = createsByOffset.get(offset)!;
        if (isNameField) {
          data.name = convertedValue !== null && convertedValue !== '' ? String(convertedValue) : '';
          data.propertyValues[targetProperty.key] = convertedValue;
        } else {
          data.propertyValues[targetProperty.key] = convertedValue;
        }
      } else {
        const row = rows[targetRowIndex];
        if (!updatesByRowIndex.has(targetRowIndex)) {
          updatesByRowIndex.set(targetRowIndex, {
            row: { ...row },
            name: undefined,
            propertyValues: { ...row.propertyValues },
          });
        }
        const data = updatesByRowIndex.get(targetRowIndex)!;
        if (isNameField) {
          data.name =
            convertedValue !== null && convertedValue !== '' ? String(convertedValue) : '';
          data.propertyValues[targetProperty.key] = convertedValue;
        } else {
          data.propertyValues[targetProperty.key] = convertedValue;
        }
      }
    }
  }

  const updates: Array<{ rowIndex: number; row: AssetRow }> = [];
  updatesByRowIndex.forEach((data, rowIndex) => {
    const row = data.row;
    const name = data.name !== undefined ? data.name : row.name ?? '';
    updates.push({
      rowIndex,
      row: { ...row, name, propertyValues: data.propertyValues },
    });
  });
  updates.sort((a, b) => a.rowIndex - b.rowIndex);

  const maxOffset = createsByOffset.size === 0 ? -1 : Math.max(...createsByOffset.keys());
  const creates: Array<{ name: string; propertyValues: Record<string, any> }> = [];
  for (let i = 0; i <= maxOffset; i++) {
    const data = createsByOffset.get(i) ?? { name: '', propertyValues: {} };
    creates.push({ name: data.name, propertyValues: { ...data.propertyValues } });
  }

  return { updates, creates, typeMismatch };
}
