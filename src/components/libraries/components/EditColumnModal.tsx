'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Checkbox } from 'antd';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useQueryClient } from '@tanstack/react-query';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { updateLibraryField } from '@/lib/services/libraryAssetsService';
import { queryKeys } from '@/lib/utils/queryKeys';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import { listFolders, type Folder } from '@/lib/services/folderService';
import styles from './AddColumnModal.module.css';

type EditColumnModalProps = {
  open: boolean;
  /** 弹窗锚点位置（通常是列头的中点坐标） */
  anchorPosition?: { x: number; y: number } | null;
  propertyId?: string;
  propertyName?: string;
  propertyDescription?: string | null;
  propertyDataType?: PropertyConfig['dataType'];
  propertyEnumOptions?: string[];
  propertyReferenceLibraries?: string[];
  onClose: () => void;
};

type EditColumnFormState = {
  propertyId?: string;
  name: string;
  dataType?: PropertyConfig['dataType'];
  description: string;
  enumOptions: string[];
  referenceLibraries: string[];
  libraries: Library[];
  folders: Folder[];
  loadingLibraries: boolean;
  loadingFolders: boolean;
  error: string | null;
};

const EMPTY_STATE: EditColumnFormState = {
  propertyId: undefined,
  name: '',
  dataType: undefined,
  description: '',
  enumOptions: [],
  referenceLibraries: [],
  libraries: [],
  folders: [],
  loadingLibraries: false,
  loadingFolders: false,
  error: null,
};

