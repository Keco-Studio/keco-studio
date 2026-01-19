/**
 * Version Item Menu Component
 * 
 * Menu button with dropdown for version actions
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Tooltip, message } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { duplicateVersionAsLibrary } from '@/lib/services/versionService';
import { EditVersionModal } from './EditVersionModal';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import styles from './VersionItemMenu.module.css';

import type { LibraryVersion } from '@/lib/types/version';

interface VersionItemMenuProps {
  version: LibraryVersion;
  libraryId: string;
}

export function VersionItemMenu({ version, libraryId }: VersionItemMenuProps) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateVersionAsLibrary(supabase, { versionId: version.id }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['folders-libraries'] });
      message.success('Library duplicated successfully');
      setShowMenu(false);
      // Optionally navigate to the new library
      // router.push(`/${projectId}/${data.libraryId}`);
    },
    onError: (error: any) => {
      message.error(error?.message || 'Failed to duplicate library');
    },
  });

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showMenu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(true);
  };

  const handleEdit = () => {
    setShowMenu(false);
    setShowEditModal(true);
  };

  const handleDuplicate = () => {
    setShowMenu(false);
    duplicateMutation.mutate();
  };

  const handleDelete = () => {
    setShowMenu(false);
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <circle cx="4" cy="8" r="1.5" fill="currentColor" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              <circle cx="12" cy="8" r="1.5" fill="currentColor" />
            </svg>
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
        }}
      />
    </>
  );
}

