'use client';

import Image from 'next/image';
import { Library } from '@/lib/services/libraryService';
import tableIcon from "@/assets/images/table.svg";
import moreOptionsIcon from "@/assets/images/moreOptionsIcon.svg";
import tableThumbnail from "@/assets/images/tableThumbnail.svg";
import { requestLibraryContextMenu } from '@/components/libraries/libraryContextMenuRequest';
import type { ContextMenuAction } from '@/components/layout/ContextMenu';
import styles from './LibraryCard.module.css';

type LibraryCardProps = {
  library: Library;
  projectId: string;
  assetCount?: number;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isProjectOwner?: boolean;
  onClick?: (libraryId: string) => void;
  /** @deprecated Prefer the shared Sidebar menu via requestLibraryContextMenu. Kept for call-site compatibility. */
  onAction?: (libraryId: string, action: ContextMenuAction) => void;
};

export function LibraryCard({ 
  library, 
  assetCount = 0,
  onClick,
}: LibraryCardProps) {
  const handleCardClick = () => {
    onClick?.(library.id);
  };

  return (
    <div className={styles.card} onClick={handleCardClick}>
      <div className={styles.thumbnailContainer}>
        <Image 
          src={tableThumbnail} 
          alt="Table thumbnail" 
          width={573} 
          height={104}
          className={styles.thumbnail}
          priority
        />
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.libraryInfo}>
          <div className={styles.libraryIconContainer}>
            <Image src={tableIcon}
              alt="Library"
              width={24} height={24} className="icon-24"
            />
          </div>
          <div className={styles.libraryNameContainer}>
            <span className={styles.libraryName}>{library.name}</span>
            <span className={styles.assetCount}>{assetCount} assets</span>
          </div>
        </div>
        <div className={styles.cardActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={(event) => {
              event.stopPropagation();
              requestLibraryContextMenu(library.id, event.currentTarget);
            }}
            aria-label="More options"
          >
            <Image src={moreOptionsIcon}
              alt="More"
              width={20} height={20} className="icon-20"
            />
          </button>
        </div>
      </div>
    </div>
  );
}
