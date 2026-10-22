/** @jest-environment jsdom */

import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useTableOperationHistory } from '@/components/libraries/hooks/useTableOperationHistory';

describe('useTableOperationHistory', () => {
  it('moves an operation from undo to redo only after a successful undo', async () => {
    const undoOperation = jest.fn(async () => undefined);
    const redoOperation = jest.fn(async () => undefined);
    const { result } = renderHook(() => useTableOperationHistory({ undoOperation, redoOperation }));

    act(() => result.current.record('operation-1'));
    await act(async () => { await result.current.undo(); });

    expect(undoOperation).toHaveBeenCalledWith('operation-1');
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('clears redo after a new successful table mutation', async () => {
    const { result } = renderHook(() => useTableOperationHistory({
      undoOperation: async () => undefined,
      redoOperation: async () => undefined,
    }));

    act(() => result.current.record('operation-1'));
    await act(async () => { await result.current.undo(); });
    act(() => result.current.record('operation-2'));

    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('drops an operation that conflicts instead of retrying it against collaborator data', async () => {
    const undoOperation = jest.fn(async () => {
      const error = Object.assign(new Error('Table operation conflict'), { code: '40001' });
      throw error;
    });
    const { result } = renderHook(() => useTableOperationHistory({ undoOperation, redoOperation: async () => undefined }));

    act(() => result.current.record('operation-1'));
    await act(async () => {
      await expect(result.current.undo()).rejects.toMatchObject({ code: '40001' });
    });

    expect(result.current.canUndo).toBe(false);
  });
});
