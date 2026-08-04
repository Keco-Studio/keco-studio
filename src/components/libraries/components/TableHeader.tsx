'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Checkbox, Tooltip } from 'antd';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { deleteLibraryField, updateLibraryField } from '@/lib/services/libraryAssetsService';
import { invalidateLibrarySchemaData } from '@/lib/queryInvalidation';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import { EditColumnModal } from './EditColumnModal';
import { ColumnValueFilterPopover } from './ColumnValueFilterPopover';
import { NUMBER_COLUMN_KEY } from '../hooks/useTableResize';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';
import libraryAssetTableSelectIcon from '@/assets/images/LibraryAssetTableSelectIcon2.svg';
import addColumIcon from '@/assets/images/addColumIcon.svg';
import descriptionIcon from '@/assets/images/descriptionIcon.svg';

function EllipsisTextWithTooltip({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const spanRef = useRef<HTMLSpanElement | null>(null);
  const [isOverflowed, setIsOverflowed] = useState(false);

  const checkOverflow = () => {
    const el = spanRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth + 1;
    setIsOverflowed(hasOverflow);
  };

  useEffect(() => {
    checkOverflow();
  }, [text]);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        checkOverflow();
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener('resize', checkOverflow);
    return () => {
      window.removeEventListener('resize', checkOverflow);
    };
  }, []);

  const span = (
    <span ref={spanRef} className={className}>
      {text}
    </span>
  );

  if (!isOverflowed) {
    return span;
  }

  return (
    <Tooltip title={text} placement="top">
      {span}
    </Tooltip>
  );
}

