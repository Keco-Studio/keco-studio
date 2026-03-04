'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Checkbox, Modal } from 'antd';
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

export type TableHeaderGroup = {
  section: SectionConfig;
  properties: PropertyConfig[];
};

export type TableHeaderProps = {
  groups: TableHeaderGroup[];
  allRowsSelected: boolean;
  hasSomeRowsSelected: boolean;
  onToggleSelectAll: (checked: boolean) => void;
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
    propertyId?: string;
    propertyName?: string;
    propertyDataType?: PropertyConfig['dataType'];
    propertyEnumOptions?: string[];
    propertyReferenceLibraries?: string[];
  }>({
    visible: false,
    x: 0,
    y: 0,
    propertyId: undefined,
    propertyName: undefined,
    propertyDataType: undefined,
    propertyEnumOptions: undefined,
    propertyReferenceLibraries: undefined,
  });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [deleteColumnConfirm, setDeleteColumnConfirm] = useState<{
    open: boolean;
    propertyId?: string;
    propertyName?: string;
  }>({
    open: false,
    propertyId: undefined,
    propertyName: undefined,
  });

  const [editTarget, setEditTarget] = useState<{
    open: boolean;
    propertyId?: string;
    propertyName?: string;
    propertyDataType?: PropertyConfig['dataType'];
    propertyEnumOptions?: string[];
    propertyReferenceLibraries?: string[];
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
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  setHeaderMenu({
                    visible: true,
                    // 水平居中在当前列头下方，略微下移，效果参考设计稿
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 8,
                    propertyId: property.id,
                    propertyName: property.name,
                    propertyDataType: property.dataType,
                    propertyEnumOptions: property.enumOptions,
                    propertyReferenceLibraries: property.referenceLibraries,
                  });
                }}
              >
                <span className={styles.propertyHeaderText}>{property.name}</span>
                <div className={styles.propertyHeaderIconWrapper}>
                  <Image
                    src={showIcon}
                    alt=""
                    width={8}
                    height={4}
                    className={styles.propertyHeaderIcon}
                  />
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
              transform: 'translateX(-50%)',
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
                  propertyDataType: headerMenu.propertyDataType,
                  propertyEnumOptions: headerMenu.propertyEnumOptions,
                  propertyReferenceLibraries: headerMenu.propertyReferenceLibraries,
                  anchorX: headerMenu.x,
                  anchorY: headerMenu.y,
                });
                setHeaderMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              Edit column
            </button>
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
                });
                setHeaderMenu((prev) => ({ ...prev, visible: false }));
              }}
            >
              Delete column
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {header}
      {menu}
      {/* Delete column confirm modal */}
      <Modal
        open={deleteColumnConfirm.open}
        title="Alert"
        onCancel={() =>
          setDeleteColumnConfirm({
            open: false,
            propertyId: undefined,
            propertyName: undefined,
          })
        }
        onOk={async () => {
          if (!libraryId || !deleteColumnConfirm.propertyId) {
            showErrorToast('Missing libraryId or column id, cannot delete');
            return;
          }
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
            });
          }
        }}
        okText="Overwrite"
        cancelText="Cancel"
        centered
        width={480}
        className={styles.confirmModal}
        wrapClassName={styles.confirmModalWrap}
        maskClosable={false}
      >
        <p>This operation may overwrite the existing content in this column. Do you want to continue?</p>
      </Modal>
      <EditColumnModal
        open={editTarget.open}
        anchorPosition={
          editTarget.anchorX !== undefined && editTarget.anchorY !== undefined
            ? { x: editTarget.anchorX, y: editTarget.anchorY }
            : undefined
        }
        propertyId={editTarget.propertyId}
        propertyName={editTarget.propertyName}
        propertyDataType={editTarget.propertyDataType}
        propertyEnumOptions={editTarget.propertyEnumOptions}
        propertyReferenceLibraries={editTarget.propertyReferenceLibraries}
        onClose={() => setEditTarget({ open: false })}
      />
    </>
  );
}

