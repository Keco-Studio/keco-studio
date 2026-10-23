/** @jest-environment jsdom */

import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('publishes scoped availability changes for the global library header', async () => {
    const states: Array<Record<string, unknown>> = [];
    const onState = (event: Event) => {
      states.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener('library-table-history-state', onState);
    const { result } = renderHook(() => useTableOperationHistory({
      undoOperation: async () => undefined,
      redoOperation: async () => undefined,
      channel: { projectId: 'project-1', libraryId: 'library-1', enabled: true },
    }));

    act(() => result.current.record('operation-1'));
    await act(async () => { await result.current.undo(); });

    expect(states).toContainEqual({
      projectId: 'project-1',
      libraryId: 'library-1',
      canUndo: true,
      canRedo: false,
    });
    expect(states.at(-1)).toEqual({
      projectId: 'project-1',
      libraryId: 'library-1',
      canUndo: false,
      canRedo: true,
    });
    window.removeEventListener('library-table-history-state', onState);
  });

  it('runs only commands addressed to its project and library', async () => {
    const undoOperation = jest.fn(async () => undefined);
    const { result } = renderHook(() => useTableOperationHistory({
      undoOperation,
      redoOperation: async () => undefined,
      channel: { projectId: 'project-1', libraryId: 'library-1', enabled: true },
    }));
    act(() => result.current.record('operation-1'));

    act(() => {
      window.dispatchEvent(new CustomEvent('library-table-history-command', {
        detail: { projectId: 'project-1', libraryId: 'library-2', action: 'undo' },
      }));
    });
    expect(undoOperation).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new CustomEvent('library-table-history-command', {
        detail: { projectId: 'project-1', libraryId: 'library-1', action: 'undo' },
      }));
    });
    await waitFor(() => expect(undoOperation).toHaveBeenCalledWith('operation-1'));
  });

  it('publishes disabled controls and ignores commands during version preview', () => {
    const undoOperation = jest.fn(async () => undefined);
    const states: Array<Record<string, unknown>> = [];
    const onState = (event: Event) => {
      states.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener('library-table-history-state', onState);
    const { result, rerender } = renderHook(
      ({ enabled }) => useTableOperationHistory({
        undoOperation,
        redoOperation: async () => undefined,
        channel: { projectId: 'project-1', libraryId: 'library-1', enabled },
      }),
      { initialProps: { enabled: true } },
    );
    act(() => result.current.record('operation-1'));

    rerender({ enabled: false });
    act(() => {
      window.dispatchEvent(new CustomEvent('library-table-history-command', {
        detail: { projectId: 'project-1', libraryId: 'library-1', action: 'undo' },
      }));
    });

    expect(states.at(-1)).toEqual({
      projectId: 'project-1',
      libraryId: 'library-1',
      canUndo: false,
      canRedo: false,
    });
    expect(undoOperation).not.toHaveBeenCalled();
    window.removeEventListener('library-table-history-state', onState);
  });
});
