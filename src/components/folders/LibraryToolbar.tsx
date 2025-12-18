'use client';

import { useState } from 'react';
import Image from 'next/image';
import plusHorizontal from "@/app/assets/images/plusHorizontal.svg";
import plusVertical from "@/app/assets/images/plusVertical.svg";
import searchIcon from "@/app/assets/images/searchIcon.svg";
import listViewIcon from "@/app/assets/images/listViewIcon.svg";
import gridViewIcon from "@/app/assets/images/gridViewIcon.svg";
import styles from './LibraryToolbar.module.css';

type LibraryToolbarProps = {
  onCreateLibrary?: () => void;
  onSearchChange?: (value: string) => void;
  viewMode?: 'list' | 'grid';
  onViewModeChange?: (mode: 'list' | 'grid') => void;
};

export function LibraryToolbar({
  onCreateLibrary,
  onSearchChange,
  viewMode = 'grid',
  onViewModeChange,
}: LibraryToolbarProps) {
  const [searchValue, setSearchValue] = useState('');

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

  return (
    <div className={styles.toolbar}>
      <button
        className={styles.createButton}
        onClick={onCreateLibrary}
        aria-label="Create Library"
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
        <span className={styles.createButtonText}>Create Library</span>
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
    </div>
  );
}

