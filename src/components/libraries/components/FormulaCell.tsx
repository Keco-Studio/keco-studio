import React from 'react';
import Image from 'next/image';
import { Tooltip } from 'antd';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { CellKey } from '@/components/libraries/hooks/useCellSelection';
import formulaIcon from '@/assets/images/formula.svg';
import { BooleanCell } from './BooleanCell';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

type EditingUser = {
  userId: string;
  userName: string;
  userEmail: string;
  avatarColor: string;
  activeCell: { assetId: string; propertyKey: string } | null;
  cursorPosition: { row: number; col: number } | null;
  lastActivity: string;
  connectionStatus: 'online' | 'away';
};

type FormulaCellProps = {
  row: AssetRow;
  property: PropertyConfig;
  propertyIndex: number;
  actualRowIndex: number;
  properties: PropertyConfig[];
  isFirstColumn: boolean;
  isSaving: boolean;
  selectedCells: Set<CellKey>;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
  hoveredCellForExpand: { rowId: string; propertyKey: string } | null;
  cutSelectionBounds: {
    minRowIndex: number;
    maxRowIndex: number;
    minPropertyIndex: number;
    maxPropertyIndex: number;
    rowIds: string[];
    propertyKeys: string[];
  } | null;
  editingUsers: EditingUser[];
  borderColor?: string;
  evaluateFormulaForRow: (
    expression: string | undefined,
    row: AssetRow,
    allProperties: PropertyConfig[],
    visited?: Set<string>
  ) => any | null;
  getCustomFormulaExpressionFromCellValue: (rawValue: unknown) => string | null;
  openFormulaEditor: (rowId: string, propertyKey: string) => void;
  onViewAssetDetail: (row: AssetRow, e: React.MouseEvent) => void;
  onCellClick: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellContextMenu: (e: React.MouseEvent, rowId: string, propertyKey: string) => void;
  onCellFillDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellDragStart: (rowId: string, propertyKey: string, e: React.MouseEvent) => void;
  onCellFocus: (assetId: string, propertyKey: string) => void;
  onCellBlur: () => void;
  setHoveredCellForExpand: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  getCopyBorderClasses: (rowId: string, propertyIndex: number) => string;
  getSelectionBorderClasses: (rowId: string, propertyIndex: number) => string;
};

export function FormulaCell({
  row,
  property,
  propertyIndex,
  actualRowIndex,
  properties,
  isFirstColumn,
  isSaving,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
  editingUsers,
  borderColor,
  evaluateFormulaForRow,
  getCustomFormulaExpressionFromCellValue,
  openFormulaEditor,
  onViewAssetDetail,
  onCellClick,
  onCellContextMenu,
  onCellFillDragStart,
  onCellDragStart,
  onCellFocus,
  onCellBlur,
  setHoveredCellForExpand,
  getCopyBorderClasses,
  getSelectionBorderClasses,
}: FormulaCellProps) {
  const cellKey: CellKey = `${row.id}-${property.key}`;
  const isCellSelected = selectedCells.has(cellKey);
  const customFormulaExpression = getCustomFormulaExpressionFromCellValue(row.propertyValues[property.key]);
  const effectiveFormulaExpression = customFormulaExpression ?? property.formulaExpression;
  const formulaResult = evaluateFormulaForRow(effectiveFormulaExpression, row, properties);
  const selectionBorderClass = getSelectionBorderClasses(row.id, propertyIndex);
  const copyBorderClass = getCopyBorderClasses(row.id, propertyIndex);

  if (typeof formulaResult === 'boolean') {
    return (
      <BooleanCell
        key={property.id}
        row={row}
        property={property}
        propertyIndex={propertyIndex}
        actualRowIndex={actualRowIndex}
        checked={formulaResult}
        userRole="viewer"
        isSaving={isSaving}
        selectedCells={selectedCells}
        cutCells={cutCells}
        copyCells={copyCells}
        hoveredCellForExpand={hoveredCellForExpand}
        cutSelectionBounds={cutSelectionBounds}
        editingUsers={editingUsers}
        borderColor={borderColor}
        isFirstColumn={isFirstColumn}
        onViewAssetDetail={onViewAssetDetail}
        onChange={async () => {}}
        onCellClick={onCellClick}
        onCellContextMenu={onCellContextMenu}
        onCellFillDragStart={onCellFillDragStart}
        onCellDragStart={onCellDragStart}
        onCellFocus={onCellFocus}
        onCellBlur={onCellBlur}
        setHoveredCellForExpand={setHoveredCellForExpand}
        getCopyBorderClasses={getCopyBorderClasses}
        getSelectionBorderClasses={getSelectionBorderClasses}
      />
    );
  }

  const display = formulaResult === null ? '' : String(formulaResult);
  return (
    <td
      key={property.id}
      data-property-key={property.key}
      className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellEditing : (selectedCells.size === 1 && isCellSelected ? styles.cellSelected : '')} ${selectedCells.size > 1 && isCellSelected && editingUsers.length === 0 ? styles.cellMultipleSelected : ''} ${cutCells.has(cellKey) ? styles.cellCut : ''} ${selectionBorderClass} ${copyBorderClass}`}
      style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
      onClick={(e) => {
        onCellFocus(row.id, property.key);
        onCellClick(row.id, property.key, e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        openFormulaEditor(row.id, property.key);
      }}
      onContextMenu={(e) => onCellContextMenu(e, row.id, property.key)}
      onMouseDown={(e) => onCellFillDragStart(row.id, property.key, e)}
    >
      <span className={`${styles.cellText} ${customFormulaExpression ? styles.customFormulaValue : ''}`}>
        {display}
      </span>
      {customFormulaExpression && (
        <Tooltip title={customFormulaExpression.replace(/^=/, '')} placement="top">
          <Image
            src={formulaIcon}
            alt="Custom formula"
            width={16}
            height={16}
            className={styles.customFormulaIcon}
          />
        </Tooltip>
      )}
      {editingUsers.length > 0 && <CellPresenceAvatars users={editingUsers} />}
      <div
        className={`${styles.cellExpandIcon} ${isCellSelected ? '' : styles.cellExpandIconHidden}`}
        onMouseDown={(e) => onCellDragStart(row.id, property.key, e)}
      />
    </td>
  );
}

