'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast } from '@/lib/utils/toast';
import {
  buildScriptDialogueBlocks,
  listScriptDialogueCharacters,
  type ScriptDialogueBlock,
  type ScriptDialogueCharacter,
} from '@/lib/script-system/scriptDialogueBlocks';
import {
  applyRowOrder,
  deleteDialogueBlock,
  ensureActionRowForBlock,
  ensureSpeechRowForBlock,
  insertDialogueThreadAfter,
  reorderDialogueBlock,
  restoreDeletedDialogueBlock,
  updateDialogueRowContent,
  type DeletedDialogueSnapshot,
  type ScriptDialogueFieldKeys,
} from '@/lib/script-system/scriptDialogueMutations';
import { deleteAssets } from '@/lib/services/libraryAssetsService';

type HistoryEntry =
  | {
      type: 'insert';
      actionRowId: string;
      speechRowId: string;
      afterRowId: string | null;
      speaker: string;
    }
  | {
      type: 'delete';
      snapshot: DeletedDialogueSnapshot;
    }
  | {
      type: 'update';
      rowId: string;
      contentKey: string;
      oldContent: string;
      newContent: string;
      rowName: string;
      propertyValues: Record<string, unknown>;
    }
  | {
      type: 'reorder';
      previousOrderIds: string[];
      nextOrderIds: string[];
    };

