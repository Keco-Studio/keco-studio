import { useEffect, useRef } from 'react';
import {
  addComposerChild$,
  addTableCellEditorChild$,
  NESTED_EDITOR_UPDATED_COMMAND,
  realmPlugin,
  rootEditor$,
  useCellValue,
} from '@mdxeditor/editor';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
} from 'lexical';
import { getTableContentCellCoordinate } from '@/lib/documents/documentTableCellSelection';
import {
  isTabularClipboardPayload,
  parseTsvMatrix,
} from '@/lib/documents/documentTableClipboard';
import {
  applyMatrixToTableNode,
  locateTableNodeFromTableElement,
} from '@/lib/documents/documentTablePaste';
import {
  documentTableSelection$,
  type DocumentTableSelection,
} from '@/lib/documents/documentTableSelectionState';

type PasteTarget = {
  table: HTMLTableElement;
  startRow: number;
  startCol: number;
};

function resolvePasteTarget(
  selection: DocumentTableSelection | null,
): PasteTarget | null {
  if (selection?.table.isConnected) {
    return {
      table: selection.table,
      startRow: selection.range.minRow,
      startCol: selection.range.minCol,
    };
  }

  const coord = getTableContentCellCoordinate(document.activeElement);
  if (!coord) return null;
  return {
    table: coord.table,
    startRow: coord.row,
    startCol: coord.col,
  };
}

function DocumentTablePaste() {
  const [editor] = useLexicalComposerContext();
  const rootEditor = useCellValue(rootEditor$);
  const tableSelection = useCellValue(documentTableSelection$);
  const tableSelectionRef = useRef<DocumentTableSelection | null>(null);

  useEffect(() => {
    tableSelectionRef.current = tableSelection;
  }, [tableSelection]);

  useEffect(() => {
    if (!rootEditor) return;

    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!('clipboardData' in event) || !event.clipboardData) return false;

        if (!isTabularClipboardPayload(event.clipboardData)) return false;

        const plainText = event.clipboardData.getData('text/plain');
        const matrix = parseTsvMatrix(plainText);
        if (matrix.length === 0) return false;

        const target = resolvePasteTarget(tableSelectionRef.current);
        if (!target) return false;

        let handled = false;
        rootEditor.update(() => {
          const tableNode = locateTableNodeFromTableElement(
            target.table,
            rootEditor,
          );
          if (!tableNode) return;
          applyMatrixToTableNode(
            tableNode,
            target.startRow,
            target.startCol,
            matrix,
          );
          handled = true;
        });

        if (!handled) return false;

        event.preventDefault();
        rootEditor.dispatchCommand(NESTED_EDITOR_UPDATED_COMMAND, undefined);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, rootEditor]);

  return null;
}

export const documentTablePastePlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addComposerChild$]: DocumentTablePaste,
      [addTableCellEditorChild$]: DocumentTablePaste,
    });
  },
});
