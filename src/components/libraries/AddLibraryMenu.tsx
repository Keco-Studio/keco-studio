'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './AddLibraryMenu.module.css';

type AddLibraryMenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  onClose: () => void;
  onCreateFolder?: () => void;
  onCreateTable?: () => void;
  onCreateDocument?: () => void;
  onImportDocument?: () => void;
  onImportTable?: () => void;
  // Folder-only optional destructive actions, wired up in a later task.
  onDelete?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
};

export function AddLibraryMenu({
  open,
  anchorElement,
  onClose,
  onCreateFolder,
  onCreateTable,
  onCreateDocument,
  onImportDocument,
  onImportTable,
  onDelete,
  onRename,
  onDuplicate,
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

  if (!open) return null;

  const hasDestructiveActions = Boolean(onRename || onDuplicate || onDelete);

  const menuContent = (
    <div ref={menuRef} className={styles.menu}>
      {onCreateFolder && (
        <button className={styles.menuItem} onClick={onCreateFolder}>
          Create new folder
        </button>
      )}
      {onCreateTable && (
        <button className={styles.menuItem} onClick={onCreateTable}>
          Create new table
        </button>
      )}
      {onCreateDocument && (
        <button className={styles.menuItem} onClick={onCreateDocument}>
          Create new document
        </button>
      )}
      {onImportDocument && (
        <button className={styles.menuItem} onClick={onImportDocument}>
          Import document
        </button>
      )}
      {onImportTable && (
        <button className={styles.menuItem} onClick={onImportTable}>
          Import table
        </button>
      )}
      {hasDestructiveActions && <div className={styles.divider} />}
      {onRename && (
        <button className={styles.menuItem} onClick={onRename}>
          Rename
        </button>
      )}
      {onDuplicate && (
        <button className={styles.menuItem} onClick={onDuplicate}>
          Duplicate
        </button>
      )}
      {onDelete && (
        <button className={`${styles.menuItem} ${styles.deleteItem}`} onClick={onDelete}>
          Delete
        </button>
      )}
    </div>
  );

  // Portals require `document`, which is unavailable during server rendering.
  // Fall back to rendering the menu inline until mounted client-side.
  if (!mounted || typeof document === 'undefined') return menuContent;

  return createPortal(menuContent, document.body);
}
