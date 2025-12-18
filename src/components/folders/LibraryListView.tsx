'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Library } from '@/lib/services/libraryService';
import libraryIcon48 from "@/app/assets/images/libraryIcon48.svg";
import settingsIcon18 from "@/app/assets/images/settingsIcon18.svg";
import moreOptionsIcon from "@/app/assets/images/moreOptionsIcon.svg";
import { LibraryCardMenu } from './LibraryCardMenu';
import styles from './LibraryListView.module.css';

type LibraryListViewProps = {
  libraries: Library[];
  projectId: string;
  onLibraryClick?: (libraryId: string) => void;
  onSettingsClick?: (libraryId: string, e: React.MouseEvent) => void;
  onExport?: (libraryId: string) => void;
  onVersionHistory?: (libraryId: string) => void;
  onCreateBranch?: (libraryId: string) => void;
  onRename?: (libraryId: string) => void;
  onDuplicate?: (libraryId: string) => void;
  onMoveTo?: (libraryId: string) => void;
  onDelete?: (libraryId: string) => void;
};

export function LibraryListView({
  libraries,
  projectId,
  onLibraryClick,
  onSettingsClick,
  onExport,
  onVersionHistory,
  onCreateBranch,
  onRename,
  onDuplicate,
  onMoveTo,
  onDelete,
}: LibraryListViewProps) {
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [menuOpenLibraryId, setMenuOpenLibraryId] = useState<string | null>(null);
  const [menuAnchorElement, setMenuAnchorElement] = useState<HTMLElement | null>(null);

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  };

  const handleRowClick = (libraryId: string) => {
    setSelectedLibraryId(libraryId);
    if (onLibraryClick) {
      onLibraryClick(libraryId);
    }
  };

  const handleSettingsClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSettingsClick) {
      onSettingsClick(libraryId, e);
    }
  };

  const handleMoreClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpenLibraryId(menuOpenLibraryId === libraryId ? null : libraryId);
    setMenuAnchorElement(e.currentTarget as HTMLElement);
  };

  const handleMenuClose = () => {
    setMenuOpenLibraryId(null);
    setMenuAnchorElement(null);
  };

  const handleMenuAction = (libraryId: string, action?: (libraryId: string) => void) => {
    if (action) {
      action(libraryId);
    }
    handleMenuClose();
  };

  return (
    <>
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.headerCell}>LIBRARY NAME</th>
              <th className={styles.headerCell}>ASSETS</th>
              <th className={styles.headerCell}>CREATE TIME</th>
              <th className={styles.headerCell}>LAST UPDATED</th>
              <th className={styles.headerCell}></th>
            </tr>
          </thead>
          <tbody>
            {libraries.map((library) => (
              <tr
                key={library.id}
                className={`${styles.tableRow} ${selectedLibraryId === library.id ? styles.tableRowSelected : ''}`}
                onClick={() => handleRowClick(library.id)}
              >
                <td className={styles.cell}>
                  <div className={styles.libraryNameCell}>
                    <Image
                      src={libraryIcon48}
                      alt="Library"
                      width={48}
                      height={48}
                      className={styles.libraryIcon}
                    />
                    <span className={styles.libraryName}>{library.name}</span>
                  </div>
                </td>
                <td className={styles.cell}>
                  <span className={styles.assetsText}>0 assets</span>
                </td>
                <td className={styles.cell}>
                  <span className={styles.dateText}>{formatDate(library.created_at)}</span>
                </td>
                <td className={styles.cell}>
                  <span className={styles.dateText}>{formatDate(library.updated_at)}</span>
                </td>
                <td className={styles.cell}>
                  <div className={styles.actionButtons}>
                    <button
                      className={styles.actionButton}
                      onClick={(e) => handleSettingsClick(library.id, e)}
                      aria-label="Library settings"
                    >
                      <Image
                        src={settingsIcon18}
                        alt="Settings"
                        width={18}
                        height={18}
                      />
                    </button>
                    <button
                      className={`${styles.actionButton} ${menuOpenLibraryId === library.id ? styles.actionButtonActive : ''}`}
                      onClick={(e) => handleMoreClick(library.id, e)}
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {menuOpenLibraryId && (
        <LibraryCardMenu
          isOpen={true}
          onClose={handleMenuClose}
          anchorElement={menuAnchorElement}
          onExport={() => handleMenuAction(menuOpenLibraryId, onExport)}
          onVersionHistory={() => handleMenuAction(menuOpenLibraryId, onVersionHistory)}
          onCreateBranch={() => handleMenuAction(menuOpenLibraryId, onCreateBranch)}
          onRename={() => handleMenuAction(menuOpenLibraryId, onRename)}
          onDuplicate={() => handleMenuAction(menuOpenLibraryId, onDuplicate)}
          onMoveTo={() => handleMenuAction(menuOpenLibraryId, onMoveTo)}
          onDelete={() => handleMenuAction(menuOpenLibraryId, onDelete)}
        />
      )}
    </>
  );
}

