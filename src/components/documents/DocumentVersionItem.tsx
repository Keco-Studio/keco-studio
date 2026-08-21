'use client';

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Avatar } from 'antd';
import Image from 'next/image';
import type { DocumentVersionSummary } from '@/lib/documents/documentVersionService';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import visionItemIcon1 from '@/assets/images/VisionItemIcon1.svg';
import visionItemCurrentIcon from '@/assets/images/VisionItemCurrentIcon.svg';
import visionItemAgentIcon from '@/assets/images/VisionItemAgentIcon.svg';
import versionRestoreIcon from '@/assets/images/VersionRestoreIcon.svg';
import versionItemRestoreIcon from '@/assets/images/VersionItemRestoreIcon.svg';
import versionItemMenuIcon from '@/assets/images/VersionItemMenuIcon.svg';
import styles from './DocumentVersionItem.module.css';

export type DocumentVersionListEntry =
  | { kind: 'current' }
  | { kind: 'history'; version: DocumentVersionSummary };

type DocumentVersionItemProps = {
  entry: DocumentVersionListEntry;
  isFirst: boolean;
  isLast: boolean;
  isSelected: boolean;
  canMutate: boolean;
  canDelete: boolean;
  onSelect: (versionId: string | null) => void;
  onRestore?: (version: DocumentVersionSummary) => void;
  onDelete?: (version: DocumentVersionSummary) => void;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, '0');
  return `${month} ${day}, ${displayHours}:${displayMinutes} ${ampm}`;
}

function getUserInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function creatorLabel(version: DocumentVersionSummary): string {
  const name = version.createdByName ?? 'Unknown collaborator';
  if (version.type === 'pre_agent' || version.type === 'gdd_generation') {
    return `modified by ${name} with Keco Agent`;
  }
  if (version.type === 'restore') return `restored by ${name}`;
  return `modified by ${name}`;
}

function timelineIcon(version: DocumentVersionSummary | null, isCurrent: boolean) {
  if (isCurrent) return visionItemCurrentIcon;
  if (version?.type === 'pre_agent') return visionItemAgentIcon;
  if (version?.type === 'restore') return versionRestoreIcon;
  return visionItemIcon1;
}

export function DocumentVersionItem({
  entry,
  isFirst,
  isLast,
  isSelected,
  canMutate,
  canDelete,
  onSelect,
  onRestore,
  onDelete,
}: DocumentVersionItemProps) {
  const isCurrent = entry.kind === 'current';
  const version = entry.kind === 'history' ? entry.version : null;
  const generated = Boolean(version && version.type === 'gdd_generation');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const creatorName = version?.createdByName ?? 'Unknown collaborator';
  const avatarSeed = version?.createdBy ?? creatorName;

  const handleClick = (event: ReactMouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest(`.${styles.actions}`) || target.closest('button')) return;
    onSelect(isCurrent ? null : version!.id);
  };

  return (
    <div
      className={[
        styles.versionItem,
        isCurrent ? styles.currentVersion : styles.historyVersion,
        isSelected ? styles.selected : '',
        menuOpen ? styles.menuOpen : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={
        isCurrent
          ? 'document-version-row-current'
          : `document-version-row-${version!.id}`
      }
      onClick={handleClick}
    >
      <div className={styles.iconContainer}>
        <div className={styles.versionIcon}>
          <Image
            src={timelineIcon(version, isCurrent)}
            alt={isCurrent ? 'Current version' : version!.name}
            width={30}
            height={30}
            className={styles.iconImage}
          />
        </div>
        {isFirst && <div className={styles.firstConnectionLine} />}
        {isLast ? (
          <div className={styles.lastConnectionLine} />
        ) : (
          <div className={styles.connectionLine} />
        )}
      </div>

      <div className={styles.details}>
        {isCurrent ? (
          <div className={`${styles.versionName} ${styles.currentName}`}>
            Current Version
          </div>
        ) : (
          <>
            <div className={`${styles.versionName} ${styles.historyName}`}>
              {version!.name}
            </div>
            <div className={styles.creatorInfo}>
              <Avatar
                size={18}
                style={{ backgroundColor: getUserAvatarColor(avatarSeed) }}
                className={styles.creatorAvatar}
              >
                {getUserInitials(creatorName)}
              </Avatar>
              <span className={styles.creatorText}>{creatorLabel(version!)}</span>
            </div>
            <div className={styles.dateText}>{formatDate(version!.createdAt)}</div>
          </>
        )}
      </div>

      {!isCurrent && canMutate && !generated && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.restoreButton}
            data-testid={`restore-version-${version!.id}`}
            aria-label="Restore"
            title="Restore"
            onClick={(event) => {
              event.stopPropagation();
              onRestore?.(version!);
            }}
          >
            <Image
              src={versionItemRestoreIcon}
              alt=""
              width={24}
              height={24}
              className="icon-24"
            />
          </button>
          {canDelete && (
            <div className={styles.menuContainer} ref={menuRef}>
              <button
                type="button"
                className={styles.menuButton}
                aria-label="Version actions"
                data-testid={`delete-version-${version!.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((open) => !open);
                }}
              >
                <Image
                  src={versionItemMenuIcon}
                  alt=""
                  width={24}
                  height={24}
                  className="icon-24"
                />
              </button>
              {menuOpen && (
                <div className={styles.menuDropdown} role="menu">
                  <button
                    type="button"
                    className={`${styles.menuItem} ${styles.deleteItem}`}
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen(false);
                      onDelete?.(version!);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
