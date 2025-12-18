'use client';

import Image from 'next/image';
import { Folder } from '@/lib/services/folderService';
import folderIcon from "@/app/assets/images/folderIcon.svg";
import moreOptionsIcon from "@/app/assets/images/moreOptionsIcon.svg";
import tableThumbnail from "@/app/assets/images/tableThumbnail.svg";
import styles from './FolderCard.module.css';

type FolderCardProps = {
  folder: Folder;
  projectId: string;
  onMoreClick?: (folderId: string, e: React.MouseEvent) => void;
  onClick?: (folderId: string) => void;
};

export function FolderCard({ 
  folder, 
  projectId, 
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

  return (
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
        <div className={styles.folderInfo}>
          <Image
            src={folderIcon}
            alt="Folder"
            width={22}
            height={18}
            className={styles.folderIcon}
          />
          <span className={styles.folderName}>{folder.name}</span>
        </div>
        <div className={styles.cardActions}>
          <button
            className={styles.actionButton}
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
  );
}