export function EditColumnModal({
  open,
  anchorPosition,
  propertyId,
  propertyName,
  propertyDescription,
  propertyDataType,
  propertyEnumOptions,
  propertyReferenceLibraries,
  onClose,
}: EditColumnModalProps) {
  const supabase = useSupabase();
  const params = useParams();
  const queryClient = useQueryClient();
  const libraryId = params?.libraryId as string | undefined;
  const projectId = params?.projectId as string | undefined;

  const [editColumnModal, setEditColumnModal] = useState<EditColumnFormState>(EMPTY_STATE);
  const [referenceFolderFilter, setReferenceFolderFilter] = useState<'all' | 'root' | string>('all');
  const [referenceSearch, setReferenceSearch] = useState('');
  const [referenceDropdownOpen, setReferenceDropdownOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);

  // 每次打开时，用当前列配置初始化表单状态
  useEffect(() => {
    if (!open || !propertyId) return;

    setEditColumnModal({
      propertyId,
      name: propertyName ?? '',
      dataType: propertyDataType,
      description: propertyDescription ?? '',
      enumOptions: propertyDataType === 'enum' ? propertyEnumOptions ?? [] : [],
      referenceLibraries:
        propertyDataType === 'reference' ? propertyReferenceLibraries ?? [] : [],
      libraries: [],
      folders: [],
      loadingLibraries: false,
      loadingFolders: false,
      error: null,
    });
    setReferenceFolderFilter('all');
    setReferenceSearch('');
    setReferenceDropdownOpen(false);
  }, [
    open,
    propertyId,
    propertyName,
    propertyDescription,
    propertyDataType,
    propertyEnumOptions,
    propertyReferenceLibraries,
  ]);

  // 关闭时重置内部状态
  useEffect(() => {
    if (!open) {
      setEditColumnModal(EMPTY_STATE);
      setReferenceFolderFilter('all');
      setReferenceSearch('');
      setReferenceDropdownOpen(false);
    }
  }, [open]);

  // 点击弹窗外部关闭
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (modalRef.current && target && modalRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [open, onClose]);

  // 当编辑弹窗打开并选择 reference 类型时，加载可选库列表与文件夹
  useEffect(() => {
    if (!open || editColumnModal.dataType !== 'reference' || !projectId) return;
    let cancelled = false;

    const loadLibrariesAndFolders = async () => {
      setEditColumnModal((prev) => ({
        ...prev,
        loadingLibraries: true,
        loadingFolders: true,
        error: null,
      }));
      try {
        const [libs, fds] = await Promise.all([
          listLibraries(supabase, projectId),
          listFolders(supabase, projectId),
        ]);
        const filteredLibs = libs.filter((lib) => lib.id !== libraryId);
        if (!cancelled) {
          setEditColumnModal((prev) => ({
            ...prev,
            libraries: filteredLibs,
            folders: fds,
            loadingLibraries: false,
            loadingFolders: false,
          }));
        }
      } catch (e: any) {
        console.error('Failed to load libraries for reference field in edit popup', e);
        if (!cancelled) {
          setEditColumnModal((prev) => ({
            ...prev,
            libraries: [],
            folders: [],
            loadingLibraries: false,
            loadingFolders: false,
            error: prev.error ?? 'Failed to load libraries',
          }));
        }
      }
    };

    void loadLibrariesAndFolders();
    return () => {
      cancelled = true;
    };
  }, [open, editColumnModal.dataType, projectId, libraryId, supabase]);

  const { librariesWithFolder, librariesWithoutFolder, foldersById } = useMemo(() => {
    const byId = new Map<string, Folder>();
    editColumnModal.folders.forEach((folder) => byId.set(folder.id, folder));
    const withFolder: Library[] = [];
    const withoutFolder: Library[] = [];
    editColumnModal.libraries.forEach((lib) => {
      if (lib.folder_id && byId.has(lib.folder_id)) withFolder.push(lib);
      else withoutFolder.push(lib);
    });
    return {
      librariesWithFolder: withFolder,
      librariesWithoutFolder: withoutFolder,
      foldersById: byId,
    };
  }, [editColumnModal.folders, editColumnModal.libraries]);

  const filteredReferenceLibraries = useMemo(() => {
    const keyword = referenceSearch.trim().toLowerCase();
    const base = editColumnModal.libraries.filter((lib) => {
      if (referenceFolderFilter === 'all') return true;
      if (referenceFolderFilter === 'root')
        return !lib.folder_id || !foldersById.has(lib.folder_id);
      return lib.folder_id === referenceFolderFilter;
    });
    if (!keyword) return base;
    return base.filter((lib) => {
      const name = lib.name.toLowerCase();
      const folderName = lib.folder_id
        ? foldersById.get(lib.folder_id)?.name.toLowerCase() ?? ''
        : '';
      return name.includes(keyword) || folderName.includes(keyword);
    });
  }, [editColumnModal.libraries, referenceFolderFilter, referenceSearch, foldersById]);

  const handleSubmit = async () => {
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
        description: editColumnModal.description.trim() || undefined,
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
      onClose();
    } catch (e: any) {
      showErrorToast(e?.message || 'Failed to update column');
    }
  };

  if (!open || !editColumnModal.propertyId) {
    return null;
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorPosition?.y,
    // 将弹窗整体在锚点基础上左移 40px（在原来“居中于列头”基础上再左移）
    left: anchorPosition ? anchorPosition.x - 40 : undefined,
    transform: 'translateX(-50%)',
    zIndex: 1100,
  };

  const modalContent = (
    <div ref={modalRef} className={styles.popup} style={style}>
      <div className={styles.header}>
        <h2 className={styles.title}>EDIT COLUMN</h2>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
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
      <div className={`${styles.body} ${styles.scrollBody}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-column-name">
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
            className={styles.input}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-column-type">
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
            className={styles.dataTypeSelect}
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
                    className={styles.typeIcon}
                  />
                  {opt.label}
                </span>
              ),
            }))}
          />
        </div>
        {/* Description 字段保留占位，暂不持久化到后端 */}
        <div className={styles.field}>
          <label className={`${styles.label} ${styles.labelOptional}`} htmlFor="edit-column-desc">
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
            className={styles.textarea}
            rows={3}
            maxLength={250}
            showCount={false}
          />
          <span className={styles.hint}>(250 characters limit)</span>
        </div>
        {editColumnModal.dataType === 'enum' && (
          <div className={styles.field}>
            <label className={styles.label}>
              Options<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
            </label>
            <div className={styles.optionsContainer}>
              {editColumnModal.enumOptions.map((opt, index) => (
                <div key={index} className={styles.optionRow}>
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
                    className={styles.optionInput}
                  />
                  <button
                    type="button"
                    className={styles.removeOptionBtn}
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
                <div className={styles.emptyOptionsHint}>
                  Click "Add option" to define choices.
                </div>
              )}
              <button
                type="button"
                className={styles.addOptionBtn}
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
          <div className={styles.field}>
            <label className={styles.label}>
              Reference libraries<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
            </label>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Select libraries to reference"
              value={editColumnModal.referenceLibraries}
              loading={editColumnModal.loadingLibraries || editColumnModal.loadingFolders}
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
              open={referenceDropdownOpen}
              onDropdownVisibleChange={(openDropdown) => {
                setReferenceDropdownOpen(openDropdown);
                if (!openDropdown) {
                  setReferenceFolderFilter('all');
                  setReferenceSearch('');
                }
              }}
              dropdownRender={() => (
                <div className={styles.referenceDropdown}>
                  <div className={styles.referenceDropdownContent}>
                    <Input
                      allowClear
                      placeholder="Search libraries"
                      value={referenceSearch}
                      onChange={(e) => setReferenceSearch(e.target.value)}
                      className={styles.referenceSearchInput}
                    />
                    <div className={styles.referenceFolderTabs}>
                      <button
                        type="button"
                        className={`${styles.referenceFolderTab} ${
                          referenceFolderFilter === 'all' ? styles.referenceFolderTabActive : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReferenceFolderFilter('all');
                        }}
                      >
                        All folders
                      </button>
                      {editColumnModal.folders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          className={`${styles.referenceFolderTab} ${
                            referenceFolderFilter === folder.id ? styles.referenceFolderTabActive : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceFolderFilter(folder.id);
                          }}
                        >
                          {folder.name}
                        </button>
                      ))}
                      {librariesWithoutFolder.length > 0 && (
                        <button
                          type="button"
                          className={`${styles.referenceFolderTab} ${
                            referenceFolderFilter === 'root' ? styles.referenceFolderTabActive : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setReferenceFolderFilter('root');
                          }}
                        >
                          No folder
                        </button>
                      )}
                    </div>
                    <div className={styles.referenceOptionsList}>
                      {editColumnModal.loadingLibraries || editColumnModal.loadingFolders ? (
                        <div className={styles.referenceEmptyHint}>Loading libraries…</div>
                      ) : filteredReferenceLibraries.length === 0 ? (
                        <div className={styles.referenceEmptyHint}>No libraries found.</div>
                      ) : (
                        filteredReferenceLibraries.map((lib) => {
                          const checked = editColumnModal.referenceLibraries.includes(lib.id);
                          const folderName =
                            lib.folder_id && foldersById.get(lib.folder_id)
                              ? foldersById.get(lib.folder_id)!.name
                              : librariesWithFolder.length > 0
                              ? 'No folder'
                              : '';
                          return (
                            <label
                              key={lib.id}
                              className={styles.referenceOptionRow}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setEditColumnModal((prev) => {
                                    const next = isChecked
                                      ? [...prev.referenceLibraries, lib.id]
                                      : prev.referenceLibraries.filter((id) => id !== lib.id);
                                    return {
                                      ...prev,
                                      referenceLibraries: Array.from(new Set(next)),
                                      error: null,
                                    };
                                  });
                                }}
                              />
                              <span className={styles.referenceOptionLabel}>{lib.name}</span>
                              {folderName ? (
                                <span className={styles.referenceOptionFolderTag}>{folderName}</span>
                              ) : null}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            />
            {!editColumnModal.loadingLibraries &&
              !editColumnModal.loadingFolders &&
              editColumnModal.referenceLibraries.length === 0 && (
                <span className={styles.hint}>
                  Choose one or more libraries that this column can reference.
                </span>
              )}
          </div>
        )}
        {editColumnModal.error && (
          <div className={styles.errorText}>{editColumnModal.error}</div>
        )}
      </div>
      <div className={styles.body} style={{ paddingTop: 0, paddingBottom: '1.25rem' }}>
        <div className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={styles.addBtn} onClick={handleSubmit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}

