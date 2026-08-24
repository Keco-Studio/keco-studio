import { useEffect, useRef } from 'react';
import {
  addComposerChild$,
  contentEditableWrapperElement$,
  realmPlugin,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import {
  applyTableCellRangeHighlight,
  clearTableCellRangeHighlights,
  getTableContentCellCoordinate,
  isDocumentTableContentCell,
  normalizeTableCellRange,
  type TableContentCellCoordinate,
} from '@/lib/documents/documentTableCellSelection';
import {
  documentTableSelection$,
  type DocumentTableSelection,
} from '@/lib/documents/documentTableSelectionState';

const DRAG_THRESHOLD_PX = 4;

function publishSelection(
  publish: (value: DocumentTableSelection | null) => void,
  table: HTMLTableElement,
  range: DocumentTableSelection['range'],
): void {
  applyTableCellRangeHighlight(table, range);
  publish({ table, range });
}

function DocumentTableCellSelection() {
  const root = useCellValue(contentEditableWrapperElement$);
  const publish = usePublisher(documentTableSelection$);
  const selectionAnchorRef = useRef<TableContentCellCoordinate | null>(null);

  useEffect(() => {
    if (!root) return;

    let dragAnchor: TableContentCellCoordinate | null = null;
    let dragFocus: TableContentCellCoordinate | null = null;
    let isDragging = false;
    let suppressNextClick = false;
    let startX = 0;
    let startY = 0;

    const clearSelection = () => {
      clearTableCellRangeHighlights(root);
      publish(null);
      selectionAnchorRef.current = null;
    };

    const resolveCellAtPoint = (
      clientX: number,
      clientY: number,
    ): TableContentCellCoordinate | null => {
      const element = document.elementFromPoint(clientX, clientY);
      return getTableContentCellCoordinate(element);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;

      const coord = getTableContentCellCoordinate(event.target as Element);
      if (!coord) {
        if (!(event.target as Element).closest('table')) {
          clearSelection();
        }
        return;
      }

      if (event.shiftKey && selectionAnchorRef.current?.table === coord.table) {
        event.preventDefault();
        event.stopPropagation();
        const range = normalizeTableCellRange(selectionAnchorRef.current, coord);
        publishSelection(publish, coord.table, range);
        dragFocus = coord;
        return;
      }

      dragAnchor = coord;
      dragFocus = coord;
      isDragging = false;
      startX = event.clientX;
      startY = event.clientY;
      selectionAnchorRef.current = coord;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!dragAnchor) return;

        const deltaX = Math.abs(moveEvent.clientX - startX);
        const deltaY = Math.abs(moveEvent.clientY - startY);
        if (!isDragging && (deltaX > DRAG_THRESHOLD_PX || deltaY > DRAG_THRESHOLD_PX)) {
          isDragging = true;
          document.body.style.userSelect = 'none';
          (document.activeElement as HTMLElement | null)?.blur();
        }
        if (!isDragging) return;

        moveEvent.preventDefault();
        const current = resolveCellAtPoint(moveEvent.clientX, moveEvent.clientY);
        if (!current || current.table !== dragAnchor.table) return;

        dragFocus = current;
        const range = normalizeTableCellRange(dragAnchor, current);
        publishSelection(publish, dragAnchor.table, range);
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';

        if (isDragging && dragAnchor && dragFocus) {
          upEvent.preventDefault();
          upEvent.stopPropagation();
          suppressNextClick = true;
          const range = normalizeTableCellRange(dragAnchor, dragFocus);
          publishSelection(publish, dragAnchor.table, range);
        } else {
          clearSelection();
        }

        dragAnchor = null;
        dragFocus = null;
        isDragging = false;
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressNextClick) return;
      if (!isDocumentTableContentCell(event.target as Element)) return;
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = false;
    };

    root.addEventListener('mousedown', onMouseDown, true);
    root.addEventListener('click', onClick, true);
    return () => {
      root.removeEventListener('mousedown', onMouseDown, true);
      root.removeEventListener('click', onClick, true);
      document.body.style.userSelect = '';
      clearTableCellRangeHighlights(root);
    };
  }, [publish, root]);

  return null;
}

export const documentTableCellSelectionPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, DocumentTableCellSelection);
  },
});
