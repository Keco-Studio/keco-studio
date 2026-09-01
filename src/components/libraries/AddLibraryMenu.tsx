'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import tableIcon from '@/assets/images/table.svg';
import paperIcon from '@/assets/images/paper.svg';
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
  onDelete?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
};

function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className={styles.menuIconSvg}>
      <path
        d="M2.5 10.5V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V10.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M8 2.5V10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M5 7.5L8 10.5L11 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

    let left = anchorRect.right - menuElement.offsetWidth;
    if (left < 8) left = 8;
    if (left + menuElement.offsetWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - menuElement.offsetWidth - 8);
    }

    let top = anchorRect.bottom + gap;
    if (top + menuElement.offsetHeight > window.innerHeight) {
      top = anchorRect.top - menuElement.offsetHeight - gap;
    }
    if (top < 8) top = 8;

    menuElement.style.left = `${left}px`;
    menuElement.style.top = `${top}px`;
  }, [open, anchorElement]);

  if (!open) return null;

  const hasDestructiveActions = Boolean(onRename || onDuplicate || onDelete);

  const menuContent = (
    <div ref={menuRef} className={styles.menu} role="menu">
      {onCreateFolder && (
        <button type="button" className={styles.menuItem} onClick={onCreateFolder} role="menuitem">
          <Image src={FolderCloseIcon} alt="" width={16} height={16} className={styles.menuIcon} />
          <span>Create new folder</span>
        </button>
      )}
      {onCreateTable && (
        <button type="button" className={styles.menuItem} onClick={onCreateTable} role="menuitem">
          <Image src={tableIcon} alt="" width={16} height={16} className={styles.menuIcon} />
          <span>Create new table</span>
        </button>
      )}
      {onCreateDocument && (
        <button type="button" className={styles.menuItem} onClick={onCreateDocument} role="menuitem">
          <Image src={paperIcon} alt="" width={16} height={16} className={styles.menuIcon} />
          <span>Create new document</span>
        </button>
      )}
      {onImportTable && (
        <button type="button" className={styles.menuItem} onClick={onImportTable} role="menuitem">
          <ImportIcon />
          <span>Import new table</span>
        </button>
      )}
      {onImportDocument && (
        <button type="button" className={styles.menuItem} onClick={onImportDocument} role="menuitem">
          <ImportIcon />
          <span>Import new document</span>
        </button>
      )}
      {hasDestructiveActions && <div className={styles.divider} />}
      {onRename && (
        <button type="button" className={styles.menuItem} onClick={onRename} role="menuitem">
          Rename
        </button>
      )}
      {onDuplicate && (
        <button type="button" className={styles.menuItem} onClick={onDuplicate} role="menuitem">
          Duplicate
        </button>
      )}
      {onDelete && (
        <button type="button" className={`${styles.menuItem} ${styles.deleteItem}`} onClick={onDelete} role="menuitem">
          Delete
        </button>
      )}
    </div>
  );

  if (!mounted || typeof document === 'undefined') return menuContent;

  return createPortal(menuContent, document.body);
}
