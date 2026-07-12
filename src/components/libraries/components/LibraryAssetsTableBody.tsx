import React from 'react';
import Image from 'next/image';
import { Checkbox } from 'antd';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { getFirstUserColor } from '@/components/collaboration/StackedAvatars';
import { normalizeReferenceSelections, normalizeReferenceValueToAssetIds } from '@/lib/utils/referenceValue';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import { type CellKey } from '../hooks/useCellSelection';
import { evaluateFormulaForRow, getCustomFormulaExpressionFromCellValue } from '../utils/formulaEvaluation';
import { ReferenceField } from './ReferenceField';
import { CellPresenceAvatars } from './CellPresenceAvatars';
import { BooleanCell } from './BooleanCell';
import { EnumCell } from './EnumCell';
import { MediaCell } from './MediaCell';
import { TextCell, type TextCellProps } from './TextCell';
import { FormulaCell } from './FormulaCell';
import { AddNewRowForm } from './AddNewRowForm';
import assetTableIcon from '@/assets/images/AssetTableIcon.svg';
import libraryAssetTableAddIcon from '@/assets/images/LibraryAssetTableAddIcon.svg';
import tableAssetDetailIcon from '@/assets/images/ProjectDescIcon.svg';
import styles from '../LibraryAssetsTable.module.css';

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

type SelectionBounds = {
  minRowIndex: number;
  maxRowIndex: number;
  minPropertyIndex: number;
  maxPropertyIndex: number;
  rowIds: string[];
  propertyKeys: string[];
} | null;

