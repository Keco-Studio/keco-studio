import { useEffect, useLayoutEffect, useRef } from 'react';
import {
  $isTableNode,
  addComposerChild$,
  addTableCellEditorChild$,
  contentEditableWrapperElement$,
  realmPlugin,
  rootEditor$,
  useCellValue,
} from '@mdxeditor/editor';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COPY_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  findMdxEditorTableFromElement,
  isDocumentTableCopyContext,
  mdastTableToMatrix,
  resolveMatrixFromTableElement,
  writeDocumentTableClipboard,
  type DocumentTableMatrix,
} from '@/lib/documents/documentTableClipboard';
import {
  documentTableSelection$,
  type DocumentTableSelection,
} from '@/lib/documents/documentTableSelectionState';

function shouldCopyWholeTable(
  editor: LexicalEditor | null,
  event: ClipboardEvent | KeyboardEvent | null,
  hasCellRangeSelection: boolean,
): boolean {
  if (hasCellRangeSelection) return false;
  if (event && 'shiftKey' in event && event.shiftKey) return true;
  if (!editor) return true;

  return editor.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return true;
    if (selection.isCollapsed()) return true;
    return selection.getTextContent().length === 0;
  });
}

function resolveTargetTable(
  tableSelection: DocumentTableSelection | null,
  activeEditor: LexicalEditor | null,
): HTMLTableElement | null {
  if (tableSelection?.table.isConnected) return tableSelection.table;

  if (activeEditor) {
    const fromEditor = findMdxEditorTableFromElement(activeEditor.getRootElement());
    if (fromEditor) return fromEditor;
  }

  const active = document.activeElement;
  return active instanceof HTMLElement
    ? findMdxEditorTableFromElement(active)
    : null;
}

function resolveCopyMatrix(
  tableSelection: DocumentTableSelection | null,
  activeEditor: LexicalEditor | null,
  event: ClipboardEvent | KeyboardEvent | null,
): DocumentTableMatrix | null {
  const hasCellRangeSelection = Boolean(tableSelection?.table.isConnected);
  const targetTable = resolveTargetTable(tableSelection, activeEditor);
  if (!targetTable) return null;

  if (hasCellRangeSelection && tableSelection) {
    return resolveMatrixFromTableElement(targetTable, tableSelection.range);
  }

  if (!shouldCopyWholeTable(activeEditor, event, false)) return null;

  if (activeEditor) {
    let matrixFromNodeSelection: DocumentTableMatrix | null = null;
    activeEditor.read(() => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return;
      for (const node of selection.getNodes()) {
        if ($isTableNode(node)) {
          matrixFromNodeSelection = mdastTableToMatrix(node.getMdastNode());
          return;
        }
      }
    });
    if (matrixFromNodeSelection && matrixFromNodeSelection.length > 0) {
      return matrixFromNodeSelection;
    }
  }

  return resolveMatrixFromTableElement(targetTable);
}

function useTableSelectionRef() {
  const tableSelection = useCellValue(documentTableSelection$);
  const tableSelectionRef = useRef<DocumentTableSelection | null>(null);

  useLayoutEffect(() => {
    tableSelectionRef.current = tableSelection;
  }, [tableSelection]);

  return tableSelectionRef;
}

function DocumentTableCopy() {
  const [editor] = useLexicalComposerContext();
  const rootEditor = useCellValue(rootEditor$);
  const tableSelectionRef = useTableSelectionRef();

  useEffect(() => {
    return editor.registerCommand(
      COPY_COMMAND,
      (event) => {
        const matrix = resolveCopyMatrix(
          tableSelectionRef.current,
          editor,
          event,
        );
        if (!matrix) return false;
        return writeDocumentTableClipboard(event, matrix);
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, rootEditor, tableSelectionRef]);

  return null;
}

function DocumentTableCopyListener() {
  const editorRoot = useCellValue(contentEditableWrapperElement$);
  const rootEditor = useCellValue(rootEditor$);
  const tableSelectionRef = useTableSelectionRef();

  useEffect(() => {
    if (!editorRoot || !rootEditor) return;

    const onCopy = (event: ClipboardEvent) => {
      if (!isDocumentTableCopyContext(editorRoot, tableSelectionRef.current)) {
        return;
      }

      const matrix = resolveCopyMatrix(
        tableSelectionRef.current,
        null,
        event,
      );
      if (!matrix) return;
      if (!writeDocumentTableClipboard(event, matrix)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    document.addEventListener('copy', onCopy, true);
    return () => document.removeEventListener('copy', onCopy, true);
  }, [editorRoot, rootEditor, tableSelectionRef]);

  return null;
}

export const documentTableCopyPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addComposerChild$]: [DocumentTableCopy, DocumentTableCopyListener],
      [addTableCellEditorChild$]: DocumentTableCopy,
    });
  },
});
