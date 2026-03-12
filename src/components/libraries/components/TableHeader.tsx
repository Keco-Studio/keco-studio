'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Checkbox, Tooltip } from 'antd';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useQueryClient } from '@tanstack/react-query';
import type { SectionConfig, PropertyConfig } from '@/lib/types/libraryAssets';
import { deleteLibraryField, updateLibraryField } from '@/lib/services/libraryAssetsService';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import { EditColumnModal } from './EditColumnModal';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';
import showIcon from '@/assets/images/showIcon.svg';
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

export type TableHeaderGroup = {
  section: SectionConfig;
  properties: PropertyConfig[];
};

export type TableHeaderProps = {
  groups: TableHeaderGroup[];
  allRowsSelected: boolean;
  hasSomeRowsSelected: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  /** 当前库的全部字段列表，用于下钻到 EditColumnModal 做重名校验 */
  existingProperties?: PropertyConfig[];
  /** When true (e.g. section tabs mode), hide the section name row and only show property names */
  showSectionRow?: boolean;
  /** Whether to show the "add column" button column at the right side of header */
  showAddColumn?: boolean;
  /** Click handler for the "add column" header button */
  onAddColumnClick?: () => void;
  /** Ref for the add column button (used to position the popup below it) */
  addColumnButtonRef?: React.RefObject<HTMLButtonElement | null>;
};

export function TableHeader({
  groups,
  allRowsSelected,
  hasSomeRowsSelected,
  onToggleSelectAll,
  existingProperties,
  showSectionRow = true,
  showAddColumn = false,
  onAddColumnClick,
  addColumnButtonRef,
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

  // 点击任意非浮层区域时关闭浮层（使用捕获阶段，避免被内部 stopPropagation 影响）
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

  // 当发生滚动 / 滑轮滚动时，只关闭右键小浮层
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

  const openHeaderMenu = (
    anchorEl: HTMLDivElement,
    property: PropertyConfig,
    sectionColumnCount: number,
  ) => {
    const rect = anchorEl.getBoundingClientRect();
    setHeaderMenu({
      visible: true,
      // Align panel's right edge with current column's right edge.
      x: rect.right,
      y: rect.bottom + 8,
      popupAnchorX: rect.right,
      canDeleteColumn: sectionColumnCount > 1,
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
      {showSectionRow && (
        <tr className={styles.headerRowTop}>
          <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
            <div className={styles.checkboxContainer}>
              <Checkbox
                checked={allRowsSelected}
                indeterminate={hasSomeRowsSelected && !allRowsSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </div>
          </th>
          {groups.map((group, index) => (
            <th
              key={group.section.id}
              scope="col"
              colSpan={group.properties.length}
              className={`${styles.headerCell} ${styles.sectionHeaderCell} ${
                index < groups.length - 1 ? styles.sectionHeaderCellDivider : ''
              }`}
            >
              {group.section.name}
            </th>
          ))}
        </tr>
      )}
      <tr className={styles.headerRowBottom}>
        <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
          {showSectionRow ? (
            '#'
          ) : (
            <div className={styles.checkboxContainer}>
              <Checkbox
                checked={allRowsSelected}
                indeterminate={hasSomeRowsSelected && !allRowsSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </div>
          )}
        </th>
        {groups.map((group) =>
          group.properties.map((property) => (
            <th
              key={property.id}
              scope="col"
              className={`${styles.headerCell} ${styles.propertyHeaderCell}`}
            >
              <div
                className={styles.propertyHeaderContent}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openHeaderMenu(
                    e.currentTarget as HTMLDivElement,
                    property,
                    group.properties.length,
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
                  <EllipsisTextWithTooltip
                    text={property.name}
                    className={styles.propertyHeaderText}
                  />
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
                        openHeaderMenu(contentEl, property, group.properties.length);
                      }
                    }}
                  >
                    <Image
                      src={showIcon}
                      alt=""
                      width={8}
                      height={4}
                      className={styles.propertyHeaderIcon}
                    />
                  </div>
                </div>
              </div>
            </th>
          )),
        )}
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
                      await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(libraryId) });
                      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
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

