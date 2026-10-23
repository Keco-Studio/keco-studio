import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LIBRARY_TABLE_HISTORY_COMMAND_EVENT,
  LIBRARY_TABLE_HISTORY_STATE_EVENT,
  type LibraryTableHistoryCommandDetail,
  type LibraryTableHistoryStateDetail,
} from '../tableHistoryEvents';

type TableOperationHistoryChannel = {
  projectId: string;
  libraryId: string;
  enabled: boolean;
};

type TableOperationHistoryOptions = {
  undoOperation: (operationId: string) => Promise<unknown>;
  redoOperation: (operationId: string) => Promise<unknown>;
  channel?: TableOperationHistoryChannel;
};

function isConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === '40001';
}

export function useTableOperationHistory({ undoOperation, redoOperation, channel }: TableOperationHistoryOptions) {
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const pendingRef = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T,>(action: () => Promise<T>) => {
    const result = pendingRef.current.then(action, action);
    pendingRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const record = useCallback((operationId: string) => {
    undoStackRef.current = [...undoStackRef.current, operationId];
    redoStackRef.current = [];
    setUndoStack(undoStackRef.current);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => enqueue(async () => {
    const operationId = undoStackRef.current.at(-1);
    if (!operationId) return;
    try {
      await undoOperation(operationId);
    } catch (error) {
      if (isConflict(error)) {
        undoStackRef.current = undoStackRef.current.filter((id) => id !== operationId);
        setUndoStack(undoStackRef.current);
      }
      throw error;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, operationId];
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
  }), [enqueue, undoOperation]);

  const redo = useCallback(() => enqueue(async () => {
    const operationId = redoStackRef.current.at(-1);
    if (!operationId) return;
    try {
      await redoOperation(operationId);
    } catch (error) {
      if (isConflict(error)) {
        redoStackRef.current = redoStackRef.current.filter((id) => id !== operationId);
        setRedoStack(redoStackRef.current);
      }
      throw error;
    }
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, operationId];
    setRedoStack(redoStackRef.current);
    setUndoStack(undoStackRef.current);
  }), [enqueue, redoOperation]);

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const channelProjectId = channel?.projectId;
  const channelLibraryId = channel?.libraryId;
  const channelEnabled = channel?.enabled ?? false;

  useEffect(() => {
    if (!channelProjectId || !channelLibraryId) return;
    const detail: LibraryTableHistoryStateDetail = {
      projectId: channelProjectId,
      libraryId: channelLibraryId,
      canUndo: channelEnabled && canUndo,
      canRedo: channelEnabled && canRedo,
    };
    window.dispatchEvent(new CustomEvent(LIBRARY_TABLE_HISTORY_STATE_EVENT, { detail }));
  }, [canRedo, canUndo, channelEnabled, channelLibraryId, channelProjectId]);

  useEffect(() => {
    if (!channelEnabled || !channelProjectId || !channelLibraryId) return;

    const handleCommand = (event: Event) => {
      const detail = (event as CustomEvent<LibraryTableHistoryCommandDetail>).detail;
      if (detail?.projectId !== channelProjectId || detail?.libraryId !== channelLibraryId) return;
      if (detail.action === 'undo') {
        void undo();
      } else if (detail.action === 'redo') {
        void redo();
      }
    };

    window.addEventListener(LIBRARY_TABLE_HISTORY_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(LIBRARY_TABLE_HISTORY_COMMAND_EVENT, handleCommand);
  }, [channelEnabled, channelLibraryId, channelProjectId, redo, undo]);

  return {
    record,
    undo,
    redo,
    clear,
    canUndo,
    canRedo,
  };
}
