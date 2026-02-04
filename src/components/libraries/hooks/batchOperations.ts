import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

/** 粘贴锚点：左上角单元格的行索引和列索引（基于当前行列表） */
export type PasteAnchor = { rowIndex: number; colIndex: number };

/** 剪贴板矩阵：与 copy 时一致的二维数组，行 x 列 */
export type ClipboardMatrix = Array<Array<string | number | null>>;

/** 纯函数：对当前行快照应用一次粘贴，得到要更新的行和要新建的行 */
export type ApplyPasteResult = {
  /** 对已有行的更新，按 rowIndex 升序，便于按顺序写回 Yjs */
  updates: Array<{ rowIndex: number; row: AssetRow }>;
  /** 需要追加的新行（无 id），顺序即追加顺序 */
  creates: Array<{ name: string; propertyValues: Record<string, any> }>;
  /** 是否存在类型不匹配（若有则调用方应只提示，不应用） */
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
 * 对当前行快照应用一次粘贴操作（纯函数，可单测）。
 * 以 anchor 为左上角，将 matrix 按行/列贴到 rows 上；不足的行视为“新建行”。
 *
 * @param rows 当前行列表快照（通常来自 yRows.toArray()）
 * @param properties 列定义（顺序与表格一致）
 * @param anchor 粘贴起点 { rowIndex, colIndex }
 * @param matrix 剪贴板二维数组
 * @param sourcePropertyKeys 可选，copy 时的列 key 顺序，用于类型兼容检查
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
