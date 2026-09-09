/** @jest-environment jsdom */
import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CellEditor } from './CellEditor';

function renderEditor(save = jest.fn()) {
  const composing = { current: false };
  render(<CellEditor
    property={{ id: 'field-1', key: 'name', label: 'Name', dataType: 'string' } as never}
    editingCell={{ rowId: 'row-1', propertyKey: 'name' }}
    editingCellRef={createRef<HTMLSpanElement>()}
    initialValue="Original value"
    isComposingRef={composing}
    typeValidationError={null}
    typeValidationErrorRef={createRef<HTMLDivElement>()}
    setTypeValidationError={jest.fn()}
    handleSaveEditedCell={save}
    handleCancelEditing={jest.fn()}
    handleCellFocus={jest.fn()}
  />);
  return { editor: screen.getByText('Original value'), save };
}

describe('CellEditor translation isolation', () => {
  it('marks editable content as non-translatable', () => {
    const { editor } = renderEditor();
    expect(editor.getAttribute('translate')).toBe('no');
  });

  it('does not persist an external DOM mutation on blur', () => {
    const { editor, save } = renderEditor();
    editor.textContent = 'Externally replaced';
    fireEvent.blur(editor);
    expect(save).not.toHaveBeenCalled();
    expect(editor.textContent).toBe('Original value');
  });

  it('persists content produced by an input event', () => {
    const { editor, save } = renderEditor();
    editor.textContent = 'User edit';
    fireEvent.input(editor);
    fireEvent.blur(editor);
    expect(save).toHaveBeenCalledWith('User edit');
  });
});
