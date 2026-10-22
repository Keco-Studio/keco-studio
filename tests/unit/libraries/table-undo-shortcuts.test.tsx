/** @jest-environment jsdom */

import React, { useRef } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react';
import { useTableUndoShortcuts } from '@/components/libraries/hooks/useTableUndoShortcuts';

describe('useTableUndoShortcuts', () => {
  it('maps standard table shortcuts to undo and redo', () => {
    const undo = jest.fn();
    const redo = jest.fn();
    function Harness() {
      const rootRef = useRef<HTMLDivElement>(null);
      useTableUndoShortcuts({ rootRef, canUndo: true, canRedo: true, undo, redo });
      return <div ref={rootRef} tabIndex={0} data-testid="table-root" />;
    }
    const { getByTestId } = render(<Harness />);
    const table = getByTestId('table-root');
    table.focus();

    fireEvent.keyDown(table, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(table, { key: 'z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(table, { key: 'y', ctrlKey: true });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('does not take over native text editor undo', () => {
    const undo = jest.fn();
    function Harness() {
      const rootRef = useRef<HTMLDivElement>(null);
      useTableUndoShortcuts({ rootRef, canUndo: true, canRedo: false, undo, redo: jest.fn() });
      return <div ref={rootRef}><input aria-label="Cell editor" /></div>;
    }
    const { getByLabelText } = render(<Harness />);
    const input = getByLabelText('Cell editor');
    input.focus();

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

    expect(undo).not.toHaveBeenCalled();
  });
});
