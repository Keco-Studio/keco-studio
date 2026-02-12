'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  elementRef?: HTMLElement | null;
};

export function ContextMenu({ x, y, onClose, onAction, type, userRole, isProjectOwner, elementRef }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted before using portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Update position when element moves (e.g., on scroll)
  useEffect(() => {
    const updatePosition = () => {
      if (elementRef && elementRef.isConnected) {
        // Get current element bounds
        const bounds = elementRef.getBoundingClientRect();
        
        // Get menu dimensions (default to estimated size if not yet rendered)
        const menuHeight = menuRef.current?.offsetHeight || 300;
        const menuWidth = menuRef.current?.offsetWidth || 180;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        // Calculate horizontal position
        // Position menu at the right edge of the element with a gap
        let newX = bounds.right + 8;
        
        // Check if menu would go off-screen to the right
        if (newX + menuWidth > viewportWidth) {
          // Position menu to the left of the element instead
          newX = bounds.left - menuWidth - 8;
          
          // If still off-screen, position at the left edge of viewport
          if (newX < 0) {
            newX = 8;
          }
        }
        
        // Calculate vertical position
        // Default: align with top of element
        let newY = bounds.top;
        
        // Check if menu would go off-screen at the bottom
        if (newY + menuHeight > viewportHeight) {
          // Position menu to align with bottom of element (menu appears above)
          newY = bounds.bottom - menuHeight;
          
          // If still off-screen at the top, position at the top edge of viewport
          if (newY < 0) {
            newY = 8;
          }
        }
        
        setPosition({ x: newX, y: newY });
      } else {
        // Fallback to original x, y if element is not found
        setPosition({ x, y });
      }
    };

    // Initial position update
    updatePosition();
    
    // Re-calculate position after menu is rendered (to get accurate dimensions)
    const rafId2 = requestAnimationFrame(() => {
      updatePosition();
    });

    // Use requestAnimationFrame for smooth updates during scroll
    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          updatePosition();
          rafId = null;
        });
      }
    };

    // Listen to scroll events on window and all scrollable containers
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    
    // Listen to scroll on sidebar content container (the scrollable area)
    // Find the closest scrollable parent of the elementRef
    let scrollContainer: Element | null = null;
    if (elementRef) {
      let parent = elementRef.parentElement;
      while (parent) {
        const overflow = window.getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') {
          scrollContainer = parent;
          break;
        }
        parent = parent.parentElement;
      }
    }
    
    // If no scrollable parent found, try to find sidebar content
    if (!scrollContainer) {
      scrollContainer = document.querySelector('[class*="Sidebar_content"]');
    }
    
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, true);
    }

    // Use MutationObserver to detect when element moves in DOM
    let observer: MutationObserver | null = null;
    if (elementRef) {
      observer = new MutationObserver(() => {
        updatePosition();
      });
      // Observe the parent container for changes
      const parent = elementRef.parentElement;
      if (parent) {
        observer.observe(parent, { childList: true, subtree: true, attributes: true });
      }
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (rafId2 !== null) {
        cancelAnimationFrame(rafId2);
      }
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', handleScroll, true);
      }
      if (observer) {
        observer.disconnect();
      }
    };
  }, [elementRef, x, y]);

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

  // Don't render until mounted (to avoid SSR issues with portal)
  if (!mounted) {
    return null;
  }

  const menuContent = (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {renderMenuItems()}
    </div>
  );

  // Use portal to render menu at the body level, avoiding z-index and overflow issues
  return createPortal(menuContent, document.body);
}

