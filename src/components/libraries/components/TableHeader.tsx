'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { Checkbox, Modal, Input, Select } from 'antd';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useQueryClient } from '@tanstack/react-query';
import type { SectionConfig, PropertyConfig } from '@/lib/types/libraryAssets';
import { deleteLibraryField, updateLibraryField } from '@/lib/services/libraryAssetsService';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import editStyles from './AddColumnModal.module.css';
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
  const editPopupRef = useRef<HTMLDivElement | null>(null);

  const [deleteColumnConfirm, setDeleteColumnConfirm] = useState<{
    open: boolean;
    propertyId?: string;
    propertyName?: string;
  }>({
    open: false,
    propertyId: undefined,
    propertyName: undefined,
  });

  const [editColumnModal, setEditColumnModal] = useState<{
    open: boolean;
    propertyId?: string;
    name: string;
    dataType?: PropertyConfig['dataType'];
    description: string;
    enumOptions: string[];
    referenceLibraries: string[];
    libraries: Library[];
    loadingLibraries: boolean;
    error: string | null;
  }>({
    open: false,
    propertyId: undefined,
    name: '',
    dataType: undefined,
    description: '',
    enumOptions: [],
    referenceLibraries: [],
    libraries: [],
    loadingLibraries: false,
    error: null,
  });

  // 点击任意非浮层区域时关闭浮层（使用捕获阶段，避免被内部 stopPropagation 影响）
  useEffect(() => {
    if (!headerMenu.visible && !editColumnModal.open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        (menuRef.current && target && menuRef.current.contains(target)) ||
        (editPopupRef.current && target && editPopupRef.current.contains(target))
      ) {
        return;
      }
      setHeaderMenu((prev) => ({ ...prev, visible: false }));
      setEditColumnModal((prev) => ({ ...prev, open: false }));
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [headerMenu.visible, editColumnModal.open]);

  // 当发生滚动 / 滑轮滚动时，只关闭右键小浮层，保留编辑弹窗
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

  // 当编辑弹窗打开并选择 reference 类型时，加载可选库列表
  useEffect(() => {
    if (!editColumnModal.open || editColumnModal.dataType !== 'reference' || !projectId) return;
    let cancelled = false;

    const loadLibraries = async () => {
      setEditColumnModal((prev) => ({ ...prev, loadingLibraries: true, error: null }));
      try {
        const libs = await listLibraries(supabase, projectId);
        const filtered = libs.filter((lib) => lib.id !== libraryId);
        if (!cancelled) {
          setEditColumnModal((prev) => ({
            ...prev,
            libraries: filtered,
            loadingLibraries: false,
          }));
        }
      } catch (e: any) {
        console.error('Failed to load libraries for reference field in edit popup', e);
        if (!cancelled) {
          setEditColumnModal((prev) => ({
            ...prev,
            libraries: [],
            loadingLibraries: false,
            error: prev.error ?? 'Failed to load libraries',
          }));
        }
      }
    };

    void loadLibraries();
    return () => {
      cancelled = true;
    };
  }, [editColumnModal.open, editColumnModal.dataType, projectId, libraryId, supabase]);

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
                setEditColumnModal({
                  open: true,
                  propertyId: headerMenu.propertyId,
                  name: headerMenu.propertyName ?? '',
                  dataType: headerMenu.propertyDataType,
                  description: '',
                  enumOptions:
                    headerMenu.propertyDataType === 'enum'
                      ? headerMenu.propertyEnumOptions ?? []
                      : [],
                  referenceLibraries:
                    headerMenu.propertyDataType === 'reference'
                      ? headerMenu.propertyReferenceLibraries ?? []
                      : [],
                  libraries: [],
                  loadingLibraries: false,
                  error: null,
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
      {/* Edit column floating popup (no mask, similar to AddColumnModal) */}
      {editColumnModal.open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={editPopupRef}
              className={editStyles.popup}
              style={{
                position: 'fixed',
                top: editColumnModal.open && headerMenu.y ? headerMenu.y : undefined,
                left: editColumnModal.open && headerMenu.x ? headerMenu.x : undefined,
                transform: 'translateX(-50%)', // 水平居中在列头下方
                zIndex: 1100,
              }}
            >
              <div className={editStyles.header}>
                <h2 className={editStyles.title}>EDIT COLUMN</h2>
                <button
                  type="button"
                  className={editStyles.closeBtn}
                  onClick={() =>
                    setEditColumnModal({
                      open: false,
                      propertyId: undefined,
                      name: '',
                      dataType: undefined,
                      description: '',
                      enumOptions: [],
                      referenceLibraries: [],
                      libraries: [],
                      loadingLibraries: false,
                      error: null,
                    })
                  }
                  aria-label="Close"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M12 4L4 12M4 4l8 8"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              {/* 与 AddColumnModal 一致：上半部分可滚动，底部按钮固定 */}
              <div className={`${editStyles.body} ${editStyles.scrollBody}`}>
                <div className={editStyles.field}>
                  <label className={editStyles.label} htmlFor="edit-column-name">
                    Header name<span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <Input
                    id="edit-column-name"
                    value={editColumnModal.name}
                    onChange={(e) =>
                      setEditColumnModal((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    maxLength={200}
                    className={editStyles.input}
                  />
                </div>
                <div className={editStyles.field}>
                  <label className={editStyles.label} htmlFor="edit-column-type">
                    Data type<span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <Select
                    id="edit-column-type"
                    value={editColumnModal.dataType}
                    onChange={(v) =>
                      setEditColumnModal((prev) => ({
                        ...prev,
                        dataType: v as PropertyConfig['dataType'],
                      }))
                    }
                    placeholder="Select type"
                    className={editStyles.dataTypeSelect}
                    style={{ width: '100%' }}
                    getPopupContainer={(node) => node.parentElement ?? document.body}
                    options={FIELD_TYPE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Image
                            src={getFieldTypeIcon(opt.value)}
                            alt=""
                            width={16}
                            height={16}
                            className={editStyles.typeIcon}
                          />
                          {opt.label}
                        </span>
                      ),
                    }))}
                  />
                </div>
                {/* Description 字段保留占位，暂不持久化到后端 */}
                <div className={editStyles.field}>
                  <label
                    className={`${editStyles.label} ${editStyles.labelOptional}`}
                    htmlFor="edit-column-desc"
                  >
                    Description
                  </label>
                  <Input.TextArea
                    id="edit-column-desc"
                    value={editColumnModal.description}
                    onChange={(e) =>
                      setEditColumnModal((prev) => ({
                        ...prev,
                        description: e.target.value.slice(0, 250),
                      }))
                    }
                    placeholder="Type..."
                    className={editStyles.textarea}
                    rows={3}
                    maxLength={250}
                    showCount={false}
                  />
                  <span className={editStyles.hint}>(250 characters limit)</span>
                </div>
                {editColumnModal.dataType === 'enum' && (
                  <div className={editStyles.field}>
                    <label className={editStyles.label}>
                      Options<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
                    </label>
                    <div className={editStyles.optionsContainer}>
                      {editColumnModal.enumOptions.map((opt, index) => (
                        <div key={index} className={editStyles.optionRow}>
                          <Input
                            value={opt}
                            onChange={(e) => {
                              const value = e.target.value;
                              setEditColumnModal((prev) => {
                                const nextOptions = [...prev.enumOptions];
                                nextOptions[index] = value;
                                return { ...prev, enumOptions: nextOptions };
                              });
                            }}
                            placeholder="Enter option"
                            className={editStyles.optionInput}
                          />
                          <button
                            type="button"
                            className={editStyles.removeOptionBtn}
                            onClick={() =>
                              setEditColumnModal((prev) => ({
                                ...prev,
                                enumOptions: prev.enumOptions.filter((_, i) => i !== index),
                              }))
                            }
                            aria-label="Remove option"
                          >
                            −
                          </button>
                        </div>
                      ))}
                      {editColumnModal.enumOptions.length === 0 && (
                        <div className={editStyles.emptyOptionsHint}>
                          Click "Add option" to define choices.
                        </div>
                      )}
                      <button
                        type="button"
                        className={editStyles.addOptionBtn}
                        onClick={() =>
                          setEditColumnModal((prev) => ({
                            ...prev,
                            enumOptions: [...prev.enumOptions, ''],
                          }))
                        }
                      >
                        + Add option
                      </button>
                    </div>
                  </div>
                )}
                {editColumnModal.dataType === 'reference' && (
                  <div className={editStyles.field}>
                    <label className={editStyles.label}>
                      Reference libraries<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
                    </label>
                    <Select
                      mode="multiple"
                      style={{ width: '100%' }}
                      placeholder="Select libraries to reference"
                      value={editColumnModal.referenceLibraries}
                      loading={editColumnModal.loadingLibraries}
                      onChange={(values) =>
                        setEditColumnModal((prev) => ({
                          ...prev,
                          referenceLibraries: values as string[],
                          error: null,
                        }))
                      }
                      getPopupContainer={(node) => node.parentElement ?? document.body}
                      options={editColumnModal.libraries.map((lib) => ({
                        label: lib.name,
                        value: lib.id,
                      }))}
                      maxTagCount="responsive"
                      className={editStyles.referenceSelect}
                    />
                    {!editColumnModal.loadingLibraries &&
                      editColumnModal.referenceLibraries.length === 0 && (
                        <span className={editStyles.hint}>
                          Choose one or more libraries that this column can reference.
                        </span>
                      )}
                  </div>
                )}
                {editColumnModal.error && (
                  <div className={editStyles.errorText}>{editColumnModal.error}</div>
                )}
              </div>
              <div className={editStyles.body} style={{ paddingTop: 0, paddingBottom: '1.25rem' }}>
                <div className={editStyles.footer}>
                  <button
                    type="button"
                    className={editStyles.cancelBtn}
                    onClick={() =>
                      setEditColumnModal({
                        open: false,
                        propertyId: undefined,
                        name: '',
                        dataType: undefined,
                        description: '',
                        enumOptions: [],
                        referenceLibraries: [],
                        libraries: [],
                        loadingLibraries: false,
                        error: null,
                      })
                    }
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={editStyles.addBtn}
                    onClick={async () => {
                      // 前端校验：名称和类型必填，enum/reference 需配置完整
                      if (!editColumnModal.name.trim()) {
                        setEditColumnModal((prev) => ({
                          ...prev,
                          error: 'Header name is required.',
                        }));
                        return;
                      }
                      if (!editColumnModal.dataType) {
                        setEditColumnModal((prev) => ({
                          ...prev,
                          error: 'Data type is required.',
                        }));
                        return;
                      }
                      if (
                        editColumnModal.dataType === 'enum' &&
                        editColumnModal.enumOptions.every((opt) => !opt.trim())
                      ) {
                        setEditColumnModal((prev) => ({
                          ...prev,
                          error: 'Please add at least one option for enum type.',
                        }));
                        return;
                      }
                      if (
                        editColumnModal.dataType === 'reference' &&
                        editColumnModal.referenceLibraries.length === 0
                      ) {
                        setEditColumnModal((prev) => ({
                          ...prev,
                          error: 'Please select at least one reference library.',
                        }));
                        return;
                      }

                      if (!libraryId || !editColumnModal.propertyId) {
                        showErrorToast('Missing libraryId or column id, cannot save');
                        return;
                      }

                      try {
                        await updateLibraryField(supabase, libraryId, editColumnModal.propertyId, {
                          label: editColumnModal.name,
                          dataType: editColumnModal.dataType,
                          enumOptions: editColumnModal.enumOptions,
                          referenceLibraries: editColumnModal.referenceLibraries,
                        });

                        await queryClient.invalidateQueries({
                          queryKey: queryKeys.librarySchema(libraryId),
                        });
                        await queryClient.invalidateQueries({
                          queryKey: queryKeys.libraryAssets(libraryId),
                        });
                        showSuccessToast('Column updated');

                        setEditColumnModal({
                          open: false,
                          propertyId: undefined,
                          name: '',
                          dataType: undefined,
                          description: '',
                          enumOptions: [],
                          referenceLibraries: [],
                          libraries: [],
                          loadingLibraries: false,
                          error: null,
                        });
                      } catch (e: any) {
                        showErrorToast(e?.message || 'Failed to update column');
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

