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
  | 'collaborators'
  | 'delete';

type ContextMenuProps = {
  x: number;
  y: number;
  type?: 'project' | 'library' | 'folder' | 'asset';
  onClose: () => void;
  onAction?: (action: ContextMenuAction) => void;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isProjectOwner?: boolean;
};

export function ContextMenu({ x, y, onClose, onAction, type, userRole, isProjectOwner }: ContextMenuProps) {
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

  // Check if user can delete based on type and role
  const canDelete = () => {
    if (type === 'project') {
      // Only admin can delete project
      return userRole === 'admin';
    } else if (type === 'library' || type === 'folder') {
      // Only admin can delete library or folder
      return userRole === 'admin';
    } else if (type === 'asset') {
      // Admin and editor can delete asset, viewer cannot
      return userRole === 'admin' || userRole === 'editor';
    }
    return false;
  };

  // Check if user can edit info/rename based on type and role
  const canEdit = () => {
    if (type === 'project' || type === 'library' || type === 'folder') {
      // Only admin can edit project info, library info, or folder name
      return userRole === 'admin';
    } else if (type === 'asset') {
      // Admin and editor can edit asset, viewer cannot
      return userRole === 'admin' || userRole === 'editor';
    }
    return false;
  };

  // Render menu items based on type
  const renderMenuItems = () => {
    const showDeleteButton = canDelete();
    const showEditButton = canEdit();
    
    if (type === 'project') {
      // Project: Project info (admin only), Collaborators, Duplicate, separator, Delete (admin only)
      return (
        <>
          {showEditButton && (
            <button
              className={styles.menuItem}
              onClick={() => handleAction('rename')}
            >
              Project info
            </button>
          )}
          <button
            className={styles.menuItem}
            onClick={() => handleAction('collaborators')}
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
          {showDeleteButton && (
            <>
              <div className={styles.separator} />
              <button
                className={`${styles.menuItem} ${styles.deleteItem}`}
                onClick={() => handleAction('delete')}
              >
                Delete
              </button>
            </>
          )}
        </>
      );
    } else if (type === 'library') {
      // Library: Export, Version history, separator, Library info (admin only), Duplicate, Move to..., separator, Delete (admin only)
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
          {showEditButton && (
            <>
              <div className={styles.separator} />
              <button
                className={styles.menuItem}
                onClick={() => handleAction('rename')}
              >
                Library info
              </button>
            </>
          )}
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
          {showDeleteButton && (
            <>
              <div className={styles.separator} />
              <button
                className={`${styles.menuItem} ${styles.deleteItem}`}
                onClick={() => handleAction('delete')}
              >
                Delete
              </button>
            </>
          )}
        </>
      );
    } else if (type === 'folder') {
      // Folder: Rename (admin only), Duplicate, separator, Delete (admin only)
      return (
        <>
          {showEditButton && (
            <button
              className={styles.menuItem}
              onClick={() => handleAction('rename')}
            >
              Rename
            </button>
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Duplicate
          </button>
          {showDeleteButton && (
            <>
              <div className={styles.separator} />
              <button
                className={`${styles.menuItem} ${styles.deleteItem}`}
                onClick={() => handleAction('delete')}
              >
                Delete
              </button>
            </>
          )}
        </>
      );
    } else if (type === 'asset') {
      // Asset: Rename (editor/admin), Duplicate, separator, Delete (editor/admin)
      return (
        <>
          {showEditButton && (
            <button
              className={styles.menuItem}
              onClick={() => handleAction('rename')}
            >
              Rename
            </button>
          )}
          <button
            className={styles.menuItem}
            onClick={() => {
              // Not implemented yet, just close menu
              onClose();
            }}
          >
            Duplicate
          </button>
          {showDeleteButton && (
            <>
              <div className={styles.separator} />
              <button
                className={`${styles.menuItem} ${styles.deleteItem}`}
                onClick={() => handleAction('delete')}
              >
                Delete
              </button>
            </>
          )}
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

