/**
 * Version Item Menu Component
 * 
 * Menu button with dropdown for version actions
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, message } from 'antd';
import Image from 'next/image';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { duplicateVersionAsLibrary } from '@/lib/services/versionService';
import { EditVersionModal } from './EditVersionModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import versionItemMenuIcon from '@/assets/images/VersionItemMenuIcon.svg';
import styles from './VersionItemMenu.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface VersionItemMenuProps {
  version: LibraryVersion;
  libraryId: string;
  externalMenuPosition?: { x: number; y: number } | null;
  onExternalMenuClose?: () => void;
  isSelected?: boolean;
  onVersionSelect?: (versionId: string | null) => void;
}

export function VersionItemMenu({ version, libraryId, externalMenuPosition, onExternalMenuClose, isSelected = false, onVersionSelect }: VersionItemMenuProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const externalMenuRef = useRef<HTMLDivElement>(null);

  // Show menu if external position is provided
  const isMenuVisible = showMenu || !!externalMenuPosition;

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateVersionAsLibrary(supabase, { versionId: version.id }),
    onSuccess: (data) => {
      // Invalidate folders-libraries query with projectId to refresh the left sidebar
      queryClient.invalidateQueries({ queryKey: ['folders-libraries', data.projectId] });
      message.success('Library duplicated successfully');
      setShowMenu(false);
      // Optionally navigate to the new library
      // router.push(`/${data.projectId}/${data.libraryId}`);
    },
    onError: (error: any) => {
      message.error(error?.message || 'Failed to duplicate library');
    },
  });

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const clickedInsideMenu = menuRef.current?.contains(event.target as Node);
      const clickedInsideExternalMenu = externalMenuRef.current?.contains(event.target as Node);
      
      if (!clickedInsideMenu && !clickedInsideExternalMenu) {
        setShowMenu(false);
        if (externalMenuPosition && onExternalMenuClose) {
          onExternalMenuClose();
        }
      }
    };

    if (isMenuVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isMenuVisible, externalMenuPosition, onExternalMenuClose]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(true);
  };

  const handleEdit = () => {
    setShowMenu(false);
    if (onExternalMenuClose) {
      onExternalMenuClose();
    }
    setShowEditModal(true);
  };

  const handleDuplicate = () => {
    setShowMenu(false);
    if (onExternalMenuClose) {
      onExternalMenuClose();
    }
    duplicateMutation.mutate();
  };

  const handleDelete = () => {
    setShowMenu(false);
    if (onExternalMenuClose) {
      onExternalMenuClose();
    }
    setShowDeleteModal(true);
  };

  return (
    <>
      <div className={styles.menuContainer} ref={menuRef}>
        <Tooltip title="More options" placement="top">
          <button
            className={styles.menuButton}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            onContextMenu={handleContextMenu}
          >
            <Image src={versionItemMenuIcon}
              alt="More options"
              width={24} height={24} className="icon-24"
            />
          </button>
        </Tooltip>

        {showMenu && (
          <div className={styles.menuDropdown}>
            <button className={styles.menuItem} onClick={handleEdit}>
              Edit version info
            </button>
            <button className={styles.menuItem} onClick={handleDuplicate}>
              Duplicate as a new library
            </button>
            <button className={`${styles.menuItem} ${styles.deleteItem}`} onClick={handleDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      {/* External context menu (positioned at mouse click) */}
      {externalMenuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={externalMenuRef}
          className={styles.menuDropdown}
          style={{
            position: 'fixed',
            left: externalMenuPosition.x,
            top: externalMenuPosition.y,
            zIndex: 1000,
          }}
        >
          <button className={styles.menuItem} onClick={handleEdit}>
            Edit version info
          </button>
          <button className={styles.menuItem} onClick={handleDuplicate}>
            Duplicate as a new library
          </button>
          <button className={`${styles.menuItem} ${styles.deleteItem}`} onClick={handleDelete}>
            Delete
          </button>
        </div>,
        document.body
      )}

      <EditVersionModal
        open={showEditModal}
        version={version}
        libraryId={libraryId}
        onClose={() => setShowEditModal(false)}
        onSuccess={() => {
          setShowEditModal(false);
        }}
      />

      <DeleteConfirmModal
        open={showDeleteModal}
        version={version}
        libraryId={libraryId}
        onClose={() => setShowDeleteModal(false)}
        onSuccess={() => {
          setShowDeleteModal(false);
          // 如果删除的版本是当前选中的版本，则回到 current version
          if (isSelected && onVersionSelect) {
            onVersionSelect(null);
          }
        }}
      />
    </>
  );
}

