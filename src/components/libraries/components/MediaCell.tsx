import React from 'react';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { CellKey } from '@/components/libraries/hooks/useCellSelection';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export interface MediaCellProps {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  value: MediaFileMetadata | null;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  isSaving: boolean;
  // Cell selection state
  selectedCells: Set<CellKey>;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
  hoveredCellForExpand: { rowId: string; propertyKey: string } | null;
  // Selection bounds for borders
  cutSelectionBounds: {
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null;
  copySelectionBounds: {
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null;
  // Collaboration
  editingUsers: Array<{
    userId: string;
    userName: string;
    userEmail: string;
    avatarColor: string;
    activeCell: { assetId: string; propertyKey: string } | null;
    cursorPosition: { row: number; col: number } | null;
    lastActivity: string;
    connectionStatus: 'online' | 'away';
  }>;
  borderColor?: string;
  // Event handlers
  onChange: (value: MediaFileMetadata | null) => void;
  onCellClick: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellContextMenu: (e: React.MouseEvent, rowId: string, propertyKey: string) => void;
  onCellFillDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellFocus: (assetId: string, propertyKey: string) => void;
  onCellBlur: () => void;
  setHoveredCellForExpand: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  // Border classes
  getCopyBorderClasses: (rowId: string, propertyIndex: number) => string;
  getSelectionBorderClasses: (rowId: string, propertyIndex: number) => string;
}

/**
 * Media/Image/File cell component for LibraryAssetsTable
 * Renders a file upload control for media files with immediate save on change
 */
export const MediaCell: React.FC<MediaCellProps> = ({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  value,
  userRole,
  isSaving,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
  copySelectionBounds,
  editingUsers,
  borderColor,
  onChange,
  onCellClick,
  onCellContextMenu,
  onCellFillDragStart,
  onCellDragStart,
  onCellFocus,
  onCellBlur,
  setHoveredCellForExpand,
  getCopyBorderClasses,
  getSelectionBorderClasses,
}) => {
  const cellKey: CellKey = `${row.id}-${property.key}`;
  const isCellSelected = selectedCells.has(cellKey);
  const isCellCut = cutCells.has(cellKey);
  const isCellCopy = copyCells.has(cellKey);
  const showExpandIcon = isCellSelected;
  const isMultipleSelected = selectedCells.size > 1 && isCellSelected;
  const isSingleSelected = selectedCells.size === 1 && isCellSelected;
  const isBeingEdited = editingUsers.length > 0;

  // Check if cell is on border of cut selection (only show outer border)
  let cutBorderClass = '';
  if (isCellCut && cutSelectionBounds && actualRowIndex !== -1) {
    const { minRowIndex, maxRowIndex, minPropertyIndex, maxPropertyIndex } = cutSelectionBounds;
    const isTop = actualRowIndex === minRowIndex;
    const isBottom = actualRowIndex === maxRowIndex;
    const isLeft = propertyIndex === minPropertyIndex;
    const isRight = propertyIndex === maxPropertyIndex;

    const borderClasses: string[] = [];
    if (isTop) borderClasses.push(styles.cutBorderTop);
    if (isBottom) borderClasses.push(styles.cutBorderBottom);
    if (isLeft) borderClasses.push(styles.cutBorderLeft);
    if (isRight) borderClasses.push(styles.cutBorderRight);
    cutBorderClass = borderClasses.join(' ');
  }

  const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);
  const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
  const shouldShowExpandIcon = showExpandIcon;

  const handleMouseMove = (e: React.MouseEvent) => {
    if (showExpandIcon) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;

      // Check if mouse is in bottom-right corner (last 20px from right and bottom)
      const CORNER_SIZE = 20;
      if (x >= width - CORNER_SIZE && y >= height - CORNER_SIZE) {
        setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
      } else {
        if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
          setHoveredCellForExpand(null);
        }
      }
    }
  };

  const handleMouseLeave = () => {
    if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
      setHoveredCellForExpand(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only prevent fill drag when clicking on interactive elements (buttons, inputs)
    // to allow users to interact with the upload component
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input[type="file"]')) {
      return;
    }
    onCellFillDragStart(row.id, property.key, e);
  };

  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${isCellCopy ? styles.cellCopy : ''} ${cutBorderClass} ${copyBorderClass} ${selectionBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onClick={(e) => {
        // Trigger focus when clicking anywhere on the cell (single-click to edit)
        onCellFocus(row.id, property.key);

        // Always allow cell selection, even when clicking on MediaFileUpload component
        // This fixes the issue where users need to click twice to highlight the cell
        onCellClick(row.id, property.key, e);
      }}
      onContextMenu={(e) => onCellContextMenu(e, row.id, property.key)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Always show MediaFileUpload component for image/file fields */}
      <div className={styles.mediaFileUploadContainer}>
        <MediaFileUpload
          value={value || null}
          onChange={onChange}
          disabled={isSaving || userRole === 'viewer'}
          fieldType={property.dataType as 'image' | 'file'}
          onFocus={() => onCellFocus(row.id, property.key)}
          onBlur={onCellBlur}
        />
      </div>
      {/* Show expand icon for cell selection - always render, CSS controls visibility */}
      <div
        className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
        onMouseDown={(e) => onCellDragStart(row.id, property.key, e)}
      />
      {/* Show collaboration avatars in cell corner */}
      {editingUsers.length > 0 && (
        <CellPresenceAvatars users={editingUsers} />
      )}
    </td>
  );
};

