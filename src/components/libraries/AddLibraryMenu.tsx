'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './AddLibraryMenu.module.css';

type AddLibraryMenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateLibrary: () => void;
};

export function AddLibraryMenu({
  open,
  anchorElement,
  onClose,
  onCreateFolder,
  onCreateLibrary,
}: AddLibraryMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        anchorElement &&
        !anchorElement.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, anchorElement, onClose]);

  useEffect(() => {
    if (!open || !anchorElement || !menuRef.current) return;

    const anchorRect = anchorElement.getBoundingClientRect();
    const menuElement = menuRef.current;

    // Position menu to the right of the anchor, aligned to top
    // Add small gap (4px) between button and menu
    const gap = 4;
    menuElement.style.position = 'fixed';
    menuElement.style.left = `${anchorRect.right + gap}px`;
    menuElement.style.top = `${anchorRect.top}px`;
    
    // Ensure menu doesn't overflow viewport
    const menuRect = menuElement.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      // If menu would overflow, position it to the left of the button instead
      menuElement.style.left = `${anchorRect.left - menuRect.width - gap}px`;
    }
    if (menuRect.bottom > window.innerHeight) {
      // Adjust if menu would overflow bottom
      menuElement.style.top = `${window.innerHeight - menuRect.height - 8}px`;
    }
  }, [open, anchorElement]);

  if (!open || !mounted) return null;

  return createPortal(
    <div ref={menuRef} className={styles.menu}>
      <button className={styles.menuItem} onClick={onCreateFolder}>
        Create new folder
      </button>
      <button className={styles.menuItem} onClick={onCreateLibrary}>
        Create new library
      </button>
    </div>,
    document.body
  );
}

