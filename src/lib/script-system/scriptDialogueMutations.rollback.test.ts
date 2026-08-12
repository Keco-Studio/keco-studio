import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const createAsset = jest.fn<(...args: unknown[]) => Promise<string>>();
const deleteAssets = jest.fn<(_supabase: unknown, _ids: string[]) => Promise<void>>(
  async () => undefined,
);
const normalizeRowIndices = jest.fn<(
  _supabase: unknown,
  _libraryId: string,
  _rows: Array<{ id: string }>,
) => Promise<void>>(async () => undefined);
const shiftRowIndices = jest.fn<(...args: unknown[]) => Promise<void>>(
  async () => undefined,
);

jest.mock('@/lib/services/libraryAssetsService', () => ({
  createAsset,
  deleteAssets,
  normalizeRowIndices,
  shiftRowIndices,
  updateAsset: jest.fn(),
}));

import { deleteDialogueBlock, insertDialogueThreadAfter } from './scriptDialogueMutations';

describe('insertDialogueThreadAfter rollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes zero-based imported rows before inserting below the anchor', async () => {
    createAsset
      .mockResolvedValueOnce('new-action')
      .mockResolvedValueOnce('new-speech');
    const rows = [
      {
        id: 'anchor',
        libraryId: 'library',
        name: 'anchor',
        rowIndex: 0,
        propertyValues: { type: '2', name: '甲', content: 'anchor' },
      },
      {
        id: 'next',
        libraryId: 'library',
        name: 'next',
        rowIndex: 1,
        propertyValues: { type: '2', name: '乙', content: 'next' },
      },
    ];

    await insertDialogueThreadAfter({
      supabase: {} as never,
      libraryId: 'library',
      rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      afterRowId: 'anchor',
      speaker: '乙',
    });

    expect(normalizeRowIndices).toHaveBeenCalledWith({}, 'library', rows);
    expect(shiftRowIndices).toHaveBeenCalledWith({}, 'library', 2, 2);
    expect(createAsset.mock.calls[0]?.[4]).toEqual({ rowIndex: 2 });
    expect(createAsset.mock.calls[1]?.[4]).toEqual({ rowIndex: 3 });
  });

  it('removes a partial action row and restores row order when speech creation fails', async () => {
    createAsset
      .mockResolvedValueOnce('new-action')
      .mockRejectedValueOnce(new Error('speech failed'));
    const rows = [
      {
        id: 'before',
        libraryId: 'library',
        name: 'before',
        rowIndex: 1,
        propertyValues: { type: '2', name: '甲', content: 'before' },
      },
      {
        id: 'after',
        libraryId: 'library',
        name: 'after',
        rowIndex: 2,
        propertyValues: { type: '2', name: '乙', content: 'after' },
      },
    ];

    await expect(insertDialogueThreadAfter({
      supabase: {} as never,
      libraryId: 'library',
      rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      afterRowId: 'before',
      speaker: '乙',
    })).rejects.toThrow('speech failed');

    expect(deleteAssets).toHaveBeenCalledWith({}, ['new-action']);
    expect(normalizeRowIndices).toHaveBeenCalledWith({}, 'library', rows);
  });
});

describe('deleteDialogueBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes both rows that render the avatar, action, and dialogue block', async () => {
    const rows = [
      {
        id: 'action',
        libraryId: 'library',
        name: '勇者',
        rowIndex: 1,
        propertyValues: { type: '3', name: '勇者', content: '举剑' },
      },
      {
        id: 'speech',
        libraryId: 'library',
        name: '勇者',
        rowIndex: 2,
        propertyValues: { type: '2', name: '勇者', content: '向前' },
      },
    ];

    const snapshot = await deleteDialogueBlock({
      supabase: {} as never,
      rows,
      block: {
        id: 'speech',
        actionRowId: 'action',
        speechRowId: 'speech',
        rowIndexes: [0, 1],
        speaker: '勇者',
        action: '举剑',
        dialogue: '向前',
        speechType: '2',
        accent: 'green',
        alignment: 'left',
      },
    });

    expect(deleteAssets).toHaveBeenCalledWith({}, ['action', 'speech']);
    expect(snapshot.rows.map((row) => row.id)).toEqual(['action', 'speech']);
  });
});
