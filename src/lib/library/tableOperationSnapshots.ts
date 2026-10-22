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
  existingRows: AssetRow[] = [],
  rowIndexUpdates: Array<{ assetId: string; rowIndex: number }> = [],
): LibraryTableOperationInput {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const beforeIndexUpdates = rowIndexUpdates.map((update) => {
    const row = existingById.get(update.assetId);
    if (!row) throw new Error(`Table row ${update.assetId} no longer exists`);
    return { id: update.assetId, rowIndex: row.rowIndex ?? null };
  });
  const afterIndexUpdates = rowIndexUpdates.map((update) => ({ id: update.assetId, rowIndex: update.rowIndex }));
  const createdAssets = rows.map((row) => ({
    id: row.id,
    name: row.name,
    rowIndex: row.rowIndex,
    values: Object.entries(row.values).map(([fieldId, value]) => ({ fieldId, value, present: true })),
  }));
  return {
    kind: 'rows_created',
    forward: { rows, ...(afterIndexUpdates.length > 0 ? { rowIndexUpdates: afterIndexUpdates } : {}) },
    inverse: { rows, ...(beforeIndexUpdates.length > 0 ? { rowIndexUpdates: beforeIndexUpdates } : {}) },
    expected: {
      before: {
        assetIdsAbsent: rows.map((row) => row.id),
        ...(beforeIndexUpdates.length > 0 ? { assets: beforeIndexUpdates } : {}),
      },
      after: {
        assets: [...createdAssets, ...afterIndexUpdates],
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

type FieldSnapshotInput = {
  id: string;
  name: string;
  dataType?: string;
  description?: string | null;
  formulaExpression?: string;
  orderIndex: number;
  required?: boolean;
  enumOptions?: string[];
  referenceLibraries?: string[];
};

function toFieldSnapshot(field: FieldSnapshotInput) {
  return {
    id: field.id,
    label: field.name,
    dataType: field.dataType ?? 'string',
    description: field.description ?? null,
    formulaExpression: field.formulaExpression ?? null,
    orderIndex: field.orderIndex,
    required: field.required ?? false,
    enumOptions: field.enumOptions ?? null,
    referenceLibraries: field.referenceLibraries ?? null,
  };
}

/**
 * Field deletes cascade their stored values. Keep both the definition and
 * every present value in the inverse so an undo restores the original field.
 */
export function buildFieldDeleteOperation(
  field: FieldSnapshotInput,
  rows: Array<Pick<AssetRow, 'id' | 'propertyValues'>>,
): LibraryTableOperationInput {
  const fieldSnapshot = toFieldSnapshot(field);
  const assetValues = rows
    .filter((row) => Object.prototype.hasOwnProperty.call(row.propertyValues, field.id))
    .map((row) => ({ assetId: row.id, fieldId: field.id, value: row.propertyValues[field.id] }));
  const expectedAssets = assetValues.map((value) => ({
    id: value.assetId,
    values: [{ fieldId: field.id, value: value.value, present: true }],
  }));

  return {
    kind: 'field_deleted',
    forward: { fields: [{ id: field.id }] },
    inverse: { fields: [fieldSnapshot], assetValues },
    expected: {
      before: { fields: [fieldSnapshot], assets: expectedAssets },
      after: { fieldIdsAbsent: [field.id] },
    },
  };
}

/** Update every affected definition together so formula reference rewrites are atomic. */
export function buildFieldUpdateOperation(
  before: FieldSnapshotInput[],
  after: FieldSnapshotInput[],
): LibraryTableOperationInput {
  if (before.length === 0 || before.length !== after.length) {
    throw new Error('Field update snapshots must have matching non-empty definitions');
  }
  const beforeById = new Map(before.map((field) => [field.id, field]));
  if (after.some((field) => !beforeById.has(field.id))) {
    throw new Error('Field update snapshots must preserve field identities');
  }
  const beforeSnapshots = before.map(toFieldSnapshot);
  const afterSnapshots = after.map(toFieldSnapshot);
  return {
    kind: 'field_updated',
    forward: { fields: afterSnapshots },
    inverse: { fields: beforeSnapshots },
    expected: {
      before: { fields: beforeSnapshots },
      after: { fields: afterSnapshots },
    },
  };
}

export function buildFieldCreateOperation(
  existingFields: FieldSnapshotInput[],
  createdField: FieldSnapshotInput,
  assetValues: Array<{ assetId: string; fieldId: string; value: unknown }> = [],
): LibraryTableOperationInput {
  if (existingFields.some((field) => field.id === createdField.id)) {
    throw new Error('Created field identity must not already exist');
  }
  const orderedExistingFields = existingFields
    .slice()
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const insertionIndex = Math.max(0, Math.min(createdField.orderIndex, orderedExistingFields.length));
  const afterFields = [
    ...orderedExistingFields.slice(0, insertionIndex),
    createdField,
    ...orderedExistingFields.slice(insertionIndex),
  ].map((field, index) => ({ ...field, orderIndex: index }));
  const beforeSnapshots = orderedExistingFields.map(toFieldSnapshot);
  const createdSnapshot = toFieldSnapshot(afterFields[insertionIndex]);
  const afterSnapshots = afterFields.map(toFieldSnapshot);
  const expectedAssets = assetValues.map((value) => ({
    id: value.assetId,
    values: [{ fieldId: value.fieldId, value: value.value, present: true }],
  }));
  return {
    kind: 'field_created',
    forward: {
      fields: [createdSnapshot],
      ...(assetValues.length > 0 ? { assetValues } : {}),
      orderedIds: afterFields.map((field) => field.id),
    },
    inverse: {
      fields: [{ id: createdField.id }],
      orderedIds: existingFields
        .slice()
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((field) => field.id),
    },
    expected: {
      before: { fieldIdsAbsent: [createdField.id], fields: beforeSnapshots },
      after: { fields: afterSnapshots, assets: expectedAssets },
    },
  };
}
