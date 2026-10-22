'use client';

import React, { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Checkbox, Tooltip } from 'antd';
import { useDndMonitor, type DragEndEvent, type DragMoveEvent, type DragOverEvent } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useQueryClient } from '@tanstack/react-query';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { updateLibraryField } from '@/lib/services/libraryAssetsService';
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
import { type DropEdge } from '../utils/tableReorder';
import type { NumericSortDirection } from '../utils/tableNumericSorting';

function getDropEdge(event: DragMoveEvent | DragOverEvent | DragEndEvent): DropEdge {
  const translated = event.active.rect.current.translated;
  const overRect = event.over?.rect;
  if (!translated || !overRect) return 'before';
  return translated.left + translated.width / 2 < overRect.left + overRect.width / 2
    ? 'before'
    : 'after';
}

function ColumnDragMonitor({ onOver, onEnd, onCancel }: {
  onOver: (event: DragMoveEvent | DragOverEvent) => void;
  onEnd: (event: DragEndEvent) => void;
  onCancel: () => void;
}) {
  useDndMonitor({ onDragMove: onOver, onDragOver: onOver, onDragCancel: onCancel, onDragEnd: onEnd });
  return null;
}

function SortableColumnHeader({
  id,
  enabled,
  insertionEdge,
  children,
}: {
  id: string;
  enabled: boolean;
  insertionEdge: DropEdge | null;
  children: ReactElement<any>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `column:${id}`,
    disabled: !enabled,
  });
  const child = children.props;
  return cloneElement(children as ReactElement<any>, {
    ...attributes,
    ...listeners,
    ref: setNodeRef,
    'data-reorder-handle': enabled ? 'column' : undefined,
    className: `${child.className ?? ''} ${isDragging ? styles.columnDragging : ''} ${
      insertionEdge === 'before' ? styles.columnDropBefore : insertionEdge === 'after' ? styles.columnDropAfter : ''
    }`,
    style: {
      ...child.style,
      transform: CSS.Transform.toString(transform),
      transition,
    },
  });
}

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
      onPointerDown={(e) => e.stopPropagation()}
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
  /** Render the button inside the header cell. Set false when an external fixed control owns it. */
  showAddColumnButton?: boolean;
  /** Click handler for the "add column" header button */
  onAddColumnClick?: () => void;
  /** Insert a column immediately after a specific field. */
  onInsertColumnRight?: (propertyId: string) => void;
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
  /** Whether the user can drag columns to change the shared schema order. */
  canReorder?: boolean;
  onReorderProperties?: (activeId: string, overId: string, edge: DropEdge) => void;
  numericSort?: { propertyId: string; direction: NumericSortDirection } | null;
  onToggleNumericSort?: (propertyId: string) => void;
  /** Executes a durable column delete operation when supplied by the table. */
  onDeleteProperty?: (propertyId: string) => Promise<void>;
  onUpdateProperty?: (propertyId: string, payload: {
    label: string;
    dataType: PropertyConfig['dataType'];
    description?: string;
    enumOptions?: string[];
    referenceLibraries?: string[];
    formulaExpression?: string;
  }) => Promise<void>;
};