function ColumnResizeHandle({
  columnKey,
  onColumnResizeStart,
  isResizingColumn,
}: {
  columnKey: string;
  onColumnResizeStart?: (columnKey: string, clientX: number, element: HTMLElement) => void;
  isResizingColumn?: boolean;
}) {
  if (!onColumnResizeStart) return null;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      className={`${styles.columnResizeHandle} ${isResizingColumn ? styles.columnResizeHandleActive : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onColumnResizeStart(columnKey, e.clientX, e.currentTarget.parentElement as HTMLElement);
      }}
    />
  );
}

export type TableHeaderProps = {
  properties: PropertyConfig[];
  allRowsSelected: boolean;
  hasSomeRowsSelected: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  /** All fields in the current library, used for duplicate-name validation in EditColumnModal. */
  existingProperties?: PropertyConfig[];
  /** Whether to show the "add column" button column at the right side of header */
  showAddColumn?: boolean;
  /** Click handler for the "add column" header button */
  onAddColumnClick?: () => void;
  /** Ref for the add column button (used to position the popup below it) */
  addColumnButtonRef?: React.RefObject<HTMLButtonElement | null>;
  /** Start dragging a column resize handle */
  onColumnResizeStart?: (columnKey: string, clientX: number, element: HTMLElement) => void;
  /** Whether a column is currently being resized */
  isResizingColumn?: boolean;
  /** Table rows used to collect unique column values for filtering */
  rows?: AssetRow[];
  /** Apply a value filter for a column (all selected removes the filter) */
  onApplyColumnFilter?: (
    propertyId: string,
    selectedValues: Set<string>,
    allValues: Set<string>
  ) => void;
  /** Whether a column currently has an active value filter */
  isColumnFiltered?: (propertyId: string) => boolean;
  /** Checked values derived from row visibility (synced across columns) */
  getCheckedFilterValues?: (propertyId: string) => Set<string>;
  /** Resolved reference labels (same cache as table chips) */
  assetNamesCache?: Record<string, string>;
  /** Merge freshly resolved reference labels into the shared cache */
  onMergeAssetNamesCache?: (patch: Record<string, string>) => void;
};

export function TableHeader({
  properties,
  allRowsSelected,
  hasSomeRowsSelected,
  onToggleSelectAll,
  existingProperties,
  showAddColumn = false,
  onAddColumnClick,
  addColumnButtonRef,
  onColumnResizeStart,
  isResizingColumn = false,
  rows = [],
  onApplyColumnFilter,
  isColumnFiltered,
  getCheckedFilterValues,
  assetNamesCache = {},
  onMergeAssetNamesCache,
}: TableHeaderProps) {
  const supabase = useSupabase();
  const params = useParams();
  const queryClient = useQueryClient();
  const libraryId = params?.libraryId as string | undefined;
   const projectId = params?.projectId as string | undefined;

  const [headerMenu, setHeaderMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    popupAnchorX?: number;
    canDeleteColumn?: boolean;
    propertyId?: string;
    propertyName?: string;
    propertyDescription?: string | null;
    propertyDataType?: PropertyConfig['dataType'];
    propertyEnumOptions?: string[];
    propertyReferenceLibraries?: string[];
    propertyFormulaExpression?: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    propertyId: undefined,
    propertyName: undefined,
    propertyDescription: undefined,
    propertyDataType: undefined,
    propertyEnumOptions: undefined,
    propertyReferenceLibraries: undefined,
    propertyFormulaExpression: undefined,
    canDeleteColumn: false,
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [deleteColumnConfirm, setDeleteColumnConfirm] = useState<{
    open: boolean;
    propertyId?: string;
    propertyName?: string;
    loading?: boolean;
  }>({
    open: false,
    propertyId: undefined,
    propertyName: undefined,
    loading: false,
  });

  const [editTarget, setEditTarget] = useState<{
    open: boolean;
    propertyId?: string;
    propertyName?: string;
    propertyDescription?: string | null;
    propertyDataType?: PropertyConfig['dataType'];
    propertyEnumOptions?: string[];
    propertyReferenceLibraries?: string[];
    propertyFormulaExpression?: string;
    anchorX?: number;
    anchorY?: number;
  }>({
    open: false,
  });

  const [filterTarget, setFilterTarget] = useState<{
    open: boolean;
    property?: PropertyConfig;
    anchorRect?: DOMRect;
  }>({
    open: false,
  });

  // Close the floating menu on outside pointer down; capture phase bypasses inner stopPropagation.
  useEffect(() => {
    if (!headerMenu.visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setHeaderMenu((prev) => ({ ...prev, visible: false }));
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [headerMenu.visible]);

  // Close only the small header context menu when scroll or wheel events occur.
  useEffect(() => {
    if (!headerMenu.visible) return;
    const handleScroll = () => {
      setHeaderMenu((prev) => ({ ...prev, visible: false }));
    };
    window.addEventListener('wheel', handleScroll);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('wheel', handleScroll);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [headerMenu.visible]);

  const openColumnFilter = (anchorEl: HTMLDivElement, property: PropertyConfig) => {
    const rect = anchorEl.getBoundingClientRect();
    setFilterTarget({
      open: true,
      property,
      anchorRect: rect,
    });
  };

  const openHeaderMenu = (
    anchorEl: HTMLDivElement,
    property: PropertyConfig,
    propertyCount: number,
  ) => {
    const rect = anchorEl.getBoundingClientRect();
    setHeaderMenu({
      visible: true,
      // Align panel's right edge with current column's right edge.
      x: rect.right,
      y: rect.bottom + 8,
      popupAnchorX: rect.right,
      canDeleteColumn: propertyCount > 1,
      propertyId: property.id,
      propertyName: property.name,
      propertyDescription: property.description,
      propertyDataType: property.dataType,
      propertyEnumOptions: property.enumOptions,
      propertyReferenceLibraries: property.referenceLibraries,
      propertyFormulaExpression: property.formulaExpression,
    });
  };

  const header = (
    <thead>
      <tr className={styles.headerRowBottom}>
        <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
          <div className={styles.checkboxContainer}>
            <Checkbox
              checked={allRowsSelected}
              indeterminate={hasSomeRowsSelected && !allRowsSelected}
              onChange={(e) => onToggleSelectAll(e.target.checked)}
            />
          </div>
          <ColumnResizeHandle
            columnKey={NUMBER_COLUMN_KEY}
            onColumnResizeStart={onColumnResizeStart}
            isResizingColumn={isResizingColumn}
          />
        </th>
        {properties.map((property) => (
            <th
              key={property.id}
              scope="col"
              className={`${styles.headerCell} ${styles.propertyHeaderCell}`}
            >
              <div
                className={styles.propertyHeaderContent}
                data-property-header-id={property.id}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openHeaderMenu(
                    e.currentTarget as HTMLDivElement,
                    property,
                    properties.length,
                  );
                }}
              >
                <div className={styles.propertyHeaderMain}>
                  <Tooltip
                    title={FIELD_TYPE_OPTIONS.find((opt) => opt.value === property.dataType)?.label || property.dataType}
                    placement="top"
                  >
                    <Image
                      src={getFieldTypeIcon(property.dataType as any)}
                      alt={property.dataType}
                      width={16}
                      height={16}
                      className={styles.propertyHeaderTypeIcon}
                    />
                  </Tooltip>
                  <div className={styles.propertyHeaderNameGroup}>
                    <EllipsisTextWithTooltip
                      text={property.name}
                      className={styles.propertyHeaderText}
                    />
                    {onApplyColumnFilter && (
                      <Tooltip
                        title={isColumnFiltered?.(property.id) ? 'Column filter active' : 'Filter by values'}
                        placement="top"
                      >
                        <button
                          type="button"
                          className={`${styles.columnFilterButton} ${
                            isColumnFiltered?.(property.id) ? styles.columnFilterButtonActive : ''
                          }`}
                          aria-label={
                            isColumnFiltered?.(property.id) ? 'Column filter active' : 'Filter by values'
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            const contentEl = (e.currentTarget as HTMLElement).closest(
                              `.${styles.propertyHeaderContent}`
                            ) as HTMLDivElement | null;
                            if (contentEl) {
                              openColumnFilter(contentEl, property);
                            }
                          }}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            aria-hidden="true"
                            className={styles.columnFilterIcon}
                          >
                            <line
                              x1="1"
                              y1="2.5"
                              x2="11"
                              y2="2.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                            <line
                              x1="2.5"
                              y1="6"
                              x2="9.5"
                              y2="6"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                            <line
                              x1="4"
                              y1="9.5"
                              x2="8"
                              y2="9.5"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div className={styles.properIconContent}>
                  {property.description && (
                    <Tooltip title={property.description} placement="top">
                      <Image
                        src={descriptionIcon}
                        alt=""
                        width={16}
                        height={16}
                        className={styles.propertyHeaderIcon}
                      />
                    </Tooltip>
                  )}
                  <div
                    className={styles.propertyHeaderIconWrapper}
                    onClick={(e) => {
                      e.stopPropagation();
                      const contentEl = (e.currentTarget as HTMLElement).closest(
                        `.${styles.propertyHeaderContent}`
                      ) as HTMLDivElement | null;
                      if (contentEl) {
                        openHeaderMenu(contentEl, property, properties.length);
                      }
                    }}
                  >
                    <Image
                      src={libraryAssetTableSelectIcon}
                      alt=""
                      width={16}
                      height={16}
                      className={styles.enumSelectIcon}
                    />
                  </div>
                </div>
              </div>
              <ColumnResizeHandle
                columnKey={property.id}
                onColumnResizeStart={onColumnResizeStart}
                isResizingColumn={isResizingColumn}
              />
            </th>
          ))}
        {showAddColumn && (
          <th
            scope="col"
            className={`${styles.headerCell} ${styles.addColumnHeaderCell}`}
          >
            <button
              ref={addColumnButtonRef}
              type="button"
              className={styles.addColumnButton}
              onClick={onAddColumnClick}
              aria-label="Add new column"
            >
              <Image
                src={addColumIcon}
                alt=""
                width={16}
                height={16}
                className={styles.addColumnButtonIcon}
              />
            </button>
          </th>
        )}
      </tr>
    </thead>
  );

  const menu =
    headerMenu.visible && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className={styles.headerContextMenu}
            style={{
              top: headerMenu.y,
              left: headerMenu.x,
              transform: 'translateX(-100%)',
            }}
          >
            <div className={styles.headerContextMenuLabel}>OPTION</div>
            <button
              type="button"
              className={styles.headerContextMenuButton}
              onClick={() => {
                if (!headerMenu.propertyId) return;
                setEditTarget({
                  open: true,
                  propertyId: headerMenu.propertyId,
                  propertyName: headerMenu.propertyName ?? '',
                  propertyDescription: headerMenu.propertyDescription,
                  propertyDataType: headerMenu.propertyDataType,
                  propertyEnumOptions: headerMenu.propertyEnumOptions,
                  propertyReferenceLibraries: headerMenu.propertyReferenceLibraries,
                  propertyFormulaExpression: headerMenu.propertyFormulaExpression,
                  anchorX: headerMenu.popupAnchorX ?? headerMenu.x,
                  anchorY: headerMenu.y,
                });
                setHeaderMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              Edit column
            </button>
            {headerMenu.canDeleteColumn && (
              <button
                type="button"
                className={styles.headerContextMenuButton}
                onClick={() => {
                  if (!headerMenu.propertyId) {
                    showErrorToast('Missing column id');
                    return;
                  }
                  setDeleteColumnConfirm({
                    open: true,
                    propertyId: headerMenu.propertyId,
                    propertyName: headerMenu.propertyName,
                    loading: false,
                  });
                  setHeaderMenu((prev) => ({ ...prev, visible: false }));
                }}
              >
                Delete column
              </button>
            )}
          </div>,
          document.body,
        )
      : null;

  const deleteColumnConfirmOverlay =
    deleteColumnConfirm.open && typeof document !== 'undefined'
      ? createPortal(
          <div className={styles.confirmOverlay}>
            <div
              className={styles.confirmDialog}
              style={{ height: '15.5rem' }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-column-confirm-title"
              aria-describedby="delete-column-confirm-description"
            >
              <div className={styles.confirmHeader}>
                <h3 id="delete-column-confirm-title" className={styles.confirmTitle}>
                  Delete column
                </h3>
                <button
                  type="button"
                  className={styles.confirmCloseBtn}
                  aria-label="Close"
                  onClick={() =>
                    setDeleteColumnConfirm({
                      open: false,
                      propertyId: undefined,
                      propertyName: undefined,
                      loading: false,
                    })
                  }
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div id="delete-column-confirm-description" className={styles.confirmBody}>
                Are you sure you want to delete this column?
              </div>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.confirmCancelBtn}
                  onClick={() =>
                    setDeleteColumnConfirm({
                      open: false,
                      propertyId: undefined,
                      propertyName: undefined,
                      loading: false,
                    })
                  }
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.confirmDiscardBtn}
                  disabled={Boolean(deleteColumnConfirm.loading)}
                  onClick={async () => {
                    if (!libraryId || !deleteColumnConfirm.propertyId) {
                      showErrorToast('Missing libraryId or column id, cannot delete');
                      return;
                    }
                    setDeleteColumnConfirm((prev) => ({ ...prev, loading: true }));
                    try {
                      await deleteLibraryField(supabase, libraryId, deleteColumnConfirm.propertyId);
                      await invalidateLibrarySchemaData(queryClient, {
                        libraryId,
                        refetchActiveSchema: true,
                      });
                      showSuccessToast('Column deleted');
                    } catch (e: any) {
                      showErrorToast(e?.message || 'Failed to delete column');
                    } finally {
                      setDeleteColumnConfirm({
                        open: false,
                        propertyId: undefined,
                        propertyName: undefined,
                        loading: false,
                      });
                    }
                  }}
                >
                  {deleteColumnConfirm.loading ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {header}
      {menu}
      {deleteColumnConfirmOverlay}
      {filterTarget.open && filterTarget.property && (
        <ColumnValueFilterPopover
          open
          anchorRect={filterTarget.anchorRect ?? null}
          property={filterTarget.property}
          rows={rows}
          allProperties={existingProperties ?? properties}
          checkedValues={getCheckedFilterValues?.(filterTarget.property.id)}
          assetNamesCache={assetNamesCache}
          onMergeAssetNamesCache={onMergeAssetNamesCache}
          onClose={() => setFilterTarget({ open: false })}
          onApply={(selectedValues, allValues) => {
            if (!onApplyColumnFilter) {
              setFilterTarget({ open: false });
              return;
            }
            onApplyColumnFilter(filterTarget.property!.id, selectedValues, allValues);
            setFilterTarget({ open: false });
          }}
        />
      )}
      <EditColumnModal
        open={editTarget.open}
        anchorPosition={
          editTarget.anchorX !== undefined && editTarget.anchorY !== undefined
            ? { x: editTarget.anchorX, y: editTarget.anchorY }
            : undefined
        }
        propertyId={editTarget.propertyId}
        propertyName={editTarget.propertyName}
        propertyDescription={editTarget.propertyDescription}
        propertyDataType={editTarget.propertyDataType}
        propertyEnumOptions={editTarget.propertyEnumOptions}
        propertyReferenceLibraries={editTarget.propertyReferenceLibraries}
        propertyFormulaExpression={editTarget.propertyFormulaExpression}
        existingProperties={existingProperties}
        onClose={() => setEditTarget({ open: false })}
      />
    </>
  );
}
