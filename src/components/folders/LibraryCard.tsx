'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import { Library } from '@/lib/services/libraryService';
import libraryIconLeft from "@/app/assets/images/libraryIconLeft.svg";
import libraryIconRight from "@/app/assets/images/libraryIconRight.svg";
import predefineSettingIcon from "@/app/assets/images/predefineSettingIcon.svg";
import moreOptionsIcon from "@/app/assets/images/moreOptionsIcon.svg";
import tableThumbnail from "@/app/assets/images/tableThumbnail.svg";
import { LibraryCardMenu } from './LibraryCardMenu';
import styles from './LibraryCard.module.css';

type LibraryCardProps = {
  library: Library;
  projectId: string;
  assetCount?: number;
  onSettingsClick?: (libraryId: string, e: React.MouseEvent) => void;
  onMoreClick?: (libraryId: string, e: React.MouseEvent) => void;
  onClick?: (libraryId: string) => void;
  onExport?: (libraryId: string) => void;
  onVersionHistory?: (libraryId: string) => void;
  onCreateBranch?: (libraryId: string) => void;
  onRename?: (libraryId: string) => void;
  onDuplicate?: (libraryId: string) => void;
  onMoveTo?: (libraryId: string) => void;
  onDelete?: (libraryId: string) => void;
};

export function LibraryCard({ 
  library, 
  projectId,
  assetCount = 0,
  onSettingsClick,
  onMoreClick,
  onClick,
  onExport,
  onVersionHistory,
  onCreateBranch,
  onRename,
  onDuplicate,
  onMoveTo,
  onDelete,
}: LibraryCardProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const handleCardClick = () => {
    if (onClick && !isMenuOpen) {
      onClick(library.id);
    }
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSettingsClick) {
      onSettingsClick(library.id, e);
    }
  };

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
    if (onMoreClick) {
      onMoreClick(library.id, e);
    }
  };

  const handleMenuClose = () => {
    setIsMenuOpen(false);
  };

  const handleMenuAction = (action?: (libraryId: string) => void) => {
    if (action) {
      action(library.id);
    }
    setIsMenuOpen(false);
  };

  return (
    <>
      <div className={styles.card} onClick={handleCardClick}>
        <div className={styles.thumbnailContainer}>
          <Image 
            src={tableThumbnail} 
            alt="Table thumbnail" 
            width={574} 
            height={105}
            className={styles.thumbnail}
          />
        </div>
        <div className={styles.cardFooter}>
          <div className={styles.libraryInfo}>
            <div className={styles.libraryIconContainer}>
              <Image
                src={libraryIconLeft}
                alt=""
                width={12}
                height={20}
                className={styles.libraryIconPart}
              />
              <Image
                src={libraryIconRight}
                alt=""
                width={12}
                height={20}
                className={styles.libraryIconPart}
              />
            </div>
            <div className={styles.libraryNameContainer}>
              <span className={styles.libraryName}>{library.name}</span>
              <span className={styles.assetCount}>{assetCount} assets</span>
            </div>
          </div>
          <div className={styles.cardActions}>
            <button
              className={styles.actionButton}
              onClick={handleSettingsClick}
              aria-label="Library settings"
            >
              <Image
                src={predefineSettingIcon}
                alt="Settings"
                width={22}
                height={22}
              />
            </button>
            <button
              ref={moreButtonRef}
              className={`${styles.actionButton} ${isMenuOpen ? styles.actionButtonActive : ''}`}
              onClick={handleMoreClick}
              aria-label="More options"
            >
              <Image
                src={moreOptionsIcon}
                alt="More"
                width={20}
                height={20}
              />
            </button>
          </div>
        </div>
      </div>
      <LibraryCardMenu
        isOpen={isMenuOpen}
        onClose={handleMenuClose}
        anchorElement={moreButtonRef.current}
        onExport={() => handleMenuAction(onExport)}
        onVersionHistory={() => handleMenuAction(onVersionHistory)}
        onCreateBranch={() => handleMenuAction(onCreateBranch)}
        onRename={() => handleMenuAction(onRename)}
        onDuplicate={() => handleMenuAction(onDuplicate)}
        onMoveTo={() => handleMenuAction(onMoveTo)}
        onDelete={() => handleMenuAction(onDelete)}
      />
    </>
  );
}