export function TableHeader({
  properties,
  allRowsSelected,
  hasSomeRowsSelected,
  onToggleSelectAll,
  existingProperties,
  showAddColumn = false,
  showAddColumnButton = true,
  onAddColumnClick,
  onInsertColumnRight,
  addColumnButtonRef,
  onColumnResizeStart,
  isResizingColumn = false,
  rows = [],
  onApplyColumnFilter,
  isColumnFiltered,
  getCheckedFilterValues,
  assetNamesCache = {},
  onMergeAssetNamesCache,
  canReorder = false,
  onReorderProperties,
  numericSort = null,
  onToggleNumericSort,
  onDeleteProperty,
  onUpdateProperty,
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
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: DropEdge } | null>(null);
  const propertyIds = useMemo(() => properties.map((property) => `column:${property.id}`), [properties]);
  const handleDragOver = useCallback((event: DragMoveEvent | DragOverEvent) => {
    if (!String(event.active.id).startsWith('column:') || !event.over || !String(event.over.id).startsWith('column:') || String(event.active.id) === String(event.over.id)) {
      setDropTarget(null);
      return;
    }
    setDropTarget({ id: String(event.over.id).slice(7), edge: getDropEdge(event) });
  }, []);
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const overId = event.over && String(event.over.id).startsWith('column:') ? String(event.over.id).slice(7) : null;
    const activeId = String(event.active.id);
    const edge = getDropEdge(event);
    setDropTarget(null);
    if (activeId.startsWith('column:') && overId && activeId.slice(7) !== overId) onReorderProperties?.(activeId.slice(7), overId, edge);
  }, [onReorderProperties]);

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
      {canReorder && <ColumnDragMonitor onOver={handleDragOver} onEnd={handleDragEnd} onCancel={() => setDropTarget(null)} />}
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
        <SortableContext items={propertyIds} strategy={horizontalListSortingStrategy}>
        {properties.map((property) => (
            <SortableColumnHeader
              key={property.id}
              id={property.id}
              enabled={canReorder}
              insertionEdge={dropTarget?.id === property.id ? dropTarget.edge : null}
            >
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
                    {(property.dataType === 'int' || property.dataType === 'float') && onToggleNumericSort && (
                      <Tooltip
                        title={
                          numericSort?.propertyId === property.id
                            ? numericSort.direction === 'asc' ? 'Sorted ascending' : 'Sorted descending'
                            : 'Sort by number'
                        }
                        placement="top"
                      >
                        <button
                          type="button"
                          className={`${styles.columnFilterButton} ${
                            numericSort?.propertyId === property.id ? styles.columnFilterButtonActive : ''
                          }`}
                          aria-label={`Sort ${property.name} ${
                            numericSort?.propertyId === property.id ? numericSort.direction : 'none'
                          }`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleNumericSort(property.id);
                          }}
                        >
                          <span aria-hidden="true" className={styles.columnNumericSortIcon}>
                            {numericSort?.propertyId === property.id
                              ? numericSort.direction === 'asc' ? <>&uarr;</> : <>&darr;</>
                              : <>&#8597;</>}
                          </span>
                        </button>
                      </Tooltip>
                    )}
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
                          onPointerDown={(e) => e.stopPropagation()}
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
                    onPointerDown={(e) => e.stopPropagation()}
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
                      width={11}
                      height={11}
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
            </SortableColumnHeader>
          ))}
        </SortableContext>
        {showAddColumn && (
          <th
            scope="col"
            className={`${styles.headerCell} ${styles.addColumnHeaderCell}`}
          >
            {showAddColumnButton && (
              <button
                ref={addColumnButtonRef}
                type="button"
                className={styles.addColumnButton}
                onClick={onAddColumnClick}
                aria-label="Insert column right"
                title="Insert column right"
              >
                <Image
                  src={addColumIcon}
                  alt=""
                  width={16}
                  height={16}
                  className={styles.addColumnButtonIcon}
                />
              </button>
            )}
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
            <div className={styles.headerContextMenuLabel}>option</div>
            <button
              type="button"
              className={styles.headerContextMenuButton}
              onClick={() => {
                setHeaderMenu((prev) => ({ ...prev, visible: false }));
                if (headerMenu.propertyId) {
                  onInsertColumnRight?.(headerMenu.propertyId);
                }
              }}
            >
              Insert column right
            </button>
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
              <>
                <div className={styles.headerContextMenuDivider} />
                <button
                  type="button"
                  className={`${styles.headerContextMenuButton} ${styles.headerContextMenuButtonDanger}`}
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
              </>
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
                    const propertyId = deleteColumnConfirm.propertyId;
                    setDeleteColumnConfirm({
                      open: false,
                      propertyId: undefined,
                      propertyName: undefined,
                      loading: false,
                    });
                    try {
                      if (onDeleteProperty) {
                        await onDeleteProperty(propertyId);
                      } else {
                        throw new Error('Column delete is unavailable');
                      }
                      showSuccessToast('Column deleted');
                      void invalidateLibrarySchemaData(queryClient, {
                        libraryId,
                        refetchActiveSchema: true,
                      }).catch((err) => {
                        console.error('Failed to refresh schema after column delete', err);
                      });
                    } catch (e: any) {
                      showErrorToast(e?.message || 'Failed to delete column');
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
        onUpdateProperty={onUpdateProperty}
        onClose={() => setEditTarget({ open: false })}
      />
    </>
  );
}
