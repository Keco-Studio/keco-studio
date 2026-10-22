import { describe, expect, it } from '@jest/globals';
import {
  buildCellUpdateOperation,
  buildFieldReorderOperation,
  buildRowCreateOperation,
  buildRowDeleteOperation,
  buildRowReorderOperation,
} from '@/lib/library/tableOperationSnapshots';

describe('buildCellUpdateOperation', () => {
  it('keeps exact before and after values for a multi-row update', () => {
    const operation = buildCellUpdateOperation([
      { id: 'row-1', name: 'Before', propertyValues: { score: 1, note: 'keep' } },
      { id: 'row-2', name: 'Second', propertyValues: { score: null } },
    ] as any, [
      { assetId: 'row-1', assetName: 'After', propertyValues: { score: 4 } },
      { assetId: 'row-2', assetName: 'Second', propertyValues: { score: 2 } },
    ]);

    expect(operation).toEqual({
      kind: 'cells_updated',
      forward: {
        assets: [
          { id: 'row-1', name: 'After', values: [{ fieldId: 'score', value: 4, present: true }] },
          { id: 'row-2', values: [{ fieldId: 'score', value: 2, present: true }] },
        ],
      },
      inverse: {
        assets: [
          { id: 'row-1', name: 'Before', values: [{ fieldId: 'score', value: 1, present: true }] },
          { id: 'row-2', values: [{ fieldId: 'score', value: null, present: true }] },
        ],
      },
      expected: {
        before: {
          assets: [
            { id: 'row-1', name: 'Before', values: [{ fieldId: 'score', value: 1, present: true }] },
            { id: 'row-2', values: [{ fieldId: 'score', value: null, present: true }] },
          ],
        },
        after: {
          assets: [
            { id: 'row-1', name: 'After', values: [{ fieldId: 'score', value: 4, present: true }] },
            { id: 'row-2', values: [{ fieldId: 'score', value: 2, present: true }] },
          ],
        },
      },
    });
  });

  it('does not generate an operation when the update has no value changes', () => {
    expect(buildCellUpdateOperation([
      { id: 'row-1', name: 'Name', propertyValues: { score: 1 } },
    ] as any, [
      { assetId: 'row-1', assetName: 'Name', propertyValues: { score: 1 } },
    ])).toBeNull();
  });

  it('records displaced media paths for deferred cleanup', () => {
    const operation = buildCellUpdateOperation([
      { id: 'row-1', name: 'Name', propertyValues: { media: { path: 'user/project/old.png' } } },
    ] as any, [
      { assetId: 'row-1', assetName: 'Name', propertyValues: { media: null } },
    ], ['user/project/old.png'], ['user/project/new.png']);

    expect(operation?.forward).toMatchObject({ deferredMediaPaths: ['user/project/old.png'] });
    expect(operation?.inverse).toMatchObject({ deferredMediaPaths: ['user/project/new.png'] });
  });

  it('keeps the original row identity and values when deleting rows', () => {
    const operation = buildRowDeleteOperation([
      {
        id: 'row-1',
        name: 'Before',
        created_at: '2026-10-22T00:00:00.000Z',
        rowIndex: 3,
        propertyValues: { score: 4, note: null },
      },
    ] as any, ['row-1']);

    expect(operation).toEqual(expect.objectContaining({
      kind: 'rows_deleted',
      forward: { rows: [{ id: 'row-1', name: 'Before', createdAt: '2026-10-22T00:00:00.000Z', rowIndex: 3, values: { score: 4, note: null } }] },
      inverse: { rows: [{ id: 'row-1', name: 'Before', createdAt: '2026-10-22T00:00:00.000Z', rowIndex: 3, values: { score: 4, note: null } }] },
      expected: expect.objectContaining({ after: { assetIdsAbsent: ['row-1'] } }),
    }));
  });

  it('creates rows with caller-generated identities so undo removes the same row', () => {
    const operation = buildRowCreateOperation([
      { id: 'new-row', name: 'Untitled', createdAt: '2026-10-22T00:00:00.000Z', rowIndex: 5, values: { score: 0 } },
    ]);

    expect(operation).toEqual(expect.objectContaining({
      kind: 'rows_created',
      forward: { rows: [{ id: 'new-row', name: 'Untitled', createdAt: '2026-10-22T00:00:00.000Z', rowIndex: 5, values: { score: 0 } }] },
      inverse: { rows: [{ id: 'new-row', name: 'Untitled', createdAt: '2026-10-22T00:00:00.000Z', rowIndex: 5, values: { score: 0 } }] },
      expected: expect.objectContaining({ before: { assetIdsAbsent: ['new-row'] } }),
    }));
  });

  it('records complete before and after row order', () => {
    const operation = buildRowReorderOperation([
      { id: 'a', rowIndex: 1 }, { id: 'b', rowIndex: 2 }, { id: 'c', rowIndex: 3 },
    ] as any, ['c', 'a', 'b']);

    expect(operation).toMatchObject({
      kind: 'rows_reordered',
      forward: { orderedIds: ['c', 'a', 'b'] },
      inverse: { orderedIds: ['a', 'b', 'c'] },
    });
  });

  it('records complete before and after field order', () => {
    const operation = buildFieldReorderOperation([
      { id: 'a', orderIndex: 0 }, { id: 'b', orderIndex: 1 }, { id: 'c', orderIndex: 2 },
    ] as any, ['b', 'c', 'a']);

    expect(operation).toMatchObject({
      kind: 'fields_reordered',
      forward: { orderedIds: ['b', 'c', 'a'] },
      inverse: { orderedIds: ['a', 'b', 'c'] },
    });
  });
});
