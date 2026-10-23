import { useCallback, useRef, useState } from 'react';

type TableOperationHistoryOptions = {
  undoOperation: (operationId: string) => Promise<unknown>;
  redoOperation: (operationId: string) => Promise<unknown>;
};

function isConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === '40001';
}

export function useTableOperationHistory({ undoOperation, redoOperation }: TableOperationHistoryOptions) {
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

  return {
    record,
    undo,
    redo,
    clear,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