type LibraryAssetsTableBodyProps = {
  displayRows: AssetRow[];
  rows: AssetRow[];
  allRowsForSelection: AssetRow[];
  properties: PropertyConfig[];
  activeProperties: PropertyConfig[];
  orderedProperties: PropertyConfig[];
  userRole: 'admin' | 'editor' | 'viewer' | null;
  isAddingRow: boolean;
  isSaving: boolean;
  newRowData: Record<string, unknown>;
  openEnumSelects: Record<string, boolean>;
  assetNamesCache: Record<string, string>;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  addRowFormRef: React.RefObject<HTMLTableRowElement>;
  hoveredRowId: string | null;
  selectedRowIds: Set<string>;
  selectedCells: Set<CellKey>;
  cutCells: Set<CellKey>;
  copyCells: Set<CellKey>;
  hoveredCellForExpand: { rowId: string; propertyKey: string } | null;
  cutSelectionBounds: SelectionBounds;
  copySelectionBounds: SelectionBounds;
  fillDragStartCell: { rowId: string; propertyKey: string; secondRowId?: string } | null;
  fillPreviewMap: Map<string, number>;
  editingCell: { rowId: string; propertyKey: string } | null;
  editingCellRef: React.MutableRefObject<HTMLSpanElement | null>;
  editingCellInitialValueRef: React.MutableRefObject<string>;
  isComposingRef: React.MutableRefObject<boolean>;
  typeValidationError: string | null;
  typeValidationErrorRef: React.MutableRefObject<HTMLDivElement | null>;
  setHoveredRowId: React.Dispatch<React.SetStateAction<string | null>>;
  setHoveredCellForExpand: React.Dispatch<React.SetStateAction<{ rowId: string; propertyKey: string } | null>>;
  setTypeValidationError: React.Dispatch<React.SetStateAction<string | null>>;
  setOpenEnumSelects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setToastMessage: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' | 'default' } | null>>;
  hasCustomRowHeight: (rowId: string) => boolean;
  getRowHeightStyle: (rowId: string) => React.CSSProperties;
  startRowResize: (rowId: string, clientY: number, rowElement: HTMLElement) => void;
  isResizingRow: boolean;
  getUsersEditingCell: (assetId: string, propertyKey: string) => EditingUser[];
  getSelectionBorderClasses: (rowId: string, propertyIndex: number) => string;
  getCutBorderClasses: (rowId: string, propertyIndex: number) => string;
  getCopyBorderClasses: (rowId: string, propertyIndex: number) => string;
  optimisticUpdates: {
    getBooleanValue: (assetId: string, propertyKey: string, row: AssetRow) => boolean;
    getEnumValue: (assetId: string, propertyKey: string, row: AssetRow) => string | null;
    updateBooleanValue: (
      assetId: string,
      propertyKey: string,
      value: boolean,
      onSuccess: () => void,
      onError: () => void
    ) => void;
    updateEnumValue: (
      assetId: string,
      propertyKey: string,
      value: string,
      onSuccess: () => void,
      onError: () => void
    ) => void;
    clearOptimisticValue: (assetId: string, propertyKey: string, type: 'boolean' | 'enum') => void;
  };
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, unknown>) => Promise<void>;
  broadcastCellUpdateIfEnabled: (assetId: string, propertyKey: string, newValue: unknown, oldValue?: unknown) => Promise<void>;
  onRowContextMenu: (event: React.MouseEvent, row: AssetRow) => void;
  onRowSelectionToggle: (rowId: string, event?: React.MouseEvent | MouseEvent) => void;
  onViewAssetDetail: (row: AssetRow, event: React.MouseEvent) => void;
  onCellFocus: (assetId: string, propertyKey: string) => void;
  onCellBlur: () => void;
  onCellClick: (rowId: string, propertyKey: string, event: React.MouseEvent) => void;
  onCellContextMenu: (event: React.MouseEvent, rowId: string, propertyKey: string) => void;
  onCellFillDragStart: (rowId: string, propertyKey: string, event: React.MouseEvent) => void;
  onCellDragStart: (rowId: string, propertyKey: string, event: React.MouseEvent) => void;
  onCellDoubleClick: (row: AssetRow, property: PropertyConfig, event: React.MouseEvent) => void;
  onEditMediaFileChange: (rowId: string, propertyKey: string, value: MediaFileMetadata | null) => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: unknown, rowId: string) => void;
  onAvatarMouseEnter: (
    assetId: string,
    element: HTMLDivElement,
    selections?: Array<{ fieldLabel?: string | null; displayValue?: string | null }>
  ) => void;
  onAvatarMouseLeave: () => void;
  openFormulaEditor: (rowId: string, propertyKey: string) => void;
  handleInputChange: (key: string, value: unknown) => void;
  handleMediaFileChange: (key: string, value: MediaFileMetadata | null) => void;
  handleSaveEditedCell: (submittedValue?: string) => void;
  handleCancelEditing: () => void;
  handleAddRowDirect: () => void;
};

