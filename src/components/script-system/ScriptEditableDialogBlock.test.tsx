import React from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ScriptDialogueBlock } from '@/lib/script-system/scriptDialogueBlocks';

jest.mock('../libraries/components/VisualNovelScriptView.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

jest.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
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
  deleteDialogueBlockAndHide,
  isDialogueDraftEmpty,
  isDialogueEditorOutsidePointer,
  isDialogueSubmitShortcut,
  reconcileDialogueDrafts,
  ScriptEditableDialogBlock,
} from './ScriptEditableDialogBlock';

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
      onSaveAction={jest.fn(async () => true)}
      onSaveDialogue={jest.fn(async () => true)}
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
      onSaveAction={jest.fn(async () => true)}
      onSaveDialogue={jest.fn(async () => true)}
      onDelete={jest.fn(async () => true)}
    />,
  );
}

describe('ScriptEditableDialogBlock', () => {
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
        onSaveAction={jest.fn(async () => true)}
        onSaveDialogue={jest.fn(async () => true)}
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
