'use client';

import Image from 'next/image';
import { Tooltip } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { Library } from '@/lib/services/libraryService';
import type { SidebarAssetRow } from '../hooks/useSidebarAssets';
import { truncateText } from '@/lib/utils/truncateText';
import libraryBookIcon from '@/assets/images/LibraryBookIcon.svg';
import addProjectIcon from '@/assets/images/addProjectIcon.svg';
import sidebarFolderIcon3 from '@/assets/images/SidebarFloderIcon3.svg';
import sidebarFolderIcon4 from '@/assets/images/SidebarFloderIcon4.svg';
import sidebarFolderIcon5 from '@/assets/images/SidebarFolderInco5.svg';
import FolderCloseIcon from '@/assets/images/FolderCloseIcon.svg';
import { SidebarTreeView } from './SidebarTreeView';
import styles from '../Sidebar.module.css';

export type SidebarCurrentIds = {
  projectId: string | null;
  libraryId: string | null;
  assetId: string | null;
};

export type SidebarLibrariesSectionProps = {
  currentIds: SidebarCurrentIds;
  libraries: Library[];
  assets: Record<string, SidebarAssetRow[]>;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  loadingFolders: boolean;
  loadingLibraries: boolean;
  foldersLength: number;
  librariesLength: number;
  treeData: DataNode[];
  selectedKeys: React.Key[];
  expandedKeys: React.Key[];
  onSelect: (keys: React.Key[], info: any) => void;
  onExpand: (expandedKeys: React.Key[], info: { node: any }) => void;
  onBackToLibrary: () => void;
  onLibraryPredefineClick: (projectId: string, libraryId: string, e: React.MouseEvent) => void;
  onAddNewAsset: () => void;
  onAssetClick: (projectId: string, libraryId: string, assetId: string) => void;
  onContextMenu: (e: React.MouseEvent, type: 'asset', id: string) => void;
  addButtonRef: (el: HTMLButtonElement | null) => void;
  onAddButtonClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

/**
 * Renders the Libraries section: either asset list (when on asset page) or tree + empty state.
 */
export function SidebarLibrariesSection({
  currentIds,
  libraries,
  assets,
  userRole,
  loadingFolders,
  loadingLibraries,
  foldersLength,
  librariesLength,
  treeData,
  selectedKeys,
  expandedKeys,
  onSelect,
  onExpand,
  onBackToLibrary,
  onLibraryPredefineClick,
  onAddNewAsset,
  onAssetClick,
  onContextMenu,
  addButtonRef,
  onAddButtonClick,
}: SidebarLibrariesSectionProps) {
  const showAssetView = currentIds.assetId && currentIds.libraryId;

  return (
    <>
      {!currentIds.assetId && (
        <div className={styles.sectionTitle}>
          <span>Libraries</span>
          {userRole === 'admin' && (
            <button
              ref={addButtonRef}
              className={styles.addButton}
              onClick={onAddButtonClick}
              title="Add new folder or library"
            >
              <Image src={addProjectIcon} alt="Add library" width={24} height={24} />
            </button>
          )}
        </div>
      )}
      <div className={styles.sectionList}>
        {showAssetView ? (
          <>
            {(() => {
              const currentLibrary = libraries.find((lib) => lib.id === currentIds.libraryId);
              const libraryName = currentLibrary?.name || 'Library';
              const libraryAssets = assets[currentIds.libraryId!] || [];
              return (
                <>
                  <div className={`${styles.itemRow} ${styles.libraryItemActiveWithPadding}`}>
                    <div className={styles.itemMain}>
                      <button
                        className={styles.libraryBackButton}
                        onClick={(e) => {
                          e.stopPropagation();
                          onBackToLibrary();
                        }}
                        title="Back to library"
                      >
                        <Image src={sidebarFolderIcon3} alt="Back" width={24} height={24} />
                      </button>
                      <div className={styles.libraryIconContainer}>
                        <Image src={libraryBookIcon} alt="Library" width={24} height={24} />
                      </div>
                      <span className={styles.itemText} title={libraryName}>
                        {truncateText(libraryName, 15)}
                      </span>
                    </div>
                    <div className={styles.itemActions}>
                      {userRole === 'admin' && (
                        <Tooltip title="Predefine asset here" placement="top" color="#8B5CF6">
                          <button
                            className={styles.iconButton}
                            aria-label="Library sections"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (currentIds.projectId && currentIds.libraryId) {
                                onLibraryPredefineClick(currentIds.projectId, currentIds.libraryId, e);
                              }
                            }}
                          >
                            <Image src={sidebarFolderIcon4} alt="Predefine" width={22} height={22} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {(userRole === 'admin' || userRole === 'editor') && (
                    <button
                      className={`${styles.createButton} ${styles.createButtonAligned}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddNewAsset();
                      }}
                    >
                      <span className={styles.createButtonText}>
                        <Image src={sidebarFolderIcon5} alt="Add" width={24} height={24} />
                        Add new asset
                      </span>
                    </button>
                  )}
                  <div className={styles.assetList}>
                    {libraryAssets.map((asset) => {
                      const isCurrentAsset = currentIds.assetId === asset.id;
                      return (
                        <div
                          key={asset.id}
                          className={`${styles.itemRow} ${isCurrentAsset ? styles.assetItemActive : ''}`}
                          onClick={() => {
                            if (currentIds.projectId && currentIds.libraryId) {
                              onAssetClick(currentIds.projectId, currentIds.libraryId, asset.id);
                            }
                          }}
                          onContextMenu={(e) => onContextMenu(e, 'asset', asset.id)}
                        >
                          <div className={styles.itemMain}>
                            <span
                              className={styles.itemText}
                              title={asset.name && asset.name !== 'Untitled' ? asset.name : ''}
                            >
                              {truncateText(asset.name && asset.name !== 'Untitled' ? asset.name : '', 15)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <>
            <SidebarTreeView
              treeData={treeData}
              selectedKeys={selectedKeys}
              expandedKeys={expandedKeys}
              onSelect={onSelect}
              onExpand={onExpand}
            />
            {!loadingFolders && !loadingLibraries && foldersLength === 0 && librariesLength === 0 && (
              <div className={styles.sidebarEmptyState}>
                <Image
                  src={FolderCloseIcon}
                  alt="No folders or libraries"
                  width={22}
                  height={18}
                  className={styles.emptyIcon}
                />
                <div className={styles.sidebarEmptyText}>
                  No folder or library in this project yet.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