export function LibraryAssetsTableBody({
  displayRows,
  rows,
  allRowsForSelection,
  properties,
  activeProperties,
  orderedProperties,
  userRole,
  isAddingRow,
  isSaving,
  newRowData,
  openEnumSelects,
  assetNamesCache,
  avatarRefs,
  addRowFormRef,
  hoveredRowId,
  selectedRowIds,
  selectedCells,
  cutCells,
  copyCells,
  hoveredCellForExpand,
  cutSelectionBounds,
  copySelectionBounds,
  fillDragStartCell,
  fillPreviewMap,
  editingCell,
  editingCellRef,
  editingCellInitialValueRef,
  isComposingRef,
  typeValidationError,
  typeValidationErrorRef,
  setHoveredRowId,
  setHoveredCellForExpand,
  setTypeValidationError,
  setOpenEnumSelects,
  setToastMessage,
  hasCustomRowHeight,
  getRowHeightStyle,
  startRowResize,
  isResizingRow,
  getUsersEditingCell,
  getSelectionBorderClasses,
  getCutBorderClasses,
  getCopyBorderClasses,
  optimisticUpdates,
  onUpdateAsset,
  broadcastCellUpdateIfEnabled,
  onRowContextMenu,
  onRowSelectionToggle,
  onViewAssetDetail,
  onCellFocus,
  onCellBlur,
  onCellClick,
  onCellContextMenu,
  onCellFillDragStart,
  onCellDragStart,
  onCellDoubleClick,
  onEditMediaFileChange,
  onOpenReferenceModal,
  onAvatarMouseEnter,
  onAvatarMouseLeave,
  openFormulaEditor,
  handleInputChange,
  handleMediaFileChange,
  handleSaveEditedCell,
  handleCancelEditing,
  handleAddRowDirect,
}: LibraryAssetsTableBodyProps) {
  return (
    <tbody className={styles.body}>
      {displayRows.map((row, index) => {
        const isRowHovered = hoveredRowId === row.id;
        const isRowSelected = selectedRowIds.has(row.id);
        const actualRowIndex = allRowsForSelection.findIndex((candidate) => candidate.id === row.id);

        return (
          <tr
            key={row.id}
            data-row-id={row.id}
            className={`${styles.row} ${isRowSelected ? styles.rowSelected : ''} ${hasCustomRowHeight(row.id) ? styles.rowCustomHeight : ''}`}
            style={getRowHeightStyle(row.id)}
            onContextMenu={(event) => {
              onRowContextMenu(event, row);
            }}
            onMouseEnter={() => setHoveredRowId(row.id)}
            onMouseLeave={() => setHoveredRowId(null)}
          >
            <td className={styles.numberCell}>
              {isRowHovered || isRowSelected ? (
                <div className={styles.checkboxContainer}>
                  <Checkbox
                    checked={isRowSelected}
                    onChange={(event) => {
                      event.stopPropagation();
                      onRowSelectionToggle(row.id, event);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                  />
                </div>
              ) : (
                <span>{index + 1}</span>
              )}
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize row"
                className={`${styles.rowResizeHandle} ${isResizingRow ? styles.rowResizeHandleActive : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const tableRow = event.currentTarget.closest('tr') as HTMLElement | null;
                  if (tableRow) {
                    startRowResize(row.id, event.clientY, tableRow);
                  }
                }}
              />
            </td>
            {activeProperties.map((property) => {
              const globalPropertyIndex = orderedProperties.findIndex((candidate) => candidate.id === property.id);
              const propertyIndex = globalPropertyIndex >= 0 ? globalPropertyIndex : 0;
              const isNameField = property.name === 'name' && property.dataType === 'string';
              const isFirstColumn = activeProperties[0]?.id === property.id;
              const editingUsers = getUsersEditingCell(row.id, property.key);
              const borderColor = getFirstUserColor(editingUsers);

              if (property.dataType === 'reference' && property.referenceLibraries) {
                const value = row.propertyValues[property.key];
                const assetIds = normalizeReferenceValueToAssetIds(value);
                const selections = normalizeReferenceSelections(value);
                const firstSelection = selections[0];
                const firstAssetId = assetIds[0] ?? null;
                const cellKey: CellKey = `${row.id}-${property.key}`;
                const isCellSelected = selectedCells.has(cellKey);

                const detailIcon = isCellSelected ? (
                  <Image
                    src={tableAssetDetailIcon}
                    alt=""
                    width={16}
                    height={16}
                    className={styles.referenceDetailIcon}
                    onMouseEnter={(event) => {
                      if (firstAssetId) {
                        event.stopPropagation();
                        const selectionsForAsset = selections
                          .filter((selection) => selection.assetId === firstAssetId)
                          .map((selection) => ({
                            fieldLabel: selection.fieldLabel,
                            displayValue: selection.displayValue,
                          }));
                        onAvatarMouseEnter(
                          firstAssetId,
                          event.currentTarget,
                          selectionsForAsset.length > 0
                            ? selectionsForAsset
                            : firstSelection
                              ? [{
                                fieldLabel: firstSelection.fieldLabel,
                                displayValue: firstSelection.displayValue,
                              }]
                              : undefined
                        );
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (firstAssetId) {
                        event.stopPropagation();
                        onAvatarMouseLeave();
                      }
                    }}
                  />
                ) : null;

                const referenceField = (
                  <ReferenceField
                    property={property}
                    assetIds={assetIds}
                    currentValue={value}
                    rowId={row.id}
                    assetNamesCache={assetNamesCache}
                    isCellSelected={isCellSelected}
                    avatarRefs={avatarRefs}
                    onAvatarMouseEnter={onAvatarMouseEnter}
                    onAvatarMouseLeave={onAvatarMouseLeave}
                    onOpenReferenceModal={onOpenReferenceModal}
                    onFocus={() => onCellFocus(row.id, property.key)}
                    onBlur={onCellBlur}
                  />
                );

                return (
                  <td
                    key={property.id}
                    data-property-key={property.key}
                    className={`${styles.cell} ${editingUsers.length > 0 ? styles.cellEditing : (selectedCells.size === 1 && isCellSelected ? styles.cellSelected : '')} ${selectedCells.size > 1 && isCellSelected && editingUsers.length === 0 ? styles.cellMultipleSelected : ''} ${cutCells.has(cellKey) ? styles.cellCut : ''} ${getCutBorderClasses(row.id, propertyIndex)} ${getSelectionBorderClasses(row.id, propertyIndex)}`}
                    style={borderColor ? { border: `2px solid ${borderColor}` } : undefined}
                    onClick={(event) => {
                      onCellFocus(row.id, property.key);
                      onCellClick(row.id, property.key, event);
                    }}
                    onContextMenu={(event) => onCellContextMenu(event, row.id, property.key)}
                    onMouseDown={(event) => onCellFillDragStart(row.id, property.key, event)}
                    onMouseEnter={(event) => {
                      if (firstAssetId && !isCellSelected) {
                        const selectionsForAsset = selections
                          .filter((selection) => selection.assetId === firstAssetId)
                          .map((selection) => ({
                            fieldLabel: selection.fieldLabel,
                            displayValue: selection.displayValue,
                          }));
                        onAvatarMouseEnter(
                          firstAssetId,
                          event.currentTarget,
                          selectionsForAsset.length > 0
                            ? selectionsForAsset
                            : firstSelection
                              ? [{
                                fieldLabel: firstSelection.fieldLabel,
                                displayValue: firstSelection.displayValue,
                              }]
                              : undefined
                        );
                      }
                    }}
                    onMouseLeave={() => {
                      if (firstAssetId && !isCellSelected) {
                        onAvatarMouseLeave();
                      }
                      if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                        setHoveredCellForExpand(null);
                      }
                    }}
                    onMouseMove={(event) => {
                      if (isCellSelected) {
                        const rect = event.currentTarget.getBoundingClientRect();
                        const x = event.clientX - rect.left;
                        const y = event.clientY - rect.top;
                        const cornerSize = 20;
                        if (x >= rect.width - cornerSize && y >= rect.height - cornerSize) {
                          setHoveredCellForExpand({ rowId: row.id, propertyKey: property.key });
                        } else if (hoveredCellForExpand?.rowId === row.id && hoveredCellForExpand?.propertyKey === property.key) {
                          setHoveredCellForExpand(null);
                        }
                      }
                    }}
                  >
                    {isFirstColumn ? (
                      <div className={styles.cellContent}>
                        {referenceField}
                        {detailIcon}
                        <button
                          className={styles.viewDetailButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewAssetDetail(row, event);
                          }}
                          onDoubleClick={(event) => event.stopPropagation()}
                          title="View asset details (Ctrl/Cmd+Click for new tab)"
                        >
                          <Image src={assetTableIcon} alt="View" width={20} height={20} className="icon-20" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {referenceField}
                        {detailIcon}
                      </>
                    )}
                    {editingUsers.length > 0 && (
                      <CellPresenceAvatars users={editingUsers} />
                    )}
                    <div
                      className={`${styles.cellExpandIcon} ${isCellSelected ? '' : styles.cellExpandIconHidden}`}
                      onMouseDown={(event) => onCellDragStart(row.id, property.key, event)}
                    />
                  </td>
                );
              }

              if (property.dataType === 'formula') {
                return (
                  <FormulaCell
                    key={property.id}
                    row={row}
                    property={property}
                    propertyIndex={propertyIndex}
                    actualRowIndex={actualRowIndex}
                    properties={properties}
                    isFirstColumn={isFirstColumn}
                    isSaving={isSaving}
                    selectedCells={selectedCells}
                    cutCells={cutCells}
                    copyCells={copyCells}
                    hoveredCellForExpand={hoveredCellForExpand}
                    cutSelectionBounds={cutSelectionBounds}
                    editingUsers={editingUsers}
                    borderColor={borderColor}
                    evaluateFormulaForRow={evaluateFormulaForRow}
                    getCustomFormulaExpressionFromCellValue={getCustomFormulaExpressionFromCellValue}
                    openFormulaEditor={openFormulaEditor}
                    onViewAssetDetail={onViewAssetDetail}
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

              if (
                property.dataType === 'image' ||
                property.dataType === 'file' ||
                property.dataType === 'multimedia' ||
                property.dataType === 'audio'
              ) {
                const value = row.propertyValues[property.key];
                let mediaValue: MediaFileMetadata | null = null;

                if (value) {
                  if (typeof value === 'string') {
                    try {
                      mediaValue = JSON.parse(value) as MediaFileMetadata;
                    } catch {
                      mediaValue = null;
                    }
                  } else if (typeof value === 'object') {
                    mediaValue = value as MediaFileMetadata;
                  }
                }

                return (
                  <MediaCell
                    key={property.id}
                    row={row}
                    property={property}
                    propertyIndex={propertyIndex}
                    actualRowIndex={actualRowIndex}
                    value={mediaValue}
                    userRole={userRole}
                    isSaving={isSaving}
                    selectedCells={selectedCells}
                    cutCells={cutCells}
                    copyCells={copyCells}
                    hoveredCellForExpand={hoveredCellForExpand}
                    cutSelectionBounds={cutSelectionBounds}
                    copySelectionBounds={copySelectionBounds}
                    editingUsers={editingUsers}
                    borderColor={borderColor}
                    onChange={(mediaFile) => onEditMediaFileChange(row.id, property.key, mediaFile)}
                    onCellClick={onCellClick}
                    onCellContextMenu={onCellContextMenu}
                    onCellFillDragStart={onCellFillDragStart}
                    onCellDragStart={onCellDragStart}
                    onCellFocus={onCellFocus}
                    onCellBlur={onCellBlur}
                    setHoveredCellForExpand={setHoveredCellForExpand}
                    getCopyBorderClasses={getCopyBorderClasses}
                    getSelectionBorderClasses={getSelectionBorderClasses}
                    isFirstColumn={isFirstColumn}
                    onViewAssetDetail={onViewAssetDetail}
                    onShowToast={(message, type = 'error') => {
                      setToastMessage({ message, type });
                      setTimeout(() => setToastMessage(null), 2000);
                    }}
                  />
                );
              }

              if (property.dataType === 'boolean') {
                const checked = optimisticUpdates.getBooleanValue(row.id, property.key, row);

                return (
                  <BooleanCell
                    key={property.id}
                    row={row}
                    property={property}
                    propertyIndex={propertyIndex}
                    actualRowIndex={actualRowIndex}
                    checked={checked}
                    userRole={userRole}
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
                    onChange={async (newValue) => {
                      if (userRole === 'viewer' || !onUpdateAsset) return;

                      optimisticUpdates.updateBooleanValue(
                        row.id,
                        property.key,
                        newValue,
                        () => {},
                        () => {
                          optimisticUpdates.clearOptimisticValue(row.id, property.key, 'boolean');
                        }
                      );

                      try {
                        const oldValue = row.propertyValues[property.key];
                        const updatedPropertyValues = {
                          ...row.propertyValues,
                          [property.key]: newValue,
                        };
                        await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                        await broadcastCellUpdateIfEnabled(row.id, property.key, newValue, oldValue);
                      } catch (error) {
                        optimisticUpdates.clearOptimisticValue(row.id, property.key, 'boolean');
                        console.error('Failed to update boolean value:', error);
                      }
                    }}
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

              if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
                const value = optimisticUpdates.getEnumValue(row.id, property.key, row);
                const enumSelectKey = `${row.id}-${property.key}`;
                const isOpen = openEnumSelects[enumSelectKey] || false;

                return (
                  <EnumCell
                    key={property.id}
                    row={row}
                    property={property}
                    propertyIndex={propertyIndex}
                    actualRowIndex={actualRowIndex}
                    value={value}
                    userRole={userRole}
                    isOpen={isOpen}
                    selectedCells={selectedCells}
                    cutCells={cutCells}
                    copyCells={copyCells}
                    hoveredCellForExpand={hoveredCellForExpand}
                    cutSelectionBounds={cutSelectionBounds}
                    editingUsers={editingUsers}
                    borderColor={borderColor}
                    isFirstColumn={isFirstColumn}
                    onViewAssetDetail={onViewAssetDetail}
                    onChange={async (newValue) => {
                      if (userRole === 'viewer' || !onUpdateAsset) return;

                      optimisticUpdates.updateEnumValue(
                        row.id,
                        property.key,
                        newValue,
                        () => {},
                        () => {
                          optimisticUpdates.clearOptimisticValue(row.id, property.key, 'enum');
                        }
                      );

                      try {
                        const oldValue = row.propertyValues[property.key];
                        const updatedPropertyValues = {
                          ...row.propertyValues,
                          [property.key]: newValue,
                        };
                        await onUpdateAsset(row.id, row.name, updatedPropertyValues);
                        await broadcastCellUpdateIfEnabled(row.id, property.key, newValue, oldValue);
                      } catch (error) {
                        optimisticUpdates.clearOptimisticValue(row.id, property.key, 'enum');
                        console.error('Failed to update enum value:', error);
                      }
                    }}
                    onOpenChange={(open) => {
                      if (userRole === 'viewer') return;

                      if (open) {
                        onCellFocus(row.id, property.key);
                      } else {
                        setTimeout(() => {
                          onCellBlur();
                        }, 1000);
                      }

                      setOpenEnumSelects((prev) => ({
                        ...prev,
                        [enumSelectKey]: open,
                      }));
                    }}
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

              const value = row.propertyValues[property.key];
              let display: string | null = null;
              if (
                value !== null &&
                value !== undefined &&
                value !== '' &&
                !(typeof value === 'number' && Number.isNaN(value))
              ) {
                if (
                  (property.dataType === 'int_array' ||
                    property.dataType === 'float_array') &&
                  Array.isArray(value)
                ) {
                  display = `[${value.join(',')}]`;
                } else if (
                  property.dataType === 'string_array' &&
                  Array.isArray(value)
                ) {
                  display = `[${value.map((item) => JSON.stringify(item)).join(',')}]`;
                } else {
                  display = cellDisplayString(value);
                }
              }

              const fillPreviewValue: TextCellProps['fillPreviewValue'] =
                property.dataType === 'int' && fillDragStartCell?.propertyKey === property.key
                  ? fillPreviewMap.get(row.id)
                  : undefined;

              return (
                <TextCell
                  key={property.id}
                  row={row}
                  property={property}
                  propertyIndex={propertyIndex}
                  actualRowIndex={actualRowIndex}
                  display={display}
                  isNameField={isNameField}
                  isFirstColumn={isFirstColumn}
                  fillPreviewValue={fillPreviewValue}
                  editingCell={editingCell}
                  editingCellRef={editingCellRef}
                  editingCellInitialValueRef={editingCellInitialValueRef}
                  isComposingRef={isComposingRef}
                  typeValidationError={typeValidationError}
                  typeValidationErrorRef={typeValidationErrorRef}
                  selectedCells={selectedCells}
                  cutCells={cutCells}
                  copyCells={copyCells}
                  hoveredCellForExpand={hoveredCellForExpand}
                  cutSelectionBounds={cutSelectionBounds}
                  editingUsers={editingUsers}
                  borderColor={borderColor}
                  onViewAssetDetail={onViewAssetDetail}
                  onCellDoubleClick={onCellDoubleClick}
                  onCellClick={onCellClick}
                  onCellContextMenu={onCellContextMenu}
                  onCellFillDragStart={onCellFillDragStart}
                  onCellDragStart={onCellDragStart}
                  onCellFocus={onCellFocus}
                  setTypeValidationError={setTypeValidationError}
                  setHoveredCellForExpand={setHoveredCellForExpand}
                  handleSaveEditedCell={handleSaveEditedCell}
                  handleCancelEditing={handleCancelEditing}
                  getCopyBorderClasses={getCopyBorderClasses}
                  getSelectionBorderClasses={getSelectionBorderClasses}
                />
              );
            })}
            {(userRole === 'admin' || userRole === 'editor') && (
              <td className={styles.addColumnCell} />
            )}
          </tr>
        );
      })}
      {isAddingRow ? (
        <tr className={styles.editRow} ref={addRowFormRef}>
          <td className={styles.numberCell}>{rows.length + 1}</td>
          <AddNewRowForm
            orderedProperties={activeProperties}
            newRowData={newRowData}
            isSaving={isSaving}
            userRole={userRole}
            openEnumSelects={openEnumSelects}
            assetNamesCache={assetNamesCache}
            avatarRefs={avatarRefs}
            handleInputChange={handleInputChange}
            handleMediaFileChange={handleMediaFileChange}
            handleOpenReferenceModal={onOpenReferenceModal}
            handleAvatarMouseEnter={onAvatarMouseEnter}
            handleAvatarMouseLeave={onAvatarMouseLeave}
            setOpenEnumSelects={setOpenEnumSelects}
          />
          {(userRole === 'admin' || userRole === 'editor') && (
            <td className={styles.addColumnCell} />
          )}
        </tr>
      ) : (userRole === 'admin' || userRole === 'editor') ? (
        <tr
          className={styles.addRow}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const isClickOnNumberCell = target.closest(`.${styles.numberCell}`);
            const isClickOnButton = target.closest(`.${styles.addButton}`);

            if (!isClickOnNumberCell && !isClickOnButton && target.tagName === 'TD') {
              if (editingCell) {
                alert('Please finish editing the current cell first.');
                return;
              }
              handleAddRowDirect();
            }
          }}
          style={{ cursor: 'pointer' }}
        >
          <td
            className={styles.numberCell}
            onClick={() => {
              if (editingCell) {
                alert('Please finish editing the current cell first.');
                return;
              }
              handleAddRowDirect();
            }}
            style={{ cursor: 'pointer' }}
          >
            <button
              className={styles.addButton}
              onClick={(event) => {
                event.stopPropagation();
                if (editingCell) {
                  alert('Please finish editing the current cell first.');
                  return;
                }
                handleAddRowDirect();
              }}
              disabled={editingCell !== null}
            >
              <Image
                src={libraryAssetTableAddIcon}
                alt="Add new asset"
                width={16}
                height={16}
                className="icon-16"
              />
            </button>
          </td>
          {activeProperties.map((property) => (
            <td key={property.id} className={styles.cell}></td>
          ))}
          <td className={styles.addColumnCell} />
        </tr>
      ) : null}
    </tbody>
  );
}
