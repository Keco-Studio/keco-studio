/**
 * Version Item Component
 * 
 * Displays a single version entry with icon, name, creator, and time
 * Based on Figma design
 */

'use client';

import { useState, useEffect } from 'react';
import { Avatar, Tooltip } from 'antd';
import Image from 'next/image';
import type { LibraryVersion } from '@/lib/types/version';
import { VersionItemMenu } from './VersionItemMenu';
import { RestoreButton } from './RestoreButton';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import visionItemIcon1 from '@/app/assets/images/VisionItemIcon1.svg';
import visionItemIcon2 from '@/app/assets/images/ViisionItemIcon2.svg';
import versionRestoreIcon from '@/app/assets/images/VersionRestoreIcon.svg';
import styles from './VersionItem.module.css';

interface VersionItemProps {
  version: LibraryVersion;
  libraryId: string;
  isLast: boolean;
  isFirst?: boolean;
  isSelected?: boolean;
  onSelect?: (versionId: string) => void;
}

export function VersionItem({ version, libraryId, isLast, isFirst = false, isSelected = false, onSelect }: VersionItemProps) {
  const [isHighlighting, setIsHighlighting] = useState(false);

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

  // Highlight animation for restored versions
  useEffect(() => {
    // Check if this version was just restored (you can pass this as a prop or use a state management solution)
    // For now, we'll use a simple approach: check if version was created recently (within last 2 seconds)
    const timeSinceCreation = Date.now() - version.createdAt.getTime();
    if (timeSinceCreation < 2000 && version.versionType === 'restore') {
      setIsHighlighting(true);
      const timer = setTimeout(() => setIsHighlighting(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [version]);

  const isCurrent = version.isCurrent;
  const displayName = version.versionName;
  const creatorName = version.createdBy.name;
  const createdDate = formatDate(version.createdAt);
  // For restore versions, show restore time; otherwise show creation time
  const displayDate = version.restoredAt ? formatDate(version.restoredAt) : createdDate;
  const creatorText = version.restoredBy 
    ? `restore by ${version.restoredBy.name}` 
    : `added by ${creatorName}`;

  const handleClick = (e: React.MouseEvent) => {
    // Don't select if clicking on action buttons
    const target = e.target as HTMLElement;
    if (target.closest(`.${styles.actions}`) || target.closest('button')) {
      return;
    }
    if (!isCurrent && onSelect) {
      onSelect(version.id);
    }
  };

  return (
    <div 
      className={`${styles.versionItem} ${isCurrent ? styles.currentVersion : styles.historyVersion} ${isHighlighting ? styles.highlighting : ''} ${isSelected ? styles.selected : ''}`}
      onClick={handleClick}
    >
      {/* Left Icon */}
      <div className={styles.iconContainer}>
        <div 
          className={`${styles.versionIcon} ${isCurrent ? styles.currentIcon : styles.historyIcon}`}
        >
          <Image
            src={
              isCurrent 
                ? visionItemIcon2 
                : version.versionType === 'restore'
                  ? versionRestoreIcon
                  : visionItemIcon1
            }
            alt={
              isCurrent 
                ? "Current version" 
                : version.versionType === 'restore'
                  ? "Restored version"
                  : "History version"
            }
            width={48}
            height={48}
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
          <RestoreButton version={version} libraryId={libraryId} />
          <VersionItemMenu version={version} libraryId={libraryId} />
        </div>
      )}
    </div>
  );
}

