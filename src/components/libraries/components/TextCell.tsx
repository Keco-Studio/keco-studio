import React, { useRef, useEffect, useState } from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { CellKey } from '@/components/libraries/hooks/useCellSelection';
import { CellEditor } from './CellEditor';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export interface TextCellProps {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  display: string | null;
  isNameField: boolean;
  /** 当前 section 下的第一列（用于显示查看详情按钮） */
  isFirstColumn?: boolean;
  // Cell editing state
  editingCell: { rowId: string; propertyKey: string } | null;
  editingCellRef: React.MutableRefObject<HTMLSpanElement | null>;
  editingCellValue: string;
  isComposingRef: React.MutableRefObject<boolean>;
  typeValidationError: string | null;
  typeValidationErrorRef: React.MutableRefObject<HTMLDivElement | null>;
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
  onViewAssetDetail: (row: AssetRow, e: React.MouseEvent) => void;
  onCellDoubleClick: (row: AssetRow, property: PropertyConfig, e: React.MouseEvent) => void;
  onCellClick: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellContextMenu: (e: React.MouseEvent, rowId: string, propertyKey: string) => void;
  onCellFillDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellFocus: (assetId: string, propertyKey: string) => void;
  setEditingCellValue: React.Dispatch<React.SetStateAction<string>>;
  setTypeValidationError: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredCellForExpand: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  handleSaveEditedCell: () => void;
  handleCancelEditing: () => void;
  // Border classes
  getCopyBorderClasses: (rowId: string, propertyIndex: number) => string;
  getSelectionBorderClasses: (rowId: string, propertyIndex: number) => string;
}

/**
 * Text cell component for LibraryAssetsTable
 * Renders text fields with inline editing support
 */
export const TextCell: React.FC<TextCellProps> = ({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  display,
  isNameField,
  isFirstColumn = propertyIndex === 0,
  editingCell,
  editingCellRef,
  editingCellValue,
  isComposingRef,
  typeValidationError,
  typeValidationErrorRef,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
  editingUsers,
  borderColor,
  onViewAssetDetail,
  onCellDoubleClick,
  onCellClick,
  onCellContextMenu,
  onCellFillDragStart,
  onCellDragStart,
  onCellFocus,
  setEditingCellValue,
  setTypeValidationError,
  setHoveredCellForExpand,
  handleSaveEditedCell,
  handleCancelEditing,
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
  const isCellEditing = editingCell?.rowId === row.id && editingCell?.propertyKey === property.key;
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

  // Track whether text is overflowing (for conditional tooltip)
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  // Check if text is overflowing
  useEffect(() => {
    const checkOverflow = () => {
      if (textRef.current) {
        const isOverflow = textRef.current.scrollWidth > textRef.current.clientWidth;
        setIsOverflowing(isOverflow);
      }
    };

    // Check initially
    checkOverflow();

    // Use ResizeObserver to detect when cell size changes
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });

    if (textRef.current) {
      resizeObserver.observe(textRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [display]);

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

  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${cutBorderClass} ${selectionBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onDoubleClick={(e) => onCellDoubleClick(row, property, e)}
      onClick={(e) => onCellClick(row.id, property.key, e)}
      onContextMenu={(e) => onCellContextMenu(e, row.id, property.key)}
      onMouseDown={(e) => onCellFillDragStart(row.id, property.key, e)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {isCellEditing ? (
        <CellEditor
          property={property}
          editingCell={editingCell}
          editingCellRef={editingCellRef}
          editingCellValue={editingCellValue}
          isComposingRef={isComposingRef}
          typeValidationError={typeValidationError}
          typeValidationErrorRef={typeValidationErrorRef}
          setEditingCellValue={setEditingCellValue}
          setTypeValidationError={setTypeValidationError}
          handleSaveEditedCell={handleSaveEditedCell}
          handleCancelEditing={handleCancelEditing}
          handleCellFocus={onCellFocus}
        />
      ) : (
        <>
          {isFirstColumn ? (
            // First column: show text + view detail button
            <div className={styles.cellContent}>
              <Tooltip title={isOverflowing ? (display || '') : null} placement="topLeft" mouseEnterDelay={0.5}>
                <span 
                  ref={textRef}
                  className={styles.cellText}
                  onDoubleClick={(e) => {
                    // Ensure double click on first column text triggers editing
                    onCellDoubleClick(row, property, e);
                  }}
                >
                  {display || ''}
                </span>
              </Tooltip>
              <button
                className={styles.viewDetailButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewAssetDetail(row, e);
                }}
                onDoubleClick={(e) => {
                  // Prevent double click from bubbling to cell
                  e.stopPropagation();
                }}
                title={"View asset details (Ctrl/Cmd+Click for new tab)"}
              >
                <Image src={assetTableIcon}
                  alt="View"
                  width={20} height={20} className="icon-20"
                />
              </button>
            </div>
          ) : (
            // Other fields: show text only with tooltip (only if overflowing)
            <Tooltip title={isOverflowing ? (display || '') : null} placement="topLeft" mouseEnterDelay={0.5}>
              <span ref={textRef} className={styles.cellText}>
                {display || ''}
              </span>
            </Tooltip>
          )}
        </>
      )}
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

