import {
  $createRangeSelection,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
} from 'lexical';

export type RangeSelectionSnapshot = {
  anchor: { key: string; offset: number; type: 'text' | 'element' };
  focus: { key: string; offset: number; type: 'text' | 'element' };
};

/**
 * Capture the current Lexical range selection before a modal steals focus.
 * insertJsx$ falls back to rootEnd when no RangeSelection exists.
 */
export function captureRangeSelection(
  editor: LexicalEditor | null | undefined
): RangeSelectionSnapshot | null {
  if (!editor) return null;
  let snapshot: RangeSelectionSnapshot | null = null;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    snapshot = {
      anchor: {
        key: selection.anchor.key,
        offset: selection.anchor.offset,
        type: selection.anchor.type,
      },
      focus: {
        key: selection.focus.key,
        offset: selection.focus.offset,
        type: selection.focus.type,
      },
    };
  });
  return snapshot;
}

export function restoreRangeSelection(
  editor: LexicalEditor | null | undefined,
  snapshot: RangeSelectionSnapshot | null
): void {
  if (!editor || !snapshot) return;
  editor.update(
    () => {
      try {
        const selection = $createRangeSelection();
        selection.anchor.set(
          snapshot.anchor.key,
          snapshot.anchor.offset,
          snapshot.anchor.type
        );
        selection.focus.set(
          snapshot.focus.key,
          snapshot.focus.offset,
          snapshot.focus.type
        );
        $setSelection(selection);
      } catch {
        // Concurrent edits may invalidate keys; insertJsx$ will use its default.
      }
    },
    { discrete: true }
  );
}
