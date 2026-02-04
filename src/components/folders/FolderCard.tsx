'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Folder } from '@/lib/services/folderService';
import { Library } from '@/lib/services/libraryService';
import projectPreviewFolderIcon from "@/assets/images/projectPreviewListFolderIcon.svg";
import projectPreviewFolderMoreIcon from "@/assets/images/projectPreviewFolderMoreIcon.svg";
import libraryIconImage from "@/assets/images/LibraryBookIcon.svg";
import { ContextMenu, ContextMenuAction } from '@/components/layout/ContextMenu';
import styles from './FolderCard.module.css';

// Helper function to calculate character display width (Chinese = 2, English/Number = 1)
const getCharWidth = (char: string): number => {
  // Check if character is Chinese, Japanese, Korean, or other wide characters
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
         (code >= 0x3400 && code <= 0x4DBF) || // CJK Extension A
         (code >= 0x20000 && code <= 0x2A6DF) || // CJK Extension B
         (code >= 0x3040 && code <= 0x309F) || // Hiragana
         (code >= 0x30A0 && code <= 0x30FF) || // Katakana
         (code >= 0xAC00 && code <= 0xD7AF) ? 2 : 1; // Hangul
};

// Helper function to truncate text with ellipsis based on display width
const truncateText = (text: string, maxWidth: number): string => {
  let width = 0;
  let result = '';
  
  for (const char of text) {
    const charWidth = getCharWidth(char);
    if (width + charWidth > maxWidth) {
      return result + '...';
    }
    result += char;
    width += charWidth;
  }
  
  return result;
};

type FolderCardProps = {
  folder: Folder;
  projectId: string;
  libraries?: Library[];
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isProjectOwner?: boolean;
  onClick?: (folderId: string) => void;
  onAction?: (folderId: string, action: ContextMenuAction) => void;
};

export function FolderCard({ 
  folder, 
  projectId, 
  libraries = [],
  userRole,
  isProjectOwner,
  onClick,
  onAction,
}: FolderCardProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleCardClick = () => {
    if (onClick) {
      onClick(folder.id);
    }
  };

  const handleMoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const buttonRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: buttonRect.left - 180,
      y: buttonRect.bottom + 4,
    });
  };

  const handleContextMenuAction = (action: ContextMenuAction) => {
    if (onAction) {
      onAction(folder.id, action);
    }
    setContextMenu(null);
  };

  // Determine which libraries to show
  const libraryCount = libraries.length;
  const displayLibraries = libraryCount > 3 ? libraries.slice(0, 3) : libraries;
  const showMoreIndicator = libraryCount > 3;

  return (
    <>
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
                className={`icon-16 ${styles.libraryTagIcon}`}
              />
              <span className={styles.libraryTagName} title={library.name}>{truncateText(library.name, 20)}</span>
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
                className={`icon-16 ${styles.libraryTagIcon}`}
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
            className={`icon-24 ${styles.folderIcon}`}
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
          <Image src={projectPreviewFolderMoreIcon}
            alt="More"
            width={16} height={16} className="icon-16"
          />
        </button>
      </div>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type="folder"
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          userRole={userRole}
          isProjectOwner={isProjectOwner}
        />
      )}
    </>
  );
}

