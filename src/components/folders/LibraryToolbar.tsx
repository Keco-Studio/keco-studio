'use client';

import { useState } from 'react';
import Image from 'next/image';
import projectPreviewCreateBtnIcon from "@/assets/images/projectPreviewCreateBtnIcon.svg";
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';
import { InviteCollaboratorModal } from '@/components/collaboration/InviteCollaboratorModal';
import { showSuccessToast } from '@/lib/utils/toast';
import type { CollaboratorRole } from '@/lib/types/collaboration';
import styles from './LibraryToolbar.module.css';

type LibraryToolbarProps = {
  onCreateFolder?: () => void;
  onCreateLibrary?: () => void;
  onSearchChange?: (value: string) => void;
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (mode: 'list' | 'grid') => void;
  /**
   * Mode of the toolbar:
   * - 'project': Show "Create" button with menu for both folder and library
   * - 'folder': Show "Create Library" button that directly opens library modal
   */
  mode?: 'project' | 'folder';
  /**
   * Title to display on the left side of the toolbar
   * - For project page: project name
   * - For folder page: folder name
   */
  title?: string;
  /**
   * User's role in the current project
   * Only admin users can see the Create button
   */
  userRole?: CollaboratorRole | null;
  /**
   * Project ID for sharing functionality
   */
  projectId?: string;
};

export function LibraryToolbar({
  onCreateFolder,
  onCreateLibrary,
  onSearchChange,
  viewMode = 'grid',
  onViewModeChange,
  mode = 'project',
  title,
  userRole,
  projectId,
}: LibraryToolbarProps) {
  const [searchValue, setSearchValue] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [createButtonRef, setCreateButtonRef] = useState<HTMLButtonElement | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    if (onSearchChange) {
      onSearchChange(value);
    }
  };

  const handleListViewClick = () => {
    if (onViewModeChange) {
      onViewModeChange('list');
    }
  };

  const handleGridViewClick = () => {
    if (onViewModeChange) {
      onViewModeChange('grid');
    }
  };

  const handleCreateButtonClick = () => {
    if (mode === 'folder') {
      // In folder mode, directly create library
      if (onCreateLibrary) {
        onCreateLibrary();
      }
    } else {
      // In project mode, show menu to choose between folder and library
      setShowAddMenu(!showAddMenu);
    }
  };

  const handleCreateFolder = () => {
    setShowAddMenu(false);
    if (onCreateFolder) {
      onCreateFolder();
    }
  };

  const handleCreateLibrary = () => {
    setShowAddMenu(false);
    if (onCreateLibrary) {
      onCreateLibrary();
    }
  };

  // Only admin can create folders and libraries
  const canCreate = userRole === 'admin';

  return (
    <div className={styles.toolbar}>
      {/* {title && (
        <h1 className={styles.title}>{title}</h1>
      )} */}
      {canCreate && (
        <button
          ref={setCreateButtonRef}
          className={styles.createButton}
          onClick={handleCreateButtonClick}
          aria-label={mode === 'folder' ? 'Create Library' : 'Create Folder/Library'}
        >
          <span className={styles.plusIcon}>
            <Image src={projectPreviewCreateBtnIcon}
              alt="Create"
              width={20} height={20} className="icon-20"
            />
          </span>
          <span className={styles.createButtonText}>
            {mode === 'folder' ? 'Create Library' : 'Create'}
          </span>
        </button>
      )}
      
      {/* Share Button */}
      <div className={styles.shareSection}>
        <button
          className={styles.shareButton}
          onClick={() => setShowInviteModal(true)}
        >
          Share
        </button>
      </div>

      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewButton} ${viewMode === 'list' ? styles.viewButtonActive : ''}`}
          onClick={handleListViewClick}
          aria-label="List view"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.viewIcon}>
            <path d="M7.5 5.00569H21M3 5.01734L3.01125 5.00439M3 12.0109L3.01125 11.9979M3 19.0044L3.01125 18.9915M7.5 11.9992H21M7.5 18.9927H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          className={`${styles.viewButton} ${viewMode === 'grid' ? styles.viewButtonActive : ''}`}
          onClick={handleGridViewClick}
          aria-label="Grid view"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={styles.viewIcon}>
            <path d="M10 3H3V10H10V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 3H14V10H21V3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 14H14V21H21V14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 14H3V21H10V14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Only show menu in project mode */}
      {mode === 'project' && (
        <AddLibraryMenu
          open={showAddMenu}
          anchorElement={createButtonRef}
          onClose={() => setShowAddMenu(false)}
          onCreateFolder={handleCreateFolder}
          onCreateLibrary={handleCreateLibrary}
        />
      )}

      {/* Invite Collaborator Modal */}
      {projectId && (
        <InviteCollaboratorModal
          projectId={projectId}
          projectName={title || 'Project'}
          userRole={userRole || 'viewer'}
          open={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onSuccess={(email: string, message: string, autoAccepted: boolean) => {
            // Show success message using custom toast
            showSuccessToast(message);
          }}
          title={`Share ${title || 'Project'}..`}
        />
      )}
    </div>
  );
}

