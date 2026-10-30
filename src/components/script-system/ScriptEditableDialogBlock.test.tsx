/** @jest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render as renderDom, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScriptDialogueBlock } from '@/lib/script-system/scriptDialogueBlocks';

jest.mock('../libraries/components/VisualNovelScriptView.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: undefined,
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
jest.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

import {
  commitDialogueDrafts,
  deleteDialogueBlockAndHide,
  isDialogueDraftEmpty,
  isDialogueEditorOutsidePointer,
  isDialogueSubmitShortcut,
  reconcileDialogueDrafts,
  ScriptEditableDialogBlock,
} from './ScriptEditableDialogBlock';

afterEach(cleanup);

const block: ScriptDialogueBlock = {
  id: 'speech',
  actionRowId: 'action',
  speechRowId: 'speech',
  rowIndexes: [1, 2],
  speaker: 'Hero',
  action: 'Raises the longsword',
  dialogue: 'Forward.',
  speechType: '2',
  accent: 'green',
  alignment: 'left',
};

function render(isEditing: boolean) {
  return renderToStaticMarkup(
    <ScriptEditableDialogBlock
      block={block}
      characters={[]}
      isEditing={isEditing}
      onBeginEdit={jest.fn()}
      onFinishEdit={jest.fn()}
      onInsertCharacter={jest.fn(async () => true)}
      onChangeSpeaker={jest.fn(async () => true)}
      onChangeSpeakerSide={jest.fn(async () => true)}
      onSaveBlock={jest.fn(async () => true)}
      onDelete={jest.fn(async () => true)}
    />,
  );
}

function renderBlock(overrides: Partial<ScriptDialogueBlock>, isEditing = false) {
  return renderToStaticMarkup(
    <ScriptEditableDialogBlock
      block={{ ...block, ...overrides }}
      characters={[]}
      isEditing={isEditing}
      onBeginEdit={jest.fn()}
      onFinishEdit={jest.fn()}
      onInsertCharacter={jest.fn(async () => true)}
      onChangeSpeaker={jest.fn(async () => true)}
      onChangeSpeakerSide={jest.fn(async () => true)}
      onSaveBlock={jest.fn(async () => true)}
      onDelete={jest.fn(async () => true)}
    />,
  );
}

describe('ScriptEditableDialogBlock', () => {
  it('commits the active draft once when the workspace requests a save', async () => {
    const onSaveBlock = jest.fn(async (
      _values: { action: string; dialogue: string },
    ) => true);
    const onSaveRequestComplete = jest.fn((_saved: boolean) => undefined);
    const props = {
      block,
      characters: [],
      isEditing: true,
      onBeginEdit: jest.fn(),
      onFinishEdit: jest.fn(),
      onInsertCharacter: jest.fn(async () => true),
      onChangeSpeaker: jest.fn(async () => true),
      onChangeSpeakerSide: jest.fn(async () => true),
      onSaveBlock,
      onDelete: jest.fn(async () => true),
      onSaveRequestComplete,
    };
    const view = renderDom(
      <ScriptEditableDialogBlock {...props} saveRequestVersion={0} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Dialogue' }), {
      target: { value: 'Wait by the door.' },
    });

    view.rerender(<ScriptEditableDialogBlock {...props} saveRequestVersion={1} />);

    await waitFor(() => {
      expect(onSaveBlock).toHaveBeenCalledTimes(1);
      expect(onSaveBlock).toHaveBeenCalledWith({
        action: 'Raises the longsword',
        dialogue: 'Wait by the door.',
      });
      expect(onSaveRequestComplete).toHaveBeenCalledWith(true);
    });

    view.rerender(<ScriptEditableDialogBlock {...props} saveRequestVersion={1} />);
    expect(onSaveBlock).toHaveBeenCalledTimes(1);
  });

  it('opens the character side menu on right-click and changes the speaker side', () => {
    const onChangeSpeakerSide = jest.fn(async (_speaker: string, _side: 'left' | 'right') => true);
    const props = {
      block,
      characters: [],
      isEditing: false,
      onBeginEdit: jest.fn(),
      onFinishEdit: jest.fn(),
      onInsertCharacter: jest.fn(async () => true),
      onChangeSpeaker: jest.fn(async () => true),
      onChangeSpeakerSide,
      onSaveBlock: jest.fn(async () => true),
      onDelete: jest.fn(async () => true),
    };

    renderDom(<ScriptEditableDialogBlock {...props} />);
    fireEvent.contextMenu(screen.getByText('Hero'), { clientX: 120, clientY: 80 });

    const menu = screen.getByRole('menu', { name: 'CHARACTER POSITION' });
    expect(menu.getAttribute('style')).toContain('left: 120px');
    expect(menu.getAttribute('style')).toContain('top: 80px');
    expect(screen.getByRole('menuitemradio', { name: 'Show on left' }).getAttribute('aria-checked'))
      .toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show on left' }));
    expect(onChangeSpeakerSide).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByText('Hero'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show on right' }));
    expect(onChangeSpeakerSide).toHaveBeenCalledWith('Hero', 'right');
  });

  it('supports keyboard navigation and restores focus after closing the side menu', () => {
    renderDom(
      <ScriptEditableDialogBlock
        block={block}
        characters={[]}
        isEditing={false}
        onBeginEdit={jest.fn()}
        onFinishEdit={jest.fn()}
        onInsertCharacter={jest.fn(async () => true)}
        onChangeSpeaker={jest.fn(async () => true)}
        onChangeSpeakerSide={jest.fn(async () => true)}
        onSaveBlock={jest.fn(async () => true)}
        onDelete={jest.fn(async () => true)}
      />,
    );
    const avatar = screen.getByRole('button', { name: 'Switch Hero character' });

    fireEvent.contextMenu(avatar, { clientX: 120, clientY: 80 });
    const left = screen.getByRole('menuitemradio', { name: 'Show on left' });
    const right = screen.getByRole('menuitemradio', { name: 'Show on right' });
    expect(document.activeElement).toBe(left);

    fireEvent.keyDown(left, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(right);
    fireEvent.keyDown(right, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(left);
    fireEvent.keyDown(left, { key: 'End' });
    expect(document.activeElement).toBe(right);
    fireEvent.keyDown(right, { key: 'Home' });
    expect(document.activeElement).toBe(left);

    fireEvent.keyDown(left, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'CHARACTER POSITION' })).toBeNull();
    expect(document.activeElement).toBe(avatar);
  });

  it('opens the character side menu with the keyboard context-menu shortcut', () => {
    renderDom(
      <ScriptEditableDialogBlock
        block={block}
        characters={[]}
        isEditing={false}
        onBeginEdit={jest.fn()}
        onFinishEdit={jest.fn()}
        onInsertCharacter={jest.fn(async () => true)}
        onChangeSpeaker={jest.fn(async () => true)}
        onChangeSpeakerSide={jest.fn(async () => true)}
        onSaveBlock={jest.fn(async () => true)}
        onDelete={jest.fn(async () => true)}
      />,
    );

    const avatar = screen.getByRole('button', { name: 'Switch Hero character' });
    fireEvent.keyDown(avatar, { key: 'F10', shiftKey: true });

    expect(screen.getByRole('menu', { name: 'CHARACTER POSITION' })).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Show on left' }));
  });

  it('commits changed action and dialogue drafts through one block save', async () => {
    const saveBlock = jest.fn(async (_values: { action: string; dialogue: string }) => true);

    await expect(commitDialogueDrafts({
      blockId: 'speech',
      sourceAction: 'old action',
      sourceDialogue: 'old dialogue',
      action: 'new action',
      dialogue: 'new dialogue',
    }, saveBlock)).resolves.toBe(true);

    expect(saveBlock).toHaveBeenCalledTimes(1);
    expect(saveBlock).toHaveBeenCalledWith({
      action: 'new action',
      dialogue: 'new dialogue',
    });
  });

  it('does not save an unchanged dialogue draft', async () => {
    const saveBlock = jest.fn(async (_values: { action: string; dialogue: string }) => true);

    await expect(commitDialogueDrafts({
      blockId: 'speech',
      sourceAction: 'same action',
      sourceDialogue: 'same dialogue',
      action: 'same action',
      dialogue: 'same dialogue',
    }, saveBlock)).resolves.toBe(true);

    expect(saveBlock).not.toHaveBeenCalled();
  });

  it('uses only the avatar, action, and dialogue as edit entry controls', () => {
    const markup = render(false);

    expect(markup.match(/aria-label="(?:Edit|Switch) [^"]+"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Switch Hero character"');
    expect(markup).toContain('aria-label="Edit action"');
    expect(markup).toContain('aria-label="Edit dialogue"');
  });

  it('reserves the same avatar column in view and edit states', () => {
    expect(render(false)).toContain('data-edit-controls');
    expect(render(true)).toContain('data-edit-controls');
    expect(render(false)).not.toContain('aria-label="Delete dialogue"');
    expect(render(true)).toContain('aria-label="Delete dialogue"');
  });

  it('uses a lifecycle-free native title for the hover-only drag control', () => {
    expect(render(true)).toContain('title="Drag to reorder"');
  });

  it('renders autosave inputs and a whole-block delete action', () => {
    const markup = render(true);

    expect(markup).toContain('aria-label="Action"');
    expect(markup).toContain('aria-label="Dialogue"');
    expect(markup).toContain('aria-label="Delete dialogue"');
  });

  it('deletes the whole block through the delete control', async () => {
    const onDelete = jest.fn(async () => true);
    renderToStaticMarkup(
      <ScriptEditableDialogBlock
        block={block}
        characters={[]}
        isEditing
        onBeginEdit={jest.fn()}
        onFinishEdit={jest.fn()}
        onInsertCharacter={jest.fn(async () => true)}
        onChangeSpeaker={jest.fn(async () => true)}
        onChangeSpeakerSide={jest.fn(async () => true)}
        onSaveBlock={jest.fn(async () => true)}
        onDelete={onDelete}
      />,
    );

    const deleted = await deleteDialogueBlockAndHide(onDelete, jest.fn());

    expect(deleted).toBe(true);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides the entire visual block only after deletion succeeds', async () => {
    const hide = jest.fn();

    await expect(deleteDialogueBlockAndHide(async () => true, hide)).resolves.toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);

    hide.mockClear();
    await expect(deleteDialogueBlockAndHide(async () => false, hide)).resolves.toBe(false);
    expect(hide).not.toHaveBeenCalled();
  });

  it('treats pointer targets outside root as outside clicks', () => {
    const root = { contains: jest.fn(() => false) };
    const outsideTarget = {} as Node;

    expect(isDialogueEditorOutsidePointer(root, outsideTarget)).toBe(true);
  });

  it('does not show add-field placeholders in the default state', () => {
    const markup = renderBlock({ action: '', dialogue: '' });

    expect(markup).not.toContain('Add action');
    expect(markup).not.toContain('Add dialogue');
    expect(markup).not.toContain('Switch Hero character');
  });

  it('keeps edit, delete, and input controls enabled', () => {
    const defaultMarkup = renderBlock({});
    const editingMarkup = renderBlock({}, true);

    expect(defaultMarkup).not.toMatch(/aria-label="Edit [^"]+"[^>]*disabled/);
    expect(editingMarkup).not.toMatch(/aria-label="Delete dialogue"[^>]*disabled/);
    expect(editingMarkup).not.toMatch(/aria-label="Action"[^>]*disabled/);
    expect(editingMarkup).not.toMatch(/aria-label="Dialogue"[^>]*disabled/);
  });

  it('submits dialogue only for Ctrl/Cmd + Enter', () => {
    expect(isDialogueSubmitShortcut({ key: 'Enter', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isDialogueSubmitShortcut({ key: 'Enter', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isDialogueSubmitShortcut({ key: 'Enter', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isDialogueSubmitShortcut({ key: 'a', ctrlKey: true, metaKey: false })).toBe(false);
  });

  it('treats whitespace-only action and dialogue as an empty block', () => {
    expect(isDialogueDraftEmpty({ action: '  ', dialogue: '\n' })).toBe(true);
    expect(isDialogueDraftEmpty({ action: 'moves', dialogue: '' })).toBe(false);
    expect(isDialogueDraftEmpty({ action: '', dialogue: 'hello' })).toBe(false);
  });

  it('accepts server updates without overwriting a dirty local draft', () => {
    expect(reconcileDialogueDrafts({
      blockId: 'speech',
      sourceAction: 'old action',
      sourceDialogue: 'old dialogue',
      action: 'local action',
      dialogue: 'old dialogue',
    }, {
      id: 'speech',
      action: 'server action',
      dialogue: 'server dialogue',
    })).toEqual({
      blockId: 'speech',
      sourceAction: 'server action',
      sourceDialogue: 'server dialogue',
      action: 'local action',
      dialogue: 'server dialogue',
    });
  });
});
