'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Library } from '@/lib/services/libraryService';
import { Folder } from '@/lib/services/folderService';
import { type DocumentSummary } from '@/lib/services/documentService';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import projectPreviewListLibraryIcon from "@/assets/images/projectPreviewListLibraryIcon.svg";
import projectPreviewListLibraryActiveIcon from "@/assets/images/projectPreviewListLibraryActiveIcon.svg";
import folderIcon from "@/assets/images/projectPreviewListFolderIcon.svg";
import paperIcon from "@/assets/images/paper.svg";
import moreOptionsIcon from "@/assets/images/moreOptionsIcon.svg";
import { ContextMenu, ContextMenuAction } from '@/components/layout/ContextMenu';
import styles from './LibraryListView.module.css';

type LibraryWithAssetCount = Library & {
  assetCount?: number;
};

type FolderItem = Folder & {
  type: 'folder';
  libraryCount?: number;
};

type LibraryItem = LibraryWithAssetCount & {
  type: 'library';
};

type DocumentItem = DocumentSummary & {
  type: 'document';
};

type ListItem = FolderItem | LibraryItem | DocumentItem;

type LibraryListViewProps = {
  libraries?: LibraryWithAssetCount[];
  documents?: DocumentSummary[];
  folders?: Folder[];
  projectId: string;
  userRole?: 'admin' | 'editor' | 'viewer' | null;
  isProjectOwner?: boolean;
  onLibraryClick?: (libraryId: string) => void;
  onDocumentClick?: (documentId: string) => void;
  onFolderClick?: (folderId: string) => void;
  onLibraryAction?: (libraryId: string, action: ContextMenuAction) => void;
  onFolderAction?: (folderId: string, action: ContextMenuAction) => void;
};

export function LibraryListView({
  libraries = [],
  documents = [],
  folders = [],
  projectId,
  userRole,
  isProjectOwner,
  onLibraryClick,
  onDocumentClick,
  onFolderClick,
  onLibraryAction,
  onFolderAction,
}: LibraryListViewProps) {
  const { userProfile } = useAuth();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'library' | 'folder';
    id: string;
  } | null>(null);

  // Combine the folder's resources into a single list with type discriminators.
  const items: ListItem[] = [
    ...folders.map(folder => ({ ...folder, type: 'folder' as const })),
    ...libraries.map(library => ({ ...library, type: 'library' as const })),
    ...documents.map(document => ({ ...document, type: 'document' as const })),
  ];

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  };

  const handleRowClick = (item: ListItem) => {
    setSelectedItemId(item.id);
    if (item.type === 'folder' && onFolderClick) {
      onFolderClick(item.id);
    } else if (item.type === 'library' && onLibraryClick) {
      onLibraryClick(item.id);
    } else if (item.type === 'document' && onDocumentClick) {
      onDocumentClick(item.id);
    }
  };

  const handleMoreClick = (itemId: string, itemType: 'library' | 'folder', e: React.MouseEvent) => {
    e.stopPropagation();
    const buttonRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({
      x: buttonRect.left - 180,
      y: buttonRect.bottom + 4,
      type: itemType,
      id: itemId,
    });
  };

  const handleRowContextMenu = (
    itemId: string,
    itemType: 'library' | 'folder',
    e: React.MouseEvent,
  ) => {
    if (itemType !== 'folder') return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      type: itemType,
      id: itemId,
    });
  };

  const handleContextMenuAction = (action: ContextMenuAction) => {
    if (!contextMenu) return;
    
    if (contextMenu.type === 'library' && onLibraryAction) {
      onLibraryAction(contextMenu.id, action);
    } else if (contextMenu.type === 'folder' && onFolderAction) {
      onFolderAction(contextMenu.id, action);
    }
    
    setContextMenu(null);
  };

  // Helper function to get user initial (first character) - consistent with TopBar
  const getUserInitials = (username: string | null, fullName: string | null, email: string | null): string => {
    // Prefer username first (consistent with TopBar's displayName logic)
    const displayName = username || fullName || email || 'Guest';
    return displayName.charAt(0).toUpperCase();
  };

  return (
    <>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.headerCell}>NAME</th>
              <th className={styles.headerCell}>LAST UPDATED BY</th>
              <th className={styles.headerCell}>ITEMS</th>
              <th className={styles.headerCell}>LAST UPDATED</th>
              <th className={styles.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isHovered = hoveredItemId === item.id;
              const isLibrary = item.type === 'library';
              const isDocument = item.type === 'document';
              const iconSrc = isDocument
                ? paperIcon
                : isLibrary
                ? (isHovered ? projectPreviewListLibraryActiveIcon : projectPreviewListLibraryIcon)
                : folderIcon;
              
              return (
              <tr
                key={item.id}
                className={`${styles.tableRow} ${selectedItemId === item.id ? styles.tableRowSelected : ''}`}
                onClick={() => handleRowClick(item)}
                onContextMenu={item.type === 'document'
                  ? undefined
                  : (e) => handleRowContextMenu(item.id, item.type, e)}
                onMouseEnter={() => setHoveredItemId(item.id)}
                onMouseLeave={() => setHoveredItemId(null)}
              >
                <td className={styles.cell}>
                  <div className={styles.libraryNameCell}>
                    <span className={styles.libraryIconSlot}>
                      <Image
                        src={iconSrc}
                        alt={item.type === 'folder' ? 'Folder' : isDocument ? 'Document' : 'Library'}
                        width={isDocument ? 20 : 36}
                        height={isDocument ? 20 : 36}
                        className={`${isDocument ? 'icon-20' : 'icon-36'} ${styles.libraryIcon}`}
                      />
                    </span>
                    <span className={styles.libraryName}>{item.name}</span>
                  </div>
                </td>
                <td className={styles.cell}>
                  {item.type !== 'document' && item.data_updater ? (
                    <div className={styles.avatarCell}>
                      <div 
                        className={styles.avatar}
                        style={{ backgroundColor: getUserAvatarColor(item.data_updater.id) }}
                      >
                        {getUserInitials(item.data_updater.username, item.data_updater.full_name, item.data_updater.email)}
                      </div>
                      <span className={styles.avatarName}>
                        {item.data_updater.id === userProfile?.id ? 'me' : (item.data_updater.username || item.data_updater.full_name || item.data_updater.email)}
                      </span>
                    </div>
                  ) : (
                    <span className={styles.emptyText}>-</span>
                  )}
                </td>
                <td className={styles.cell}>
                  <span className={styles.assetsText}>
                    {item.type === 'folder' 
                      ? `${item.libraryCount ?? 0} ${item.libraryCount === 1 ? 'library' : 'libraries'}`
                      : item.type === 'document'
                        ? 'Document'
                      : `${item.assetCount ?? 0} ${item.assetCount === 1 ? 'asset' : 'assets'}`
                    }
                  </span>
                </td>
                <td className={styles.cell}>
                  <span className={styles.dateText}>
                    {formatDate(item.type === 'document' ? item.updated_at : item.last_data_updated_at || item.updated_at)}
                  </span>
                </td>
                <td className={styles.cell}>
                  <div className={styles.actionButtons}>
                    {item.type !== 'document' && (
                      <button
                        className={`${styles.actionButton} ${contextMenu?.id === item.id ? styles.actionButtonActive : ''}`}
                        onClick={(e) => handleMoreClick(item.id, item.type, e)}
                        aria-label="More options"
                      >
                        <Image src={moreOptionsIcon}
                          alt="More"
                          width={20} height={20} className="icon-20"
                        />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          userRole={userRole}
          isProjectOwner={isProjectOwner}
        />
      )}
    </>
  );
}
