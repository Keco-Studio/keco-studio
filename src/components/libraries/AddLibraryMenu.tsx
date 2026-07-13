'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './AddLibraryMenu.module.css';

type AddLibraryMenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  onClose: () => void;
  onCreateFolder?: () => void;
  onCreateLibrary?: () => void;
  onGenerateFromDocument?: () => void;
  onCreateDocument?: () => void;
};

export function AddLibraryMenu({
  open,
  anchorElement,
  onClose,
  onCreateFolder,
  onCreateLibrary,
  onGenerateFromDocument,
  onCreateDocument,
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

    const gap = 4;
    menuElement.style.position = 'fixed';
    menuElement.style.left = `${anchorRect.right + gap}px`;
    menuElement.style.top = `${anchorRect.top}px`;

    const menuRect = menuElement.getBoundingClientRect();
    if (menuRect.right > window.innerWidth) {
      menuElement.style.left = `${anchorRect.left - menuRect.width - gap}px`;
    }
    if (menuRect.bottom > window.innerHeight) {
      menuElement.style.top = `${window.innerHeight - menuRect.height - 8}px`;
    }
  }, [open, anchorElement]);

  if (!open || !mounted) return null;

  return createPortal(
    <div ref={menuRef} className={styles.menu}>
      {onCreateFolder && (
        <button className={styles.menuItem} onClick={onCreateFolder}>
          Create new folder
        </button>
      )}
      {onCreateLibrary && (
        <button className={styles.menuItem} onClick={onCreateLibrary}>
          Create new library
        </button>
      )}
      {onCreateDocument && (
        <button className={styles.menuItem} onClick={onCreateDocument}>
          Create new document
        </button>
      )}
      {onGenerateFromDocument && (
        <button className={styles.menuItem} onClick={onGenerateFromDocument}>
          Generate tables from document
        </button>
      )}
    </div>,
    document.body
  );
}
