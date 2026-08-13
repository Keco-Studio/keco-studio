export const DOCUMENT_CONTEXT_MENU_REQUEST_EVENT = 'studio-document-context-menu-request';

export type DocumentContextMenuRequestDetail = {
  documentId: string;
  x: number;
  y: number;
  elementRef: HTMLElement;
};

export function requestDocumentContextMenu(
  documentId: string,
  elementRef: HTMLElement
): void {
  const bounds = elementRef.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent<DocumentContextMenuRequestDetail>(DOCUMENT_CONTEXT_MENU_REQUEST_EVENT, {
      detail: {
        documentId,
        x: bounds.right,
        y: bounds.top,
        elementRef,
      },
    })
  );
}
