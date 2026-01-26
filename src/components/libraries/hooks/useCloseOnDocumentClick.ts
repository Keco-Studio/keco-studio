import { useEffect } from 'react';

/**
 * useCloseOnDocumentClick - 当 active 为 true 时监听 document click，触发即调用 onClose 并移除监听
 * 用于行右键菜单等「点击任意处关闭」场景。
 */
export function useCloseOnDocumentClick(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [active, onClose]);
}