export function createSerializedCommandQueue(
  onPendingChange: (pending: number) => void,
) {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return function enqueue<T>(command: () => Promise<T>): Promise<T> {
    pending += 1;
    onPendingChange(pending);
    const result = tail.then(command).finally(() => {
      pending -= 1;
      onPendingChange(pending);
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function resolveEditingBlockAfterFinish(
  currentBlockId: string | null,
  finishedBlockId: string,
): string | null {
  return currentBlockId === finishedBlockId ? null : currentBlockId;
}

export type UseScriptDialogueEditorArgs = {
  supabase: SupabaseClient | null;
  libraryId: string;
  rows: AssetRow[];
  selectedRows: AssetRow[];
  fields: ScriptDialogueFieldKeys | null;
};

export function useScriptDialogueEditor({
  supabase,
  libraryId,
  rows,
  selectedRows,
  fields,
}: UseScriptDialogueEditorArgs) {
  const queryClient = useQueryClient();
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);
  const [pendingCommands, setPendingCommands] = useState(0);
  const busyRef = useRef(false);
  const commandQueueRef = useRef<ReturnType<typeof createSerializedCommandQueue> | null>(null);
  if (!commandQueueRef.current) {
    commandQueueRef.current = createSerializedCommandQueue(setPendingCommands);
  }
  const enqueueCommand = commandQueueRef.current;

  const characters: ScriptDialogueCharacter[] = useMemo(
    () => (fields ? listScriptDialogueCharacters(rows, fields) : []),
    [fields, rows],
  );

  const blocks: ScriptDialogueBlock[] = useMemo(
    () => (fields ? buildScriptDialogueBlocks(selectedRows, fields) : []),
    [fields, selectedRows],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
  }, [libraryId, queryClient]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistoryPast((prev) => [...prev, entry]);
    setHistoryFuture([]);
  }, []);

  const findRow = useCallback(
    (rowId: string) => rows.find((row) => row.id === rowId),
    [rows],
  );

  const insertAfterBlock = useCallback(async (blockId: string | null, speaker: string) => {
    if (!supabase || !fields || busyRef.current) return false;
    busyRef.current = true;
    try {
      const block = blockId ? blocks.find((item) => item.id === blockId) : null;
      const afterRowId = block
        ? (block.speechRowId ?? block.actionRowId ?? null)
        : (selectedRows[selectedRows.length - 1]?.id ?? null);

      const inserted = await insertDialogueThreadAfter({
        supabase,
        libraryId,
        rows,
        fields,
        afterRowId,
        speaker,
      });
      pushHistory({
        type: 'insert',
        actionRowId: inserted.actionRowId,
        speechRowId: inserted.speechRowId,
        afterRowId,
        speaker,
      });
      setEditingBlockId(inserted.speechRowId);
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to add dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, fields, libraryId, pushHistory, refresh, rows, selectedRows, supabase]);

  const saveBlockField = useCallback(async (
    blockId: string,
    field: 'action' | 'dialogue',
    value: string,
  ) => {
    if (!supabase || !fields || busyRef.current) return false;
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return false;

    const trimmed = value;
    if (field === 'action' && trimmed === block.action) return true;
    if (field === 'dialogue' && trimmed === block.dialogue) return true;

    busyRef.current = true;
    try {
      if (field === 'action') {
        let actionRowId = block.actionRowId;
        if (!actionRowId) {
          const ensured = await ensureActionRowForBlock({
            supabase,
            libraryId,
            rows,
            fields,
            block,
          });
          actionRowId = ensured.actionRowId;
          await refresh();
        }
        const row = findRow(actionRowId) ?? rows.find((item) => item.id === actionRowId);
        // After ensure+refresh, row may not be in current closure; re-read from query cache.
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId));
        const liveRow = cached?.find((item) => item.id === actionRowId) ?? row;
        if (!liveRow) throw new Error('Action row missing after ensure');
        const { oldContent } = await updateDialogueRowContent({
          supabase,
          row: liveRow,
          contentKey: fields.contentKey,
          content: trimmed,
        });
        pushHistory({
          type: 'update',
          rowId: liveRow.id,
          contentKey: fields.contentKey,
          oldContent,
          newContent: trimmed,
          rowName: liveRow.name,
          propertyValues: { ...liveRow.propertyValues },
        });
      } else {
        let speechRowId = block.speechRowId;
        if (!speechRowId) {
          const ensured = await ensureSpeechRowForBlock({
            supabase,
            libraryId,
            rows,
            fields,
            block,
          });
          speechRowId = ensured.speechRowId;
          await refresh();
        }
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId));
        const liveRow = cached?.find((item) => item.id === speechRowId)
          ?? findRow(speechRowId);
        if (!liveRow) throw new Error('Speech row missing after ensure');
        const { oldContent } = await updateDialogueRowContent({
          supabase,
          row: liveRow,
          contentKey: fields.contentKey,
          content: trimmed,
        });
        pushHistory({
          type: 'update',
          rowId: liveRow.id,
          contentKey: fields.contentKey,
          oldContent,
          newContent: trimmed,
          rowName: liveRow.name,
          propertyValues: { ...liveRow.propertyValues },
        });
        if (speechRowId !== blockId) setEditingBlockId(speechRowId);
      }
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to save dialogue');
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, fields, findRow, libraryId, pushHistory, queryClient, refresh, rows, supabase]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!supabase || !fields || busyRef.current) return false;
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return false;
    busyRef.current = true;
    try {
      const snapshot = await deleteDialogueBlock({ supabase, rows, block });
      pushHistory({ type: 'delete', snapshot });
      if (editingBlockId === blockId) setEditingBlockId(null);
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to delete dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, editingBlockId, fields, pushHistory, refresh, rows, supabase]);

  const reorderBlock = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!supabase || !fields || busyRef.current) return false;
    busyRef.current = true;
    try {
      const blockOrderIds = blocks.map((block) => block.id);
      const blockRowIds = new Map(
        blocks.map((block) => [
          block.id,
          [block.actionRowId, block.speechRowId].filter((id): id is string => Boolean(id)),
        ]),
      );
      const result = await reorderDialogueBlock({
        supabase,
        libraryId,
        rows,
        blockOrderIds,
        fromIndex,
        toIndex,
        blockRowIds,
      });
      if (result.previousOrderIds.join() !== result.nextOrderIds.join()) {
        pushHistory({
          type: 'reorder',
          previousOrderIds: result.previousOrderIds,
          nextOrderIds: result.nextOrderIds,
        });
      }
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to reorder dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, fields, libraryId, pushHistory, refresh, rows, supabase]);

  const undo = useCallback(async () => {
    if (!supabase || !fields || busyRef.current || historyPast.length === 0) return false;
    const entry = historyPast[historyPast.length - 1];
    busyRef.current = true;
    try {
      if (entry.type === 'insert') {
        await deleteAssets(supabase, [entry.actionRowId, entry.speechRowId]);
        setHistoryPast((prev) => prev.slice(0, -1));
        setHistoryFuture((prev) => [entry, ...prev]);
      } else if (entry.type === 'delete') {
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId)) ?? rows;
        const restoredSnapshot = await restoreDeletedDialogueBlock({
          supabase,
          libraryId,
          currentRows: cached,
          snapshot: entry.snapshot,
        });
        setHistoryPast((prev) => prev.slice(0, -1));
        setHistoryFuture((prev) => [{ type: 'delete', snapshot: restoredSnapshot }, ...prev]);
      } else if (entry.type === 'update') {
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId)) ?? rows;
        const row = cached.find((item) => item.id === entry.rowId);
        if (row) {
          const { updateAsset } = await import('@/lib/services/libraryAssetsService');
          await updateAsset(supabase, row.id, row.name, {
            ...row.propertyValues,
            [entry.contentKey]: entry.oldContent,
          });
        }
        setHistoryPast((prev) => prev.slice(0, -1));
        setHistoryFuture((prev) => [entry, ...prev]);
      } else if (entry.type === 'reorder') {
        await applyRowOrder({
          supabase,
          libraryId,
          orderIds: entry.previousOrderIds,
        });
        setHistoryPast((prev) => prev.slice(0, -1));
        setHistoryFuture((prev) => [entry, ...prev]);
      }
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Undo failed');
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [fields, historyPast, libraryId, queryClient, refresh, rows, supabase]);

  const redo = useCallback(async () => {
    if (!supabase || !fields || busyRef.current || historyFuture.length === 0) return false;
    const entry = historyFuture[0];
    busyRef.current = true;
    try {
      let nextEntry = entry;
      if (entry.type === 'insert') {
        const inserted = await insertDialogueThreadAfter({
          supabase,
          libraryId,
          rows: queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId)) ?? rows,
          fields,
          afterRowId: entry.afterRowId,
          speaker: entry.speaker,
        });
        nextEntry = {
          ...entry,
          actionRowId: inserted.actionRowId,
          speechRowId: inserted.speechRowId,
        };
        setEditingBlockId(inserted.speechRowId);
      } else if (entry.type === 'delete') {
        const ids = entry.snapshot.rows.map((row) => row.id);
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId)) ?? rows;
        const existing = ids.filter((id) => cached.some((row) => row.id === id));
        if (existing.length > 0) {
          await deleteAssets(supabase, existing);
        }
      } else if (entry.type === 'update') {
        const cached = queryClient.getQueryData<AssetRow[]>(queryKeys.libraryAssets(libraryId)) ?? rows;
        const row = cached.find((item) => item.id === entry.rowId);
        if (row) {
          const { updateAsset } = await import('@/lib/services/libraryAssetsService');
          await updateAsset(supabase, row.id, row.name, {
            ...row.propertyValues,
            [entry.contentKey]: entry.newContent,
          });
        }
      } else if (entry.type === 'reorder') {
        await applyRowOrder({
          supabase,
          libraryId,
          orderIds: entry.nextOrderIds,
        });
      }
      setHistoryFuture((prev) => prev.slice(1));
      setHistoryPast((prev) => [...prev, nextEntry]);
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Redo failed');
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [fields, historyFuture, libraryId, queryClient, refresh, rows, supabase]);

  const queuedInsertAfterBlock = useCallback(
    (blockId: string | null, speaker: string) => enqueueCommand(
      () => insertAfterBlock(blockId, speaker),
    ),
    [enqueueCommand, insertAfterBlock],
  );
  const queuedSaveBlockField = useCallback(
    (blockId: string, field: 'action' | 'dialogue', value: string) => enqueueCommand(
      () => saveBlockField(blockId, field, value),
    ),
    [enqueueCommand, saveBlockField],
  );
  const queuedDeleteBlock = useCallback(
    (blockId: string) => enqueueCommand(() => deleteBlock(blockId)),
    [deleteBlock, enqueueCommand],
  );
  const queuedReorderBlock = useCallback(
    (fromIndex: number, toIndex: number) => enqueueCommand(
      () => reorderBlock(fromIndex, toIndex),
    ),
    [enqueueCommand, reorderBlock],
  );
  const queuedUndo = useCallback(
    () => enqueueCommand(undo),
    [enqueueCommand, undo],
  );
  const queuedRedo = useCallback(
    () => enqueueCommand(redo),
    [enqueueCommand, redo],
  );
  const isBusy = pendingCommands > 0;
  const finishEditingBlock = useCallback((blockId: string) => {
    setEditingBlockId((current) => resolveEditingBlockAfterFinish(current, blockId));
  }, []);

  return {
    enabled: Boolean(supabase && fields),
    characters,
    blocks,
    editingBlockId,
    setEditingBlockId,
    finishEditingBlock,
    isBusy,
    canUndo: !isBusy && historyPast.length > 0,
    canRedo: !isBusy && historyFuture.length > 0,
    insertAfterBlock: queuedInsertAfterBlock,
    saveBlockField: queuedSaveBlockField,
    deleteBlock: queuedDeleteBlock,
    reorderBlock: queuedReorderBlock,
    undo: queuedUndo,
    redo: queuedRedo,
  };
}
