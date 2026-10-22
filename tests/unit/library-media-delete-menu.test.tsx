/** @jest-environment jsdom */

import React from 'react';
import { expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { BatchEditMenu } from '@/components/libraries/components/BatchEditMenu';

it('labels the clear action as delete media for a selected media cell', () => {
  render(
    <BatchEditMenu
      visible
      position={{ x: 0, y: 0 }}
      userRole="editor"
      onCut={() => undefined}
      onCopy={() => undefined}
      onPaste={() => undefined}
      onInsertRowAbove={() => undefined}
      onInsertRowBelow={() => undefined}
      onClearContents={() => undefined}
      clearContentsLabel="Delete media"
      onDeleteRow={() => undefined}
    />,
  );

  expect(screen.getByText('Delete media')).toBeTruthy();
});
