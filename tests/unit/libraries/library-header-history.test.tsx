/** @jest-environment jsdom */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LibraryHeader } from '@/components/libraries/LibraryHeader';

const UNDO_PATH = 'M7.202 18.5V17H14.3788C15.4224 17 16.3205 16.6554 17.073 15.9663C17.8257 15.2773 18.202 14.4263 18.202 13.4135C18.202 12.4007 17.8257 11.5512 17.073 10.8652C16.3205 10.1794 15.4224 9.8365 14.3788 9.8365H7.35775L10.1402 12.6193L9.0865 13.673L4.5 9.0865L9.0865 4.5L10.1402 5.55375L7.35775 8.3365H14.3788C15.8416 8.3365 17.0945 8.82467 18.1375 9.801C19.1805 10.7773 19.702 11.9815 19.702 13.4135C19.702 14.8455 19.1805 16.0513 18.1375 17.0308C17.0945 18.0103 15.8416 18.5 14.3788 18.5H7.202Z';
const REDO_PATH = 'M9.6211 18.5C8.15827 18.5 6.90535 18.0103 5.86235 17.0308C4.81935 16.0513 4.29785 14.8455 4.29785 13.4135C4.29785 11.9815 4.81935 10.7773 5.86235 9.801C6.90535 8.82467 8.15827 8.3365 9.6211 8.3365H16.6421L13.8596 5.55375L14.9134 4.5L19.4999 9.0865L14.9134 13.673L13.8596 12.6193L16.6421 9.8365H9.6211C8.57744 9.8365 7.67935 10.1794 6.92685 10.8652C6.17418 11.5512 5.79785 12.4007 5.79785 13.4135C5.79785 14.4263 6.17418 15.2773 6.92685 15.9663C7.67935 16.6554 8.57744 17 9.6211 17H16.7979V18.5H9.6211Z';

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}));

jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => ({ auth: { getSession: jest.fn() } }),
}));

jest.mock('@/lib/contexts/LibraryDataContext', () => ({
  useLibraryDataOptional: () => null,
}));

jest.mock('@/components/collaboration/InviteCollaboratorModal', () => ({
  InviteCollaboratorModal: () => null,
}));

describe('LibraryHeader table history controls', () => {
  function renderHeader() {
    render(
      <LibraryHeader
        libraryId="library-1"
        libraryName="Characters"
        projectId="project-1"
        currentUserId="user-1"
        userRole="editor"
        presenceUsers={[]}
      />
    );
  }

  it('places table undo and redo immediately after Share with the document toolbar icons', () => {
    renderHeader();

    const shareButton = screen.getByRole('button', { name: 'Share' });
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    const redoButton = screen.getByRole('button', { name: 'Redo' });
    const buttons = screen.getAllByRole('button');
    const shareIndex = buttons.indexOf(shareButton);

    expect(buttons[shareIndex + 1]).toBe(undoButton);
    expect(buttons[shareIndex + 2]).toBe(redoButton);
    expect(undoButton.querySelector('svg')).toMatchObject({
      attributes: expect.objectContaining({ width: expect.objectContaining({ value: '24' }) }),
    });
    expect(undoButton.querySelector('path')?.getAttribute('d')).toBe(UNDO_PATH);
    expect(redoButton.querySelector('path')?.getAttribute('d')).toBe(REDO_PATH);
  });

  it('enables controls from matching table state and dispatches scoped commands', () => {
    const commands: Array<Record<string, unknown>> = [];
    const onCommand = (event: Event) => {
      commands.push((event as CustomEvent<Record<string, unknown>>).detail);
    };
    window.addEventListener('library-table-history-command', onCommand);
    renderHeader();

    const undoButton = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redoButton = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent('library-table-history-state', {
        detail: {
          projectId: 'project-1',
          libraryId: 'another-library',
          canUndo: true,
          canRedo: true,
        },
      }));
    });
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent('library-table-history-state', {
        detail: {
          projectId: 'project-1',
          libraryId: 'library-1',
          canUndo: true,
          canRedo: true,
        },
      }));
    });
    expect(undoButton.disabled).toBe(false);
    expect(redoButton.disabled).toBe(false);

    fireEvent.click(undoButton);
    fireEvent.click(redoButton);

    expect(commands).toEqual([
      { projectId: 'project-1', libraryId: 'library-1', action: 'undo' },
      { projectId: 'project-1', libraryId: 'library-1', action: 'redo' },
    ]);

    window.removeEventListener('library-table-history-command', onCommand);
  });
});
