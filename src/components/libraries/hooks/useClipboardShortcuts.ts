import { useEffect } from 'react';

/**
 * useClipboardShortcuts - 全局 Ctrl/Cmd + X / C / V 监听，触发 Cut/Copy/Paste
 * 在编辑单元格、input/textarea/select、modal 内时不触发。
 */
export function useClipboardShortcuts({
  editingCell,
  selectedCells,
  selectedRowIds,
  clipboardData,
  onCut,
  onCopy,
  onPaste,
}: {
  editingCell: unknown;
  selectedCells: Set<unknown>;
  selectedRowIds: Set<string>;
  clipboardData: Array<Array<string | number | null>> | null;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
}) {
  useEffect(() => {
    const isMac =
      typeof navigator !== 'undefined' &&
      (('userAgentData' in navigator &&
        (navigator as any).userAgentData?.platform?.toLowerCase().includes('mac')) ||
        navigator.userAgent.toUpperCase().includes('MAC'));

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing = editingCell != null;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        !!target.isContentEditable ||
        !!target.closest('input') ||
        !!target.closest('textarea') ||
        !!target.closest('[contenteditable="true"]') ||
        !!target.closest('.ant-select') ||
        !!target.closest('.ant-input') ||
        !!target.closest('.ant-modal');

      if (isEditing || isInput) return;

      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedCells.size > 0 || selectedRowIds.size > 0) onCut();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        e.stopPropagation();
        if (selectedCells.size > 0 || selectedRowIds.size > 0) onCopy();
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        e.stopPropagation();
        if (clipboardData?.length && clipboardData[0]?.length) onPaste();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    editingCell,
    selectedCells,
    selectedRowIds,
    clipboardData,
    onCut,
    onCopy,
    onPaste,
  ]);
}
