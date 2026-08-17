'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast } from '@/lib/utils/toast';
import {
  buildScriptDialogueBlocks,
  listScriptDialogueCharacters,
  resolveSpeechTypeForSpeaker,
  sourceTextForDialogueBlock,
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
  updateDialogueBlockSpeaker,
  updateDialogueRowsContent,
  type DialogueSpeakerUpdate,
  type DeletedDialogueSnapshot,
  type ScriptDialogueFieldKeys,
} from '@/lib/script-system/scriptDialogueMutations';
import {
  applyInsertedDialogueRows,
  deleteScriptDialogueBlock,
  insertScriptDialogueBlock,
  isMissingScriptDialogueRpcError,
  removeDeletedDialogueRows,
} from '@/lib/script-system/scriptDialogueRpc';
import { deleteAssets } from '@/lib/services/libraryAssetsService';
import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';
import { syncScriptDialogueDocumentWithConflictRetry } from '@/lib/script-system/scriptDialogueDocumentSyncClient';
import {
  applySynchronizedDialogueOrder,
  planSynchronizedDialogueReorder,
} from '@/lib/script-system/scriptDialogueReorderSync';

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
    }
  | {
      type: 'speaker';
      updates: DialogueSpeakerUpdate[];
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

export function applySavedDialogueContent(
  rows: AssetRow[],
  rowId: string,
  contentKey: string,
  content: string,
): AssetRow[] {
  return rows.map((row) => row.id === rowId
    ? { ...row, propertyValues: { ...row.propertyValues, [contentKey]: content } }
    : row);
}

export async function persistSourceBeforeDialogueRows<T>(
  syncSource: () => Promise<unknown>,
  writeRows: () => Promise<T>,
): Promise<T> {
  await syncSource();
  return writeRows();
}

export async function invalidateSynchronizedLibraryQueries(
  queryClient: {
    invalidateQueries: (options: {
      queryKey: readonly unknown[];
      refetchType: 'all';
    }) => Promise<unknown>;
  },
  libraryIds: readonly string[],
): Promise<void> {
  await Promise.all(libraryIds.flatMap((updatedLibraryId) => [
    queryClient.invalidateQueries({
      queryKey: queryKeys.library(updatedLibraryId),
      refetchType: 'all',
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.libraryAssets(updatedLibraryId),
      refetchType: 'all',
    }),
  ]));
}

export type UseScriptDialogueEditorArgs = {
  supabase: SupabaseClient | null;
  libraryId: string;
  rows: AssetRow[];
  selectedRows: AssetRow[];
  fields: ScriptDialogueFieldKeys | null;
  projectId?: string;
  sourceDocumentId?: string | null;
  sourceToken?: DocumentStateToken | null;
};

function createDeletedDialogueSnapshot(
  rows: AssetRow[],
  block: ScriptDialogueBlock,
): DeletedDialogueSnapshot {
  const ids = [block.actionRowId, block.speechRowId].filter(
    (id): id is string => Boolean(id),
  );
  return {
    rows: ids.flatMap((id) => {
      const row = rows.find((item) => item.id === id);
      return row ? [{
        id: row.id,
        name: row.name,
        propertyValues: { ...row.propertyValues },
        rowIndex: row.rowIndex,
      }] : [];
    }),
    previousOrderIds: rows.map((row) => row.id),
  };
}

export function useScriptDialogueEditor({
  supabase,
  libraryId,
  rows,
  selectedRows,
  fields,
  projectId,
  sourceDocumentId,
  sourceToken,
}: UseScriptDialogueEditorArgs) {
  const queryClient = useQueryClient();
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [historyPast, setHistoryPast] = useState<HistoryEntry[]>([]);
  const [historyFuture, setHistoryFuture] = useState<HistoryEntry[]>([]);
  const [pendingCommands, setPendingCommands] = useState(0);
  const sourceTokenRef = useRef(sourceToken ?? null);
  useEffect(() => {
    if (sourceToken) sourceTokenRef.current = sourceToken;
  }, [sourceToken]);
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

  const allDialogueBlocks: ScriptDialogueBlock[] = useMemo(
    () => (fields ? buildScriptDialogueBlocks(rows, fields) : []),
    [fields, rows],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
  }, [libraryId, queryClient]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistoryPast((prev) => [...prev, entry]);
    setHistoryFuture([]);
  }, []);

  const isDerivedScript = Boolean(projectId && sourceDocumentId && sourceToken);

  const syncSource = useCallback(async (command: Parameters<typeof syncScriptDialogueDocumentWithConflictRetry>[0]['command']) => {
    const expected = sourceTokenRef.current ?? sourceToken ?? null;
    if (!isDerivedScript || !projectId || !sourceDocumentId || !expected) return;
    const refreshExpected = async (): Promise<DocumentStateToken> => {
      const { data, error } = await supabase
        .from('documents')
        .select('collab_epoch, collab_revision')
        .eq('id', sourceDocumentId)
        .single();
      if (error || !data) throw new Error('Failed to refresh source document state');
      const latest = {
        epoch: Number(data.collab_epoch),
        revision: Number(data.collab_revision),
      };
      sourceTokenRef.current = latest;
      return latest;
    };
    const result = await syncScriptDialogueDocumentWithConflictRetry(
      { projectId, libraryId, documentId: sourceDocumentId, expected, command },
      refreshExpected,
    );
    sourceTokenRef.current = result.state.token;
    if (result.plotPlan) {
      queryClient.setQueryData<Record<string, unknown>>(
        queryKeys.library(libraryId),
        (current) => current ? { ...current, plot_plan: result.plotPlan } : current,
      );
    }
    void invalidateSynchronizedLibraryQueries(
      queryClient,
      result.updatedLibraryIds ?? [],
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentState(sourceDocumentId) });
    return result;
  }, [isDerivedScript, libraryId, projectId, queryClient, sourceDocumentId, sourceToken, supabase]);

  const insertSourceTextForDraft = useCallback(async (
    block: ScriptDialogueBlock,
    values: { action: string; dialogue: string },
  ) => {
    const index = allDialogueBlocks.findIndex((candidate) => candidate.id === block.id);
    if (index < 0 && allDialogueBlocks.length > 0) {
      throw new Error('Dialogue block is not available for source insertion');
    }
    const previousText = index > 0
      ? sourceTextForDialogueBlock(allDialogueBlocks[index - 1], 'last')
      : '';
    const nextText = index >= 0 && index < allDialogueBlocks.length - 1
      ? sourceTextForDialogueBlock(allDialogueBlocks[index + 1], 'first')
      : '';
    const action = values.action.trim();
    const dialogue = values.dialogue.trim();
    const commandText = action
      ? `${block.speaker.trim()}（${action}）：${dialogue}`
      : `${block.speaker.trim()}：${dialogue}`;
    if (previousText) {
      await syncSource({
        type: 'insert',
        blockId: block.id,
        text: commandText,
        afterText: previousText,
        ...(nextText ? { beforeText: nextText } : {}),
      });
      return;
    }
    if (nextText) {
      await syncSource({
        type: 'insert',
        blockId: block.id,
        text: commandText,
        beforeText: nextText,
      });
      return;
    }
    await syncSource({
      type: 'insert',
      blockId: block.id,
      text: commandText,
    });
  }, [allDialogueBlocks, syncSource]);

  const insertAfterBlock = useCallback(async (blockId: string | null, speaker: string) => {
    if (!supabase || !fields || busyRef.current) return false;
    busyRef.current = true;
    try {
      const block = blockId ? allDialogueBlocks.find((item) => item.id === blockId) : null;
      const afterRowId = block
        ? (block.speechRowId ?? block.actionRowId ?? null)
        : (selectedRows[selectedRows.length - 1]?.id ?? null);

      const speechType = resolveSpeechTypeForSpeaker(speaker, rows, fields);
      let inserted;
      let usedLegacyMutation = false;
      try {
        inserted = await insertScriptDialogueBlock({
          supabase,
          libraryId,
          afterRowId,
          speaker,
          speechType,
          fields,
        });
        queryClient.setQueryData<AssetRow[]>(
          queryKeys.libraryAssets(libraryId),
          (current = rows) => applyInsertedDialogueRows(current, inserted),
        );
      } catch (error) {
        if (!isMissingScriptDialogueRpcError(error)) throw error;
        usedLegacyMutation = true;
        inserted = await insertDialogueThreadAfter({
          supabase,
          libraryId,
          rows,
          fields,
          afterRowId,
          speaker,
        });
      }
      pushHistory({
        type: 'insert',
        actionRowId: inserted.actionRowId,
        speechRowId: inserted.speechRowId,
        afterRowId,
        speaker,
      });
      setEditingBlockId(inserted.speechRowId);
      if (usedLegacyMutation) await refresh();
      else void refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to add dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [allDialogueBlocks, fields, libraryId, pushHistory, queryClient, refresh, rows, selectedRows, supabase]);

  const saveBlock = useCallback(async (
    blockId: string,
    values: { action: string; dialogue: string },
  ) => {
    if (!supabase || !fields || busyRef.current) return false;
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return false;
    const actionChanged = values.action !== block.action;
    const dialogueChanged = values.dialogue !== block.dialogue;
    if (!actionChanged && !dialogueChanged) return true;

    busyRef.current = true;
    try {
      const writeSource = async () => {
        if (!isDerivedScript) return;
        if (block.action.trim() || block.dialogue.trim()) {
          await syncSource({
            type: 'edit',
            blockId: block.id,
            role: 'action',
            previousText: block.action,
            previousDialogue: block.dialogue,
            nextText: values.action,
            speaker: block.speaker,
            dialogue: values.dialogue,
          });
        } else if (values.action.trim() || values.dialogue.trim()) {
          await insertSourceTextForDraft(block, values);
        }
      };
      const {
        workingRows,
        actionRowId,
        speechRowId,
        completedUpdates,
      } = await persistSourceBeforeDialogueRows(
        writeSource,
        async () => {
          let nextRows = queryClient.getQueryData<AssetRow[]>(
            queryKeys.libraryAssets(libraryId),
          ) ?? rows;
          let nextActionRowId = block.actionRowId;
          let nextSpeechRowId = block.speechRowId;
          if (actionChanged && values.action.trim() && !nextActionRowId) {
            const ensured = await ensureActionRowForBlock({
              supabase,
              libraryId,
              rows: nextRows,
              fields,
              block,
            });
            nextActionRowId = ensured.actionRowId;
            await refresh();
            nextRows = queryClient.getQueryData<AssetRow[]>(
              queryKeys.libraryAssets(libraryId),
            ) ?? nextRows;
          }
          if (dialogueChanged && values.dialogue.trim() && !nextSpeechRowId) {
            const ensured = await ensureSpeechRowForBlock({
              supabase,
              libraryId,
              rows: nextRows,
              fields,
              block: { ...block, actionRowId: nextActionRowId },
            });
            nextSpeechRowId = ensured.speechRowId;
            await refresh();
            nextRows = queryClient.getQueryData<AssetRow[]>(
              queryKeys.libraryAssets(libraryId),
            ) ?? nextRows;
          }

          const actionRow = nextActionRowId
            ? nextRows.find((row) => row.id === nextActionRowId)
            : undefined;
          const speechRow = nextSpeechRowId
            ? nextRows.find((row) => row.id === nextSpeechRowId)
            : undefined;
          if (actionChanged && nextActionRowId && !actionRow) {
            throw new Error('Action row missing after ensure');
          }
          if (dialogueChanged && nextSpeechRowId && !speechRow) {
            throw new Error('Speech row missing after ensure');
          }

          const rowUpdates = [
            ...(actionChanged && actionRow
              ? [{ row: actionRow, content: values.action }]
              : []),
            ...(dialogueChanged && speechRow
              ? [{ row: speechRow, content: values.dialogue }]
              : []),
          ];
          return {
            workingRows: nextRows,
            actionRowId: nextActionRowId,
            speechRowId: nextSpeechRowId,
            completedUpdates: await updateDialogueRowsContent({
              supabase,
              contentKey: fields.contentKey,
              updates: rowUpdates,
            }),
          };
        },
      );

      queryClient.setQueryData<AssetRow[]>(
        queryKeys.libraryAssets(libraryId),
        (current = workingRows) => completedUpdates.reduce(
          (nextRows, update) => applySavedDialogueContent(
            nextRows,
            update.row.id,
            fields.contentKey,
            update.newContent,
          ),
          current,
        ),
      );
      for (const update of completedUpdates) {
        pushHistory({
          type: 'update',
          rowId: update.row.id,
          contentKey: fields.contentKey,
          oldContent: update.oldContent,
          newContent: update.newContent,
          rowName: update.row.name,
          propertyValues: { ...update.row.propertyValues },
        });
      }
      if (speechRowId && speechRowId !== blockId) setEditingBlockId(speechRowId);
      void refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to save dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, fields, insertSourceTextForDraft, isDerivedScript, libraryId, pushHistory, queryClient, refresh, rows, supabase, syncSource]);

  const deleteBlock = useCallback(async (blockId: string) => {
    if (!supabase || !fields || busyRef.current) return false;
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return false;
    busyRef.current = true;
    try {
      const currentRows = queryClient.getQueryData<AssetRow[]>(
        queryKeys.libraryAssets(libraryId),
      ) ?? rows;
      const snapshot = createDeletedDialogueSnapshot(currentRows, block);
      if (isDerivedScript) {
        const previousTexts = block.speechType === '3'
          ? [sourceTextForDialogueBlock(block, 'last')].filter(Boolean)
          : [block.action, block.dialogue && `${block.speaker}：${block.dialogue}`].filter(Boolean);
        if (previousTexts.length > 0) {
          await syncSource({ type: 'delete', blockId: block.id, previousTexts });
        }
      }
      let deletedIds: string[];
      let usedLegacyMutation = false;
      try {
        deletedIds = await deleteScriptDialogueBlock({
          supabase,
          libraryId,
          actionRowId: block.actionRowId,
          speechRowId: block.speechRowId,
        });
      } catch (error) {
        if (!isMissingScriptDialogueRpcError(error)) throw error;
        usedLegacyMutation = true;
        await deleteDialogueBlock({ supabase, rows: currentRows, block });
        deletedIds = snapshot.rows.map((row) => row.id);
      }
      queryClient.setQueryData<AssetRow[]>(
        queryKeys.libraryAssets(libraryId),
        (current = currentRows) => removeDeletedDialogueRows(current, deletedIds),
      );
      pushHistory({ type: 'delete', snapshot });
      if (editingBlockId === blockId) setEditingBlockId(null);
      if (usedLegacyMutation) await refresh();
      else void refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to delete dialogue');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, editingBlockId, fields, isDerivedScript, libraryId, pushHistory, queryClient, refresh, rows, supabase, syncSource]);

  const changeBlockSpeaker = useCallback(async (blockId: string, speaker: string) => {
    if (!supabase || !fields || busyRef.current) return false;
    const block = blocks.find((item) => item.id === blockId);
    const character = characters.find((item) => item.name === speaker);
    if (!block || !character) return false;
    if (block.speaker === speaker) return true;

    busyRef.current = true;
    try {
      if (isDerivedScript && block.dialogue) {
        await syncSource({
          type: 'edit',
          blockId: block.id,
          role: 'speech',
          previousText: `${block.speaker}：${block.dialogue}`,
          nextText: `${speaker}：${block.dialogue}`,
        });
      }
      const updates = await updateDialogueBlockSpeaker({
        supabase,
        rows,
        fields,
        block,
        speaker,
        speechType: character.speechType === '1' ? '1' : '2',
      });
      pushHistory({ type: 'speaker', updates });
      await refresh();
      return true;
    } catch (error) {
      console.error(error);
      showErrorToast('Failed to change character');
      await refresh();
      return false;
    } finally {
      busyRef.current = false;
    }
  }, [blocks, characters, fields, isDerivedScript, pushHistory, refresh, rows, supabase, syncSource]);

  const reorderBlock = useCallback(async (fromIndex: number, toIndex: number) => {
    if (!supabase || !fields || busyRef.current) return false;
    busyRef.current = true;
    try {
      const synchronizedPlan = planSynchronizedDialogueReorder({
        blocks,
        rows,
        fromIndex,
        toIndex,
      });
      if (!synchronizedPlan) return true;
      if (isDerivedScript) {
        await syncSource(synchronizedPlan.command);
        queryClient.setQueryData<AssetRow[]>(
          queryKeys.libraryAssets(libraryId),
          (current = rows) => applySynchronizedDialogueOrder(
            current,
            synchronizedPlan.nextOrderIds,
          ),
        );
        pushHistory({
          type: 'reorder',
          previousOrderIds: synchronizedPlan.previousOrderIds,
          nextOrderIds: synchronizedPlan.nextOrderIds,
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.library(libraryId) });
        void refresh();
        return true;
      }
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
  }, [blocks, fields, isDerivedScript, libraryId, pushHistory, queryClient, refresh, rows, supabase, syncSource]);

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
      } else if (entry.type === 'speaker') {
        const { updateAsset } = await import('@/lib/services/libraryAssetsService');
        await Promise.all(entry.updates.map((update) => updateAsset(
          supabase,
          update.rowId,
          update.oldName,
          update.oldPropertyValues,
        )));
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
      } else if (entry.type === 'speaker') {
        const { updateAsset } = await import('@/lib/services/libraryAssetsService');
        await Promise.all(entry.updates.map((update) => updateAsset(
          supabase,
          update.rowId,
          update.newName,
          update.newPropertyValues,
        )));
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
  const queuedSaveBlock = useCallback(
    (blockId: string, values: { action: string; dialogue: string }) => enqueueCommand(
      () => saveBlock(blockId, values),
    ),
    [enqueueCommand, saveBlock],
  );
  const queuedDeleteBlock = useCallback(
    (blockId: string) => enqueueCommand(() => deleteBlock(blockId)),
    [deleteBlock, enqueueCommand],
  );
  const queuedChangeBlockSpeaker = useCallback(
    (blockId: string, speaker: string) => enqueueCommand(
      () => changeBlockSpeaker(blockId, speaker),
    ),
    [changeBlockSpeaker, enqueueCommand],
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
    changeBlockSpeaker: queuedChangeBlockSpeaker,
    saveBlock: queuedSaveBlock,
    deleteBlock: queuedDeleteBlock,
    reorderBlock: queuedReorderBlock,
    undo: queuedUndo,
    redo: queuedRedo,
  };
}
