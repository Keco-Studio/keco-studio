import React from 'react';
import { Select } from 'antd';
import Image from 'next/image';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { CellKey } from '@/components/libraries/hooks/useCellSelection';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import libraryAssetTableSelectIcon from '@/assets/images/LibraryAssetTableSelectIcon.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export interface EnumCellProps {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  value: string | null;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  isOpen: boolean;
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
  onChange: (newValue: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
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
 * Enum/Select cell component for LibraryAssetsTable
 * Renders a select dropdown for enum values with optimistic updates
 */
export const EnumCell: React.FC<EnumCellProps> = ({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  value,
  userRole,
  isOpen,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
  editingUsers,
  borderColor,
  onChange,
  onOpenChange,
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

  const handleOpenChange = (open: boolean) => {
    // Prevent opening if user is a viewer
    if (userRole === 'viewer') {
      return;
    }

    // Trigger focus when opening dropdown to show editing state
    if (open) {
      onCellFocus(row.id, property.key);
    } else {
      // Delay blur when closing dropdown to let other users see the change
      setTimeout(() => {
        onCellBlur();
      }, 1000);
    }

    onOpenChange(open);
  };

  const handleChange = async (newValue: string) => {
    // Prevent editing if user is a viewer
    if (userRole === 'viewer') {
      return;
    }

    await onChange(newValue || '');

    // Close dropdown (blur will be triggered by onOpenChange)
    onOpenChange(false);
  };

  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onClick={(e) => {
        // Trigger focus when clicking on enum cell (single-click to edit)
        if (userRole !== 'viewer') {
          onCellFocus(row.id, property.key);
        }
        onCellClick(row.id, property.key, e);
      }}
      onContextMenu={(e) => onCellContextMenu(e, row.id, property.key)}
      onMouseDown={(e) => onCellFillDragStart(row.id, property.key, e)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div className={styles.enumSelectWrapper}>
        <Select
          value={value || undefined}
          placeholder="Select"
          open={isOpen}
          disabled={userRole === 'viewer'}
          onOpenChange={handleOpenChange}
          onChange={handleChange}
          className={styles.enumSelectDisplay}
          suffixIcon={null}
          getPopupContainer={() => document.body}
        >
          {property.enumOptions?.map((option) => (
            <Select.Option key={option} value={option} title="">
              {option}
            </Select.Option>
          ))}
        </Select>
        <Image
          src={libraryAssetTableSelectIcon}
          alt=""
          width={16}
          height={16}
          className={styles.enumSelectIcon}
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(!isOpen);
          }}
        />
      </div>
      {/* Show collaboration avatars in cell corner */}
      {editingUsers.length > 0 && (
        <CellPresenceAvatars users={editingUsers} />
      )}
      {/* Show expand icon for cell selection - always render, CSS controls visibility */}
      <div
        className={`${styles.cellExpandIcon} ${shouldShowExpandIcon ? '' : styles.cellExpandIconHidden}`}
        onMouseDown={(e) => onCellDragStart(row.id, property.key, e)}
      />
    </td>
  );
};

