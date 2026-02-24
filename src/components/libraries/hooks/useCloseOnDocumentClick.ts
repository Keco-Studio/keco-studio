import { useEffect } from 'react';


export function useCloseOnDocumentClick(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const handler = () => onClose();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [active, onClose]);
}
