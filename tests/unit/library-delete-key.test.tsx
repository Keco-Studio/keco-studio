/** @jest-environment jsdom */

import React, { useState } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react';
import { useClipboardShortcuts } from '@/components/libraries/hooks/useClipboardShortcuts';

describe.each(['Delete', 'Backspace'])('%s key', (key) => {
it('clears the selected cell', () => {
  const onClearContents = jest.fn();

  function Harness() {
    const [selectedCells] = useState(new Set(['row-1-media']));
    useClipboardShortcuts({
      editingCell: null,
      selectedCells,
      selectedRowIds: new Set(),
      onCut: () => undefined,
      onCopy: () => undefined,
      onPaste: () => undefined,
      onClearContents,
    });
    return <div data-testid="table-cell" />;
  }

  const { getByTestId } = render(<Harness />);
  fireEvent.keyDown(getByTestId('table-cell'), { key });

  expect(onClearContents).toHaveBeenCalledTimes(1);
});
});
