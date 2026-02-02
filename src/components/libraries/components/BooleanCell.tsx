import React from 'react';
import { Switch } from 'antd';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { CellKey } from '@/components/libraries/hooks/useCellSelection';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export interface BooleanCellProps {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  checked: boolean;
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
  onChange: (newValue: boolean) => Promise<void>;
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
 * Boolean cell component for LibraryAssetsTable
 * Renders a switch control for boolean values with optimistic updates
 */
export const BooleanCell: React.FC<BooleanCellProps> = ({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  checked,
  userRole,
  isSaving,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
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

  const handleSwitchChange = async (newValue: boolean) => {
    // Prevent editing if user is a viewer
    if (userRole === 'viewer') {
      return;
    }

    // Keep focus during the change to show editing state
    // Blur after change is complete and propagated
    setTimeout(() => {
      onCellBlur();
    }, 1000); // Delay to let other users see the change

    await onChange(newValue);
  };

  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onClick={(e) => {
        // Trigger focus when clicking on boolean cell (single-click to edit)
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
      <div className={styles.booleanToggle}>
        <Switch
          checked={checked}
          disabled={userRole === 'viewer'}
          onChange={handleSwitchChange}
        />
        <span className={styles.booleanLabel}>
          {checked ? 'True' : 'False'}
        </span>
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

