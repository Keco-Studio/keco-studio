'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import { Library } from '@/lib/services/libraryService';
import libraryCardIcon from "@/assets/images/projectPreviewListLibraryIcon.svg";
import predefineSettingIcon from "@/assets/images/PredefineNewIcon.svg";
import moreOptionsIcon from "@/assets/images/moreOptionsIcon.svg";
import tableThumbnail from "@/assets/images/tableThumbnail.svg";
import { ContextMenu, ContextMenuAction } from '@/components/layout/ContextMenu';
import styles from './LibraryCard.module.css';

type LibraryCardProps = {
  library: Library;
  projectId: string;
  assetCount?: number;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isProjectOwner?: boolean;
  onSettingsClick?: (libraryId: string, e: React.MouseEvent) => void;
  onClick?: (libraryId: string) => void;
  onAction?: (libraryId: string, action: ContextMenuAction) => void;
};

export function LibraryCard({ 
  library, 
  projectId,
  assetCount = 0,
  userRole,
  isProjectOwner,
  onSettingsClick,
  onClick,
  onAction,
}: LibraryCardProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleCardClick = () => {
    if (onClick && !contextMenu) {
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
    const buttonRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: buttonRect.left - 180,
      y: buttonRect.bottom + 4,
    });
  };

  const handleContextMenuAction = (action: ContextMenuAction) => {
    if (onAction) {
      onAction(library.id, action);
    }
    setContextMenu(null);
  };

  return (
    <>
      <div className={styles.card} onClick={handleCardClick}>
        <div className={styles.thumbnailContainer}>
          <Image 
            src={tableThumbnail} 
            alt="Table thumbnail" 
            width={573} 
            height={104}
            className={styles.thumbnail}
          />
        </div>
        <div className={styles.cardFooter}>
          <div className={styles.libraryInfo}>
            <div className={styles.libraryIconContainer}>
              <Image src={libraryCardIcon}
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
            <Tooltip
              title="Predefine asset here"
              placement="bottom"
              color="#0B99FF"
            >
              <button
                className={styles.actionButton}
                onClick={handleSettingsClick}
                aria-label="Library settings"
              >
                <Image src={predefineSettingIcon}
                  alt="Settings"
                  width={20} height={20} className="icon-20"
                />
              </button>
            </Tooltip>
            <button
              className={`${styles.actionButton} ${contextMenu ? styles.actionButtonActive : ''}`}
              onClick={handleMoreClick}
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
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type="library"
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          userRole={userRole}
          isProjectOwner={isProjectOwner}
        />
      )}
    </>
  );
}

