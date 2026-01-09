'use client';

import React, { useEffect, useRef } from 'react';
import styles from './ContextMenu.module.css';

export type ContextMenuAction = 
  | 'export'
  | 'version-history'
  | 'star'
  | 'rename'
  | 'collaborators'
  | 'duplicate'
  | 'move-to'
  | 'delete';

type ContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onAction?: (action: ContextMenuAction) => void;
  type?: 'project' | 'library' | 'folder' | 'asset';
};

export function ContextMenu({ x, y, onClose, onAction, type }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    // Add event listeners after a short delay to avoid immediate closing
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleAction = (action: ContextMenuAction) => {
    if (onAction) {
      onAction(action);
    }
    onClose();
  };

  // Render menu items based on type
  const renderMenuItems = () => {
    if (type === 'project') {
      // Project: Project info, Collaborators, Duplicate, separator, Delete
      return (
        <>
          <button
            className={styles.menuItem}
            onClick={() => handleAction('rename')}
          >
            Project info
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Collaborators
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Duplicate
          </button>
          <div className={styles.separator} />
          <button
            className={`${styles.menuItem} ${styles.deleteItem}`}
            onClick={() => handleAction('delete')}
          >
            Delete
          </button>
        </>
      );
    } else if (type === 'library') {
      // Library: Export, Version history, separator, Library info, Duplicate, Move to..., separator, Delete
      return (
        <>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Export
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Version history
          </button>
          <div className={styles.separator} />
          <button
            className={styles.menuItem}
            onClick={() => handleAction('rename')}
          >
            Library info
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Duplicate
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Move to...
          </button>
          <div className={styles.separator} />
          <button
            className={`${styles.menuItem} ${styles.deleteItem}`}
            onClick={() => handleAction('delete')}
          >
            Delete
          </button>
        </>
      );
    } else if (type === 'folder' || type === 'asset') {
      // Folder and Asset: Rename, Duplicate, separator, Delete
      return (
        <>
          <button
            className={styles.menuItem}
            onClick={() => handleAction('rename')}
          >
            Rename
          </button>
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Duplicate
          </button>
          <div className={styles.separator} />
          <button
            className={`${styles.menuItem} ${styles.deleteItem}`}
            onClick={() => handleAction('delete')}
          >
            Delete
          </button>
        </>
      );
    }
    
    // Default: Show all items (fallback)
    return (
      <>
        <button
          className={styles.menuItem}
          onClick={() => handleAction('export')}
        >
          Export
        </button>
        <button
          className={styles.menuItem}
          onClick={() => handleAction('version-history')}
        >
          Version history
        </button>
        <button
          className={styles.menuItem}
          onClick={() => handleAction('star')}
        >
          Star
        </button>
        <div className={styles.separator} />
        <button
          className={styles.menuItem}
          onClick={() => handleAction('rename')}
        >
          {type === 'project' ? 'Project info' : type === 'library' ? 'Library info' : 'Rename'}
        </button>
        <button
          className={styles.menuItem}
          onClick={() => handleAction('duplicate')}
        >
          Duplicate
        </button>
        <button
          className={styles.menuItem}
          onClick={() => handleAction('move-to')}
        >
          Move to...
        </button>
        <div className={styles.separator} />
        <button
          className={`${styles.menuItem} ${styles.deleteItem}`}
          onClick={() => handleAction('delete')}
        >
          Delete
        </button>
      </>
    );
  };

  return (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: `${x}px`,
        top: `${y}px`,
      }}
    >
      {renderMenuItems()}
    </div>
  );
}

