'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '@/components/layout/ContextMenu.module.css';

export type ScriptContextMenuAction =
  | 'generate-conversation'
  | 'rename'
  | 'delete';

export type ScriptContextMenuType = 'document' | 'script';

type ScriptContextMenuProps = {
  x: number;
  y: number;
  type: ScriptContextMenuType;
  onClose: () => void;
  onAction?: (action: ScriptContextMenuAction) => void;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  elementRef?: HTMLElement | null;
};

export function ScriptContextMenu({
  x,
  y,
  type,
  onClose,
  onAction,
  userRole,
  elementRef,
}: ScriptContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const updatePosition = () => {
      if (elementRef && elementRef.isConnected) {
        const bounds = elementRef.getBoundingClientRect();
        const menuHeight = menuRef.current?.offsetHeight || 160;
        const menuWidth = menuRef.current?.offsetWidth || 180;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let newX = bounds.right + 8;
        if (newX + menuWidth > viewportWidth) {
          newX = Math.max(8, bounds.left - menuWidth - 8);
        }

        let newY = bounds.top;
        if (newY + menuHeight > viewportHeight) {
          newY = Math.max(8, bounds.bottom - menuHeight);
        }

        setPosition({ x: newX, y: newY });
      } else {
        setPosition({ x, y });
      }
    };

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(rafId);
  }, [x, y, elementRef]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
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

  const handleAction = (action: ScriptContextMenuAction) => {
    onAction?.(action);
    onClose();
  };

  const canRenameDocument = userRole === 'admin' || userRole === 'editor';
  const canGenerateConversation = userRole === 'admin' || userRole === 'editor';
  const canDeleteDocument = userRole === 'admin' || userRole === 'editor';
  const canRenameScript = userRole === 'admin';
  const canDeleteScript = userRole === 'admin';

  const renderMenuItems = () => {
    if (type === 'document') {
      return (
        <>
          {canGenerateConversation && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => handleAction('generate-conversation')}
            >
              Generate conversation
            </button>
          )}
          {canRenameDocument && (
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => handleAction('rename')}
            >
              Rename
            </button>
          )}
          {canDeleteDocument && (
            <>
              <div className={styles.separator} />
              <button
                type="button"
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

    // Script child: Rename / Delete only
    return (
      <>
        {canRenameScript && (
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => handleAction('rename')}
          >
            Rename
          </button>
        )}
        {canDeleteScript && (
          <>
            <div className={styles.separator} />
            <button
              type="button"
              className={`${styles.menuItem} ${styles.deleteItem}`}
              onClick={() => handleAction('delete')}
            >
              Delete
            </button>
          </>
        )}
      </>
    );
  };

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      role="menu"
    >
      {renderMenuItems()}
    </div>,
    document.body
  );
}
