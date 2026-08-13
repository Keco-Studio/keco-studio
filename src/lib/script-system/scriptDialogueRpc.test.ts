import { describe, expect, it, jest } from '@jest/globals';
import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  applyInsertedDialogueRows,
  deleteScriptDialogueBlock,
  insertScriptDialogueBlock,
  isMissingScriptDialogueRpcError,
  removeDeletedDialogueRows,
} from './scriptDialogueRpc';

const row = (id: string, rowIndex: number): AssetRow => ({
  id,
  libraryId: 'lib',
  name: id,
  slug: null,
  figmaNodeId: null,
  propertyValues: {},
  rowIndex,
});

describe('script dialogue RPC helpers', () => {
  it('inserts a dialogue block through one RPC and returns typed rows', async () => {
    const rpc = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      data: {
        action_row: { id: 'a2', library_id: 'lib', name: 'Hero', row_index: 2, property_values: { type: '3' } },
        speech_row: { id: 's2', library_id: 'lib', name: 'Hero', row_index: 3, property_values: { type: '1' } },
        action_row_index: 2,
      },
      error: null,
    });

    const result = await insertScriptDialogueBlock({
      supabase: { rpc } as never,
      libraryId: 'lib',
      afterRowId: 'a1',
      speaker: 'Hero',
      speechType: '1',
      fields: { typeKey: 'type', nameKey: 'name', contentKey: 'content' },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('insert_script_dialogue_block', expect.objectContaining({
      p_library_id: 'lib',
      p_after_row_id: 'a1',
      p_speaker: 'Hero',
    }));
    expect(result.speechRowId).toBe('s2');
  });

  it('deletes a block through one RPC', async () => {
    const rpc = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      data: { deleted_ids: ['a2', 's2'] },
      error: null,
    });

    await deleteScriptDialogueBlock({
      supabase: { rpc } as never,
      libraryId: 'lib',
      actionRowId: 'a2',
      speechRowId: 's2',
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('delete_script_dialogue_block', expect.any(Object));
  });

  it('applies returned insert rows and removes deleted rows without refetching', () => {
    expect(applyInsertedDialogueRows([row('a1', 1)], {
      actionRow: row('a2', 2),
      speechRow: row('s2', 3),
      actionRowId: 'a2',
      speechRowId: 's2',
      actionRowIndex: 2,
    }).map((item) => item.id)).toEqual(['a1', 'a2', 's2']);

    expect(removeDeletedDialogueRows([row('a1', 1), row('s2', 2)], ['s2']))
      .toEqual([row('a1', 1)]);
  });

  it('shifts cached rows after a middle insertion', () => {
    const updated = applyInsertedDialogueRows([row('before', 1), row('after', 2)], {
      actionRow: row('action', 2),
      speechRow: row('speech', 3),
      actionRowId: 'action',
      speechRowId: 'speech',
      actionRowIndex: 2,
    });

    expect(updated.map((item) => [item.id, item.rowIndex])).toEqual([
      ['before', 1],
      ['action', 2],
      ['speech', 3],
      ['after', 4],
    ]);
  });

  it('normalizes legacy cached indexes before applying an insertion', () => {
    const legacy = [row('before', 0), { ...row('after', 2), rowIndex: undefined }];
    const updated = applyInsertedDialogueRows(legacy, {
      actionRow: row('action', 2),
      speechRow: row('speech', 3),
      actionRowId: 'action',
      speechRowId: 'speech',
      actionRowIndex: 2,
    });

    expect(updated.map((item) => [item.id, item.rowIndex])).toEqual([
      ['before', 1],
      ['action', 2],
      ['speech', 3],
      ['after', 4],
    ]);
  });

  it('recognizes only missing PostgREST RPC errors for compatibility fallback', () => {
    expect(isMissingScriptDialogueRpcError({
      code: 'PGRST202',
      message: 'Could not find the function public.insert_script_dialogue_block in the schema cache',
    })).toBe(true);
    expect(isMissingScriptDialogueRpcError(new Error(
      'Could not find the function public.delete_script_dialogue_block in the schema cache',
    ))).toBe(true);
    expect(isMissingScriptDialogueRpcError({ code: '42501', message: 'Forbidden' })).toBe(false);
  });
});
