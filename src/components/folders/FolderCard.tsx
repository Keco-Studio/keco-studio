'use client';

import Image from 'next/image';
import { Folder } from '@/lib/services/folderService';
import { Library } from '@/lib/services/libraryService';
import projectPreviewFolderIcon from "@/app/assets/images/projectPreviewFolderIcon.svg";
import projectPreviewFolderMoreIcon from "@/app/assets/images/projectPreviewFolderMoreIcon.svg";
import libraryIconImage from "@/app/assets/images/LibraryBookIcon.svg";
import styles from './FolderCard.module.css';

type FolderCardProps = {
  folder: Folder;
  projectId: string;
  libraries?: Library[];
  onMoreClick?: (folderId: string, e: React.MouseEvent) => void;
  onClick?: (folderId: string) => void;
};

export function FolderCard({ 
  folder, 
  projectId, 
  libraries = [],
  onMoreClick,
  onClick 
}: FolderCardProps) {
  const handleCardClick = () => {
    if (onClick) {
      onClick(folder.id);
    }
  };

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMoreClick) {
      onMoreClick(folder.id, e);
    }
  };

  // Determine which libraries to show
  const libraryCount = libraries.length;
  const displayLibraries = libraryCount > 3 ? libraries.slice(0, 3) : libraries;
  const showMoreIndicator = libraryCount > 3;

  return (
    <div className={styles.card} onClick={handleCardClick}>
      {/* Library tags section */}
      {libraries.length > 0 ? (
        <div className={styles.librariesSection}>
          {displayLibraries.map((library) => (
            <div key={library.id} className={styles.libraryTag}>
              <Image
                src={libraryIconImage}
                alt="Library"
                width={16}
                height={16}
                className={styles.libraryTagIcon}
              />
              <span className={styles.libraryTagName}>{library.name}</span>
            </div>
          ))}
          {showMoreIndicator && (
            <div className={styles.libraryTag}>
              <div className={styles.moreIconWrapper}>
                <span className={styles.moreDot}></span>
                <span className={styles.moreDot}></span>
                <span className={styles.moreDot}></span>
              </div>
              <span className={styles.libraryTagName}>More</span>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateTextContainer}>
              <Image
                src={libraryIconImage}
                alt="Library"
                width={16}
                height={16}
                className={styles.libraryTagIcon}
              />
              <span className={styles.emptyStateText}>There is no any libraries here...</span>
            </div>
        </div>
      )}
      
      <div className={styles.cardFooter}>
        <div className={styles.folderInfo}>
          <Image
            src={projectPreviewFolderIcon}
            alt="Folder"
            width={24}
            height={24}
            className={styles.folderIcon}
          />
          <div className={styles.folderDetails}>
            <span className={styles.folderName}>{folder.name}</span>
            <span className={styles.libraryCount}>{libraryCount} libraries</span>
          </div>
        </div>
        <button
          className={styles.actionButton}
          onClick={handleMoreClick}
          aria-label="More options"
        >
          <Image
            src={projectPreviewFolderMoreIcon}
            alt="More"
            width={16}
            height={16}
          />
        </button>
      </div>
    </div>
  );
}

