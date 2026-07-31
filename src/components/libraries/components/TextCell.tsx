import React, { useRef } from 'react';
import Image from 'next/image';
import { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { CellKey } from '@/components/libraries/hooks/useCellSelection';
import { CellEditor } from './CellEditor';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';
import type { ExpandedTextCell } from '@/components/libraries/utils/textCellExpand';

export interface TextCellProps {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  display: string | null;
  isNameField: boolean;
  /** First column in the current section, used to show the detail button. */
  isFirstColumn?: boolean;
  // Cell editing state
  editingCell: { rowId: string; propertyKey: string } | null;
  editingCellRef: React.MutableRefObject<HTMLSpanElement | null>;
  editingCellInitialValueRef: React.MutableRefObject<string>;
  isComposingRef: React.MutableRefObject<boolean>;
  typeValidationError: string | null;
  typeValidationErrorRef: React.MutableRefObject<HTMLDivElement | null>;
  // Cell selection state
  selectedCells: Set<CellKey>;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
  hoveredCellForExpand: { rowId: string; propertyKey: string } | null;
  expandedTextCell: ExpandedTextCell;
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
  isSearchHit?: boolean;
  // Event handlers
  onViewAssetDetail: (row: AssetRow, e: React.MouseEvent) => void;
  onCellDoubleClick: (row: AssetRow, property: PropertyConfig, e: React.MouseEvent) => void;
  onCellClick: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onTextCellExpandClick: (rowId: string, propertyKey: string, isOverflowing: boolean) => void;
  onCellContextMenu: (e: React.MouseEvent, rowId: string, propertyKey: string) => void;
  onCellFillDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellFocus: (assetId: string, propertyKey: string) => void;
  setTypeValidationError: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredCellForExpand: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  handleSaveEditedCell: (submittedValue?: string) => void;
  handleCancelEditing: () => void;
  // Border classes
  getCopyBorderClasses: (rowId: string, propertyIndex: number) => string;
  getSelectionBorderClasses: (rowId: string, propertyIndex: number) => string;
  /** Preview value shown while drag-filling int columns. */
  fillPreviewValue?: number;
}

/**
 * Text cell component for LibraryAssetsTable
 * Renders text fields with inline editing support
 */
const TextCellComponent: React.FC<TextCellProps> = ({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  display,
  isNameField: _isNameField,
  isFirstColumn = propertyIndex === 0,
  fillPreviewValue,
  editingCell,
  editingCellRef,
  editingCellInitialValueRef,
  isComposingRef,
  typeValidationError,
  typeValidationErrorRef,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  expandedTextCell,
  cutSelectionBounds,
  editingUsers,
  borderColor,
  isSearchHit = false,
  onViewAssetDetail,
  onCellDoubleClick,
  onCellClick,
  onTextCellExpandClick,
  onCellContextMenu,
  onCellFillDragStart,
  onCellDragStart,
  onCellFocus,
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
  const showFillPreview = fillPreviewValue !== undefined && !isCellEditing;
  const cellDisplay = showFillPreview ? String(fillPreviewValue) : (display || '');
  const isRowTextExpanded = expandedTextCell?.rowId === row.id;

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

  const textRef = useRef<HTMLSpanElement>(null);

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

  const measureOverflow = (): boolean => {
    const el = textRef.current;
    if (!el) return false;
    // When already expanded, text wraps so scrollWidth may match clientWidth.
    // Treat the triggering cell as still "overflowing" for toggle semantics via expand state.
    if (
      expandedTextCell?.rowId === row.id &&
      expandedTextCell?.propertyKey === property.key
    ) {
      return true;
    }
    return el.scrollWidth > el.clientWidth + 1;
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isCellEditing) {
      return;
    }
    onCellClick(row.id, property.key, e);
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('.ant-checkbox') ||
      target.closest('.ant-select') ||
      target.closest('.ant-switch') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest(`.${styles.cellExpandIcon}`)
    ) {
      return;
    }
    onTextCellExpandClick(row.id, property.key, measureOverflow());
  };

  const isError = !!typeValidationError && isCellEditing;

  const textSpan = (
    <span
      ref={textRef}
      className={`${styles.cellText} ${showFillPreview ? styles.cellFillPreview : ''} ${isRowTextExpanded ? styles.cellTextExpanded : ''}`}
      onDoubleClick={(e) => {
        if (isFirstColumn) {
          onCellDoubleClick(row, property, e);
        }
      }}
    >
      {cellDisplay}
    </span>
  );

  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${isSearchHit ? styles.searchCellHit : ''} ${isBeingEdited ? styles.cellEditing : (isSingleSelected ? styles.cellSelected : '')} ${isMultipleSelected && !isBeingEdited ? styles.cellMultipleSelected : ''} ${isCellCut ? styles.cellCut : ''} ${isError ? styles.cellError : ''} ${cutBorderClass} ${selectionBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onDoubleClick={(e) => onCellDoubleClick(row, property, e)}
      onClick={handleClick}
      onContextMenu={(e) => onCellContextMenu(e, row.id, property.key)}
      onMouseDown={(e) => {
        if (isCellEditing) return;
        onCellFillDragStart(row.id, property.key, e);
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {isCellEditing ? (
        <CellEditor
          property={property}
          editingCell={editingCell}
          editingCellRef={editingCellRef}
          initialValue={editingCellInitialValueRef.current}
          isComposingRef={isComposingRef}
          typeValidationError={typeValidationError}
          typeValidationErrorRef={typeValidationErrorRef}
          setTypeValidationError={setTypeValidationError}
          handleSaveEditedCell={handleSaveEditedCell}
          handleCancelEditing={handleCancelEditing}
          handleCellFocus={onCellFocus}
        />
      ) : (
        <>
          {isFirstColumn ? (
            <div className={styles.cellContent}>
              {textSpan}
              <button
                className={styles.viewDetailButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewAssetDetail(row, e);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                }}
                title={"View asset details"}
              >
                <Image src={assetTableIcon}
                  alt="View"
                  width={20} height={20} className="icon-20"
                />
              </button>
            </div>
          ) : (
            textSpan
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

export const TextCell = React.memo(TextCellComponent);
