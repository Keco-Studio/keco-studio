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
const updateAsset = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);

jest.mock('@/lib/services/libraryAssetsService', () => ({
  createAsset,
  deleteAssets,
  normalizeRowIndices,
  shiftRowIndices,
  updateAsset,
}));

import {
  deleteDialogueBlock,
  insertDialogueThreadAfter,
  updateDialogueBlockSpeaker,
  updateDialogueRowsContent,
} from './scriptDialogueMutations';

describe('updateDialogueRowsContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateAsset.mockReset().mockResolvedValue(undefined);
  });

  it('starts independent action and speech updates concurrently', async () => {
    let releaseAction!: () => void;
    let releaseSpeech!: () => void;
    updateAsset
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseAction = resolve;
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseSpeech = resolve;
      }));
    const rows = [
      {
        id: 'action',
        libraryId: 'library',
        name: 'Hero',
        propertyValues: { content: 'old action' },
      },
      {
        id: 'speech',
        libraryId: 'library',
        name: 'Hero',
        propertyValues: { content: 'old dialogue' },
      },
    ];

    const pending = updateDialogueRowsContent({
      supabase: {} as never,
      contentKey: 'content',
      updates: [
        { row: rows[0], content: 'new action' },
        { row: rows[1], content: 'new dialogue' },
      ],
    });
    await Promise.resolve();

    expect(updateAsset).toHaveBeenCalledTimes(2);
    releaseAction();
    releaseSpeech();
    await expect(pending).resolves.toEqual([
      { row: rows[0], oldContent: 'old action', newContent: 'new action' },
      { row: rows[1], oldContent: 'old dialogue', newContent: 'new dialogue' },
    ]);
  });
});

describe('insertDialogueThreadAfter rollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateAsset.mockReset().mockResolvedValue(undefined);
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
        propertyValues: { type: '2', name: 'Alpha', content: 'anchor' },
      },
      {
        id: 'next',
        libraryId: 'library',
        name: 'next',
        rowIndex: 1,
        propertyValues: { type: '2', name: 'Beta', content: 'next' },
      },
    ];

    await insertDialogueThreadAfter({
      supabase: {} as never,
      libraryId: 'library',
      rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      afterRowId: 'anchor',
      speaker: 'Beta',
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
        propertyValues: { type: '2', name: 'Alpha', content: 'before' },
      },
      {
        id: 'after',
        libraryId: 'library',
        name: 'after',
        rowIndex: 2,
        propertyValues: { type: '2', name: 'Beta', content: 'after' },
      },
    ];

    await expect(insertDialogueThreadAfter({
      supabase: {} as never,
      libraryId: 'library',
      rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      afterRowId: 'before',
      speaker: 'Beta',
    })).rejects.toThrow('speech failed');

    expect(deleteAssets).toHaveBeenCalledWith({}, ['new-action']);
    expect(normalizeRowIndices).toHaveBeenCalledWith({}, 'library', rows);
  });
});

describe('deleteDialogueBlock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateAsset.mockReset().mockResolvedValue(undefined);
  });

  it('deletes both rows that render the avatar, action, and dialogue block', async () => {
    const rows = [
      {
        id: 'action',
        libraryId: 'library',
        name: 'Hero',
        rowIndex: 1,
        propertyValues: { type: '3', name: 'Hero', content: 'Raises sword' },
      },
      {
        id: 'speech',
        libraryId: 'library',
        name: 'Hero',
        rowIndex: 2,
        propertyValues: { type: '2', name: 'Hero', content: 'Forward' },
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
        speaker: 'Hero',
        action: 'Raises sword',
        dialogue: 'Forward',
        speechType: '2',
        accent: 'green',
        alignment: 'left',
      },
    });

    expect(deleteAssets).toHaveBeenCalledWith({}, ['action', 'speech']);
    expect(snapshot.rows.map((row) => row.id)).toEqual(['action', 'speech']);
  });
});

describe('updateDialogueBlockSpeaker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateAsset.mockReset().mockResolvedValue(undefined);
  });

  it('updates the action and speech rows to the selected character', async () => {
    const rows = [
      {
        id: 'action',
        libraryId: 'library',
        name: 'Hero',
        propertyValues: { type: '3', name: 'Hero', content: 'Raises sword' },
      },
      {
        id: 'speech',
        libraryId: 'library',
        name: 'Hero',
        propertyValues: { type: '2', name: 'Hero', content: 'Forward' },
      },
    ];

    await updateDialogueBlockSpeaker({
      supabase: {} as never,
      rows,
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
      block: {
        id: 'speech',
        actionRowId: 'action',
        speechRowId: 'speech',
        rowIndexes: [0, 1],
        speaker: 'Hero',
        action: 'Raises sword',
        dialogue: 'Forward',
        speechType: '2',
        accent: 'green',
        alignment: 'left',
      },
      speaker: 'I',
      speechType: '1',
    });

    expect(updateAsset).toHaveBeenNthCalledWith(1, {}, 'action', 'I', {
      type: '3',
      name: 'I',
      content: 'Raises sword',
    });
    expect(updateAsset).toHaveBeenNthCalledWith(2, {}, 'speech', 'I', {
      type: '1',
      name: 'I',
      content: 'Forward',
    });
  });
});
