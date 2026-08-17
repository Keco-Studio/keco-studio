export const LIBRARY_CONTEXT_MENU_REQUEST_EVENT = 'studio-library-context-menu-request';

export type LibraryContextMenuRequestDetail = {
  libraryId: string;
  x: number;
  y: number;
  elementRef: HTMLElement;
};

export function requestLibraryContextMenu(
  libraryId: string,
  elementRef: HTMLElement
): void {
  const bounds = elementRef.getBoundingClientRect();
  window.dispatchEvent(
    new CustomEvent<LibraryContextMenuRequestDetail>(LIBRARY_CONTEXT_MENU_REQUEST_EVENT, {
      detail: {
        libraryId,
        x: bounds.right,
        y: bounds.top,
        elementRef,
      },
    })
  );
}
