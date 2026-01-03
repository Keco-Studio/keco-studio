'use client';

import { useState } from 'react';
import Image from 'next/image';
import plusHorizontal from "@/app/assets/images/plusHorizontal.svg";
import plusVertical from "@/app/assets/images/plusVertical.svg";
import searchIcon from "@/app/assets/images/searchIcon.svg";
import listViewIcon from "@/app/assets/images/listViewIcon.svg";
import gridViewIcon from "@/app/assets/images/gridViewIcon.svg";
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';
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
};

export function LibraryToolbar({
  onCreateFolder,
  onCreateLibrary,
  onSearchChange,
  viewMode = 'grid',
  onViewModeChange,
  mode = 'project',
}: LibraryToolbarProps) {
  const [searchValue, setSearchValue] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [createButtonRef, setCreateButtonRef] = useState<HTMLButtonElement | null>(null);

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

  return (
    <div className={styles.toolbar}>
      <button
        ref={setCreateButtonRef}
        className={styles.createButton}
        onClick={handleCreateButtonClick}
        aria-label={mode === 'folder' ? 'Create Library' : 'Create Folder/Library'}
      >
        <span className={styles.plusIcon}>
          <Image
            src={plusHorizontal}
            alt=""
            width={17}
            height={2}
            className={styles.plusHorizontal}
          />
          <Image
            src={plusVertical}
            alt=""
            width={2}
            height={17}
            className={styles.plusVertical}
          />
        </span>
        <span className={styles.createButtonText}>
          {mode === 'folder' ? 'Create Library' : 'Create'}
        </span>
      </button>
      
      <div className={styles.searchContainer}>
        <Image
          src={searchIcon}
          alt="Search"
          width={24}
          height={24}
          className={styles.searchIcon}
        />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search"
          value={searchValue}
          onChange={handleSearchChange}
        />
      </div>

      <div className={styles.viewToggle}>
        <button
          className={`${styles.viewButton} ${viewMode === 'list' ? styles.viewButtonActive : ''}`}
          onClick={handleListViewClick}
          aria-label="List view"
        >
          <Image
            src={listViewIcon}
            alt="List view"
            width={24}
            height={24}
          />
        </button>
        <button
          className={`${styles.viewButton} ${viewMode === 'grid' ? styles.viewButtonActive : ''}`}
          onClick={handleGridViewClick}
          aria-label="Grid view"
        >
          <Image
            src={gridViewIcon}
            alt="Grid view"
            width={24}
            height={24}
          />
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
    </div>
  );
}

