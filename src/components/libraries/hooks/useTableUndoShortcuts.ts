import { useEffect } from 'react';

type TableUndoShortcutsOptions = {
  rootRef: React.RefObject<HTMLElement | null>;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void | Promise<unknown>;
  redo: () => void | Promise<unknown>;
};

function isNativeEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"]');
}

export function useTableUndoShortcuts({
  rootRef,
  canUndo,
  canRedo,
  undo,
  redo,
}: TableUndoShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isNativeEditor(event.target)) return;
      if (!rootRef.current?.contains(event.target as Node)) return;

      const key = event.key.toLowerCase();
      const shouldRedo = key === 'y' || (key === 'z' && event.shiftKey);
      const shouldUndo = key === 'z' && !event.shiftKey;
      if (shouldUndo && canUndo) {
        event.preventDefault();
        void undo();
      } else if (shouldRedo && canRedo) {
        event.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canRedo, canUndo, redo, rootRef, undo]);
}
