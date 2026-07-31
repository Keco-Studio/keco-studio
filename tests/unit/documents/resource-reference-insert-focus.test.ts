import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
} from 'lexical';
import {
  confirmResourceReferenceSelection,
  type RestoreEditorFocus,
} from '@/components/documents/resourceReferencePickerConfirm';
import {
  captureRangeSelection,
  restoreRangeSelection,
} from '@/components/documents/resourceReferenceSelection';
import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

const TABLE_TARGET: ResourceReferenceTarget = {
  kind: 'table-row',
  libraryId: '11111111-1111-4111-8111-111111111111',
  assetId: '22222222-2222-4222-8222-222222222222',
  displayFieldId: '33333333-3333-4333-8333-333333333333',
  fallbackLabel: 'Ada',
};

const SECOND_TARGET: ResourceReferenceTarget = {
  ...TABLE_TARGET,
  assetId: '33333333-3333-4333-8333-333333333333',
  fallbackLabel: 'Byron',
};

describe('resource reference insert at cursor', () => {
  it('restores editor focus before applying insertion', () => {
    const order: string[] = [];
    const apply = jest.fn(() => order.push('apply'));
    const restoreFocus: RestoreEditorFocus = (after) => {
      order.push('focus');
      after?.();
    };

    confirmResourceReferenceSelection(
      { apply },
      [TABLE_TARGET],
      restoreFocus
    );

    expect(order).toEqual(['focus', 'apply']);
    expect(apply).toHaveBeenCalledWith([TABLE_TARGET]);
  });

  it('applies multiple targets after a single focus restore', () => {
    const order: string[] = [];
    const apply = jest.fn(() => order.push('apply'));
    const restoreFocus: RestoreEditorFocus = (after) => {
      order.push('focus');
      after?.();
    };

    confirmResourceReferenceSelection(
      { apply },
      [TABLE_TARGET, SECOND_TARGET],
      restoreFocus
    );

    expect(order).toEqual(['focus', 'apply']);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toHaveLength(2);
  });

  it('wires restoreEditorFocus to insert only after Lexical focus callback', () => {
    const editor = readFileSync(
      join(process.cwd(), 'src/components/documents/MdxDocumentEditor.tsx'),
      'utf8'
    );
    expect(editor).toMatch(
      /const restoreEditorFocus = useCallback\(\(after\?: \(\) => void\) => \{/
    );
    expect(editor).toMatch(/editor\.focus\(\(\) => \{[\s\S]*?after\?\.\(\)/);
  });

  it('captures the caret and restores it after the selection is cleared', () => {
    const editor = createEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Hello world');
        paragraph.append(text);
        $getRoot().clear();
        $getRoot().append(paragraph);
        text.select(6, 6);
      },
      { discrete: true }
    );

    const snapshot = captureRangeSelection(editor);
    expect(snapshot).toEqual({
      anchor: expect.objectContaining({ offset: 6, type: 'text' }),
      focus: expect.objectContaining({ offset: 6, type: 'text' }),
    });

    editor.update(
      () => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.anchor.set(selection.anchor.key, 0, selection.anchor.type);
          selection.focus.set(selection.focus.key, 0, selection.focus.type);
        }
      },
      { discrete: true }
    );

    restoreRangeSelection(editor, snapshot);

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if ($isRangeSelection(selection)) {
        expect(selection.anchor.offset).toBe(6);
        expect(selection.focus.offset).toBe(6);
      }
    });
  });

  it('wires the insert button to restore selection once then insert each target', () => {
    const button = readFileSync(
      join(process.cwd(), 'src/components/documents/ResourceReferenceInsertButton.tsx'),
      'utf8'
    );
    expect(button).toContain('captureRangeSelection(activeEditor)');
    expect(button).toContain('restoreRangeSelection(activeEditor, selection)');
    expect(button).toContain('targets.forEach');
    expect(button).toContain("current.insertText(' ')");
    expect(button).toContain('insertJsx({');
  });
});
