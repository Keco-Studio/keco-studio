import type { AssetRow } from '@/lib/types/libraryAssets';
import type { LibraryTableOperationInput } from '@/lib/services/libraryTableOperationsService';

type AssetUpdate = {
  assetId: string;
  assetName: string;
  propertyValues: Record<string, unknown>;
};

type CellSnapshot = {
  fieldId: string;
  value: unknown;
  present: boolean;
};

type AssetSnapshot = {
  id: string;
  name?: string;
  values: CellSnapshot[];
};

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildCellUpdateOperation(
  rows: AssetRow[],
  updates: AssetUpdate[],
  deferredMediaPaths: string[] = [],
  inverseDeferredMediaPaths: string[] = [],
): LibraryTableOperationInput | null {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const beforeAssets: AssetSnapshot[] = [];
  const afterAssets: AssetSnapshot[] = [];

  for (const update of updates) {
    const row = rowsById.get(update.assetId);
    if (!row) throw new Error(`Table row ${update.assetId} no longer exists`);
    const beforeValues: CellSnapshot[] = [];
    const afterValues: CellSnapshot[] = [];
    for (const [fieldId, afterValue] of Object.entries(update.propertyValues)) {
      const beforePresent = Object.prototype.hasOwnProperty.call(row.propertyValues, fieldId);
      const beforeValue = row.propertyValues[fieldId];
      if (sameValue(beforeValue, afterValue) && beforePresent) continue;
      beforeValues.push({ fieldId, value: beforeValue, present: beforePresent });
      afterValues.push({ fieldId, value: afterValue, present: true });
    }
    const nameChanged = row.name !== update.assetName;
    if (!nameChanged && beforeValues.length === 0) continue;
    beforeAssets.push({
      id: row.id,
      ...(nameChanged ? { name: row.name } : {}),
      values: beforeValues,
    });
    afterAssets.push({
      id: row.id,
      ...(nameChanged ? { name: update.assetName } : {}),
      values: afterValues,
    });
  }

  if (beforeAssets.length === 0) return null;
  return {
    kind: 'cells_updated',
    forward: {
      assets: afterAssets,
      ...(deferredMediaPaths.length > 0 ? { deferredMediaPaths: [...new Set(deferredMediaPaths)] } : {}),
    },
    inverse: {
      assets: beforeAssets,
      ...(inverseDeferredMediaPaths.length > 0
        ? { deferredMediaPaths: [...new Set(inverseDeferredMediaPaths)] }
        : {}),
    },
    expected: {
      before: { assets: beforeAssets },
      after: { assets: afterAssets },
    },
  };
}

export function buildRowDeleteOperation(
  rows: AssetRow[],
  rowIds: string[],
): LibraryTableOperationInput {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const snapshots = rowIds.map((rowId) => {
    const row = rowsById.get(rowId);
    if (!row) throw new Error(`Table row ${rowId} no longer exists`);
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      rowIndex: row.rowIndex ?? null,
      values: row.propertyValues,
    };
  });
  const expectedAssets = snapshots.map((row) => ({
    id: row.id,
    name: row.name,
    rowIndex: row.rowIndex,
    values: Object.entries(row.values).map(([fieldId, value]) => ({ fieldId, value, present: true })),
  }));
  return {
    kind: 'rows_deleted',
    forward: { rows: snapshots },
    inverse: { rows: snapshots },
    expected: {
      before: { assets: expectedAssets },
      after: { assetIdsAbsent: snapshots.map((row) => row.id) },
    },
  };
}

export function buildRowCreateOperation(
  rows: Array<{
    id: string;
    name: string;
    createdAt: string;
    rowIndex: number | null;
    values: Record<string, unknown>;
  }>,
): LibraryTableOperationInput {
  return {
    kind: 'rows_created',
    forward: { rows },
    inverse: { rows },
    expected: {
      before: { assetIdsAbsent: rows.map((row) => row.id) },
      after: {
        assets: rows.map((row) => ({
          id: row.id,
          name: row.name,
          rowIndex: row.rowIndex,
          values: Object.entries(row.values).map(([fieldId, value]) => ({ fieldId, value, present: true })),
        })),
      },
    },
  };
}

function buildReorderOperation(
  kind: 'rows_reordered' | 'fields_reordered',
  beforeOrder: string[],
  afterOrder: string[],
  beforeExpected: Record<string, unknown>[],
): LibraryTableOperationInput {
  if (beforeOrder.length !== afterOrder.length
    || new Set(beforeOrder).size !== beforeOrder.length
    || beforeOrder.some((id) => !afterOrder.includes(id))) {
    throw new Error('Table order must contain every row or column exactly once');
  }
  return {
    kind,
    forward: { orderedIds: afterOrder },
    inverse: { orderedIds: beforeOrder },
    expected: {
      before: { assets: kind === 'rows_reordered'
        ? beforeExpected
        : [], fields: kind === 'fields_reordered'
        ? beforeExpected
        : [] },
      after: { assets: kind === 'rows_reordered'
        ? afterOrder.map((id, index) => ({ id, rowIndex: index + 1 }))
        : [], fields: kind === 'fields_reordered'
        ? afterOrder.map((id, index) => ({ id, orderIndex: index }))
        : [] },
    },
  };
}

export function buildRowReorderOperation(rows: AssetRow[], orderedIds: string[]): LibraryTableOperationInput {
  return buildReorderOperation(
    'rows_reordered',
    rows.map((row) => row.id),
    orderedIds,
    rows.map((row) => ({ id: row.id, rowIndex: row.rowIndex ?? null })),
  );
}

export function buildFieldReorderOperation(
  fields: Array<{ id: string; orderIndex?: number }>,
  orderedIds: string[],
): LibraryTableOperationInput {
  return buildReorderOperation(
    'fields_reordered',
    fields.map((field) => field.id),
    orderedIds,
    fields.map((field) => ({ id: field.id, orderIndex: field.orderIndex ?? null })),
  );
}
