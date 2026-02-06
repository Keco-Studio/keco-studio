/**
 * Version Item Component
 * 
 * Displays a single version entry with icon, name, creator, and time
 * Based on Figma design
 */

'use client';

import { useState } from 'react';
import { Avatar, Tooltip } from 'antd';
import Image from 'next/image';
import type { LibraryVersion } from '@/lib/types/version';
import { VersionItemMenu } from './VersionItemMenu';
import { RestoreButton } from './RestoreButton';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import visionItemIcon1 from '@/assets/images/VisionItemIcon1.svg';
import visionItemIcon2 from '@/assets/images/ViisionItemIcon2.svg';
import versionRestoreIcon from '@/assets/images/VersionRestoreIcon.svg';
import styles from './VersionItem.module.css';

interface VersionItemProps {
  version: LibraryVersion;
  libraryId: string;
  isLast: boolean;
  isFirst?: boolean;
  isSelected?: boolean;
  onSelect?: (versionId: string | null) => void;
  onRestoreSuccess?: (restoredVersionId: string, snapshotData?: any) => void;
  isHighlighted?: boolean;
}

export function VersionItem({ version, libraryId, isLast, isFirst = false, isSelected = false, onSelect, onRestoreSuccess, isHighlighted = false }: VersionItemProps) {
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Format date: "Dec 28, 7:40 AM"
  const formatDate = (date: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${month} ${day}, ${displayHours}:${displayMinutes} ${ampm}`;
  };

  // Get user initials
  const getUserInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  // Get avatar color
  const avatarColor = version.createdBy.avatarColor || getUserAvatarColor(version.createdBy.id);

  const isCurrent = version.isCurrent;
  const displayName = version.versionName;
  const creatorName = version.createdBy.name;
  const createdDate = formatDate(version.createdAt);
  // For restore versions, show restore time; otherwise show creation time
  const displayDate = version.restoredAt ? formatDate(version.restoredAt) : createdDate;
  const creatorText = version.restoredBy 
    ? `restored by ${version.restoredBy.name}` 
    : `added by ${creatorName}`;

  const handleClick = (e: React.MouseEvent) => {
    // Don't select if clicking on action buttons
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.actions}`) || target.closest('button')) {
      return;
    }
    // Allow selecting any version including current version
    if (onSelect) {
      if (isCurrent || version.id === '__current__') {
        // Selecting current version means going back to null (current editing state)
        onSelect(null);
      } else {
        onSelect(version.id);
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Only show context menu for history versions (not current)
    if (isCurrent) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const handleCloseContextMenu = () => {
    setContextMenuPosition(null);
  };

  return (
    <div 
      className={`${styles.versionItem} ${isCurrent ? styles.currentVersion : styles.historyVersion} ${isSelected ? styles.selected : ''} ${isHighlighted ? styles.highlighting : ''}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Left Icon */}
      <div className={styles.iconContainer}>
        <div 
          className={`${styles.versionIcon} ${isCurrent ? styles.currentIcon : styles.historyIcon}`}
        >
          <Image
            src={
              version.versionType === 'restore'
                ? versionRestoreIcon
                : isCurrent 
                  ? visionItemIcon2 
                  : visionItemIcon1
            }
            alt={
              version.versionType === 'restore'
                ? "Restored version"
                : isCurrent 
                  ? "Current version" 
                  : "History version"
            }
            width={30}
            height={30}
            className={styles.iconImage}
          />
        </div>
        {/* First Connection Line - from top to icon center */}
        {isFirst && (
          <div className={styles.firstConnectionLine} />
        )}
        {/* Connection Line - from icon center to next item or bottom */}
        {isLast ? (
          <div className={styles.lastConnectionLine} />
        ) : (
          <div className={styles.connectionLine} />
        )}
      </div>

      {/* Right Details */}
      <div className={styles.details}>
        {isCurrent ? (
          <div className={`${styles.versionName} ${styles.currentName}`}>
            Current Version
          </div>
        ) : (
          <>
            <div className={`${styles.versionName} ${styles.historyName}`}>
              {displayName}
            </div>
            <div className={styles.creatorInfo}>
              <Avatar
                size={18}
                style={{ backgroundColor: avatarColor }}
                className={styles.creatorAvatar}
              >
                {getUserInitials(creatorName)}
              </Avatar>
              <span className={styles.creatorText}>{creatorText}</span>
            </div>
            <div className={styles.dateText}>{displayDate}</div>
          </>
        )}
      </div>

      {/* Actions (only for history versions) */}
      {!isCurrent && (
        <div className={styles.actions}>
          <RestoreButton version={version} libraryId={libraryId} onRestoreSuccess={onRestoreSuccess} />
          <VersionItemMenu 
            version={version} 
            libraryId={libraryId}
            externalMenuPosition={contextMenuPosition}
            onExternalMenuClose={handleCloseContextMenu}
            isSelected={isSelected}
            onVersionSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}

