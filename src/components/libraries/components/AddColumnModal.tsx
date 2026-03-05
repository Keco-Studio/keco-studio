'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Checkbox } from 'antd';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { useSupabase } from '@/lib/SupabaseContext';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import { listFolders, type Folder } from '@/lib/services/folderService';
import styles from './AddColumnModal.module.css';

const DESCRIPTION_MAX = 50;
type DataType = NonNullable<PropertyConfig['dataType']>;

export type AddColumnFormPayload = {
  name: string;
  dataType: DataType;
  description?: string;
  /** For enum type: predefined option values */
  enumOptions?: string[];
  /** For reference type: allowed target library IDs */
  referenceLibraries?: string[];
};

export type AddColumnModalProps = {
  open: boolean;
  onClose: () => void;
  sectionId: string;
  sectionName: string;
  onSubmit: (payload: AddColumnFormPayload) => Promise<void>;
  /** 锚点元素（如「新增列」按钮），弹窗将悬浮在该元素正下方；不传则相对视口居中 */
  anchorRef?: React.RefObject<HTMLElement | null>;
};

export function AddColumnModal({
  open,
  onClose,
  onSubmit,
  anchorRef,
}: AddColumnModalProps) {
  const supabase = useSupabase();
  const params = useParams();
  const projectId = params?.projectId as string | undefined;
  const currentLibraryId = params?.libraryId as string | undefined;

  const [name, setName] = useState('');
  const [dataType, setDataType] = useState<DataType | undefined>(undefined);
  const [description, setDescription] = useState('');
  const [enumOptions, setEnumOptions] = useState<string[]>([]);
  const [referenceLibraries, setReferenceLibraries] = useState<string[]>([]);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loadingLibraries, setLoadingLibraries] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<any>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const [referenceFolderFilter, setReferenceFolderFilter] = useState<'all' | 'root' | string>('all');
  const [referenceSearch, setReferenceSearch] = useState('');
  const [referenceDropdownOpen, setReferenceDropdownOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const updatePosition = () => {
    // 无锚点时，居中显示
    if (!anchorRef?.current) {
      setPopupStyle({
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1050,
      });
      return;
    }

    const rect = anchorRef.current.getBoundingClientRect();
    const gap = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const estimatedWidth = 440;
    const margin = 1;

    // 编辑框在表格右侧、按钮下方：右边缘与按钮右边缘对齐；再整体右移 100px
    let left = rect.right - estimatedWidth + 100;
    if (left < margin) left = margin;
    if (left + estimatedWidth + margin > viewportWidth) {
      left = viewportWidth - estimatedWidth - margin;
    }

    setPopupStyle({
      position: 'fixed',
      top: rect.bottom + gap + 20, // 在原基础上垂直下移 40px
      left,
      transform: 'none', // 覆盖 .popup 的 translate(-50%,-50%)，否则会居中
      zIndex: 1050,
    });
  };

  useEffect(() => {
    if (open) {
      setName('');
      setDataType(undefined);
      setDescription('');
      setEnumOptions([]);
      setReferenceLibraries([]);
      setError(null);
      setSubmitting(false);
      setShowDiscardConfirm(false);
      updatePosition();
      setTimeout(() => nameInputRef.current?.focus(), 80);
    }
  }, [open]);

  const hasUnsavedChanges = useMemo(() => {
    if (name.trim()) return true;
    if (dataType) return true;
    if (description.trim()) return true;
    if (enumOptions.some((opt) => opt.trim().length > 0)) return true;
    if (referenceLibraries.length > 0) return true;
    return false;
  }, [name, dataType, description, enumOptions, referenceLibraries]);

  const handleRequestClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  }, [hasUnsavedChanges, onClose]);

  useEffect(() => {
    if (!open || !anchorRef?.current) return;
    const el = anchorRef.current;
    const ro = new ResizeObserver(updatePosition);
    ro.observe(el);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (modalRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      handleRequestClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, handleRequestClose, anchorRef]);

  // Lazy-load libraries when configuring a reference field
  useEffect(() => {
    if (!open || dataType !== 'reference' || !projectId) return;

    setLoadingLibraries(true);
    setLoadingFolders(true);
    const loadLibraries = async () => {
      try {
        const [libs, fds] = await Promise.all([
          listLibraries(supabase, projectId),
          listFolders(supabase, projectId),
        ]);
        const filteredLibs = libs.filter((lib) => lib.id !== currentLibraryId);
        setLibraries(filteredLibs);
        setFolders(fds);
      } catch (e) {
        console.error('Failed to load libraries for reference field', e);
        setLibraries([]);
        setFolders([]);
      } finally {
        setLoadingLibraries(false);
        setLoadingFolders(false);
      }
    };

    void loadLibraries();
  }, [open, dataType, projectId, currentLibraryId, supabase]);

  const { librariesWithFolder, librariesWithoutFolder, foldersById } = useMemo(() => {
    const byId = new Map<string, Folder>();
    folders.forEach((folder) => {
      byId.set(folder.id, folder);
    });

    const withFolder: Library[] = [];
    const withoutFolder: Library[] = [];

    libraries.forEach((lib) => {
      if (lib.folder_id && byId.has(lib.folder_id)) {
        withFolder.push(lib);
      } else {
        withoutFolder.push(lib);
      }
    });

    return {
      librariesWithFolder: withFolder,
      librariesWithoutFolder: withoutFolder,
      foldersById: byId,
    };
  }, [folders, libraries]);

  const filteredReferenceLibraries = useMemo(() => {
    const keyword = referenceSearch.trim().toLowerCase();

    const base = libraries.filter((lib) => {
      if (referenceFolderFilter === 'all') return true;
      if (referenceFolderFilter === 'root') {
        return !lib.folder_id || !foldersById.has(lib.folder_id);
      }
      return lib.folder_id === referenceFolderFilter;
    });

    if (!keyword) return base;

    return base.filter((lib) => {
      const name = lib.name.toLowerCase();
      const folderName = lib.folder_id ? foldersById.get(lib.folder_id)?.name.toLowerCase() ?? '' : '';
      return name.includes(keyword) || folderName.includes(keyword);
    });
  }, [libraries, referenceFolderFilter, referenceSearch, foldersById]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Header name is required.');
      return;
    }
    if (!dataType) {
      setError('Data type is required.');
      return;
    }

    // Extra validation for enum and reference types
    if (dataType === 'enum') {
      const normalizedOptions = enumOptions.map((o) => o.trim()).filter((o) => o.length > 0);
      if (normalizedOptions.length === 0) {
        setError('Please add at least one option for enum type.');
        return;
      }
    }
    if (dataType === 'reference') {
      if (referenceLibraries.length === 0) {
        setError('Please select at least one reference library.');
        return;
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload: AddColumnFormPayload = {
        name: trimmedName,
        dataType,
        description: description.trim() || undefined,
      };

      if (dataType === 'enum') {
        payload.enumOptions = enumOptions
          .map((o) => o.trim())
          .filter((o) => o.length > 0);
      }

      if (dataType === 'reference') {
        payload.referenceLibraries = referenceLibraries;
      }

      await onSubmit(payload);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add column.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleRequestClose();
    }
  };

  if (!open) return null;

  const modalContent = (
    <div
      ref={modalRef}
      className={styles.popup}
      style={popupStyle}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-labelledby="add-column-title"
    >
        <div className={styles.header}>
          <h2 id="add-column-title" className={styles.title}>
            ADD COLUMN
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleRequestClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <div className={`${styles.body} ${styles.scrollBody}`}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="add-column-name">
              Header name<span style={{ color: '#dc2626' }}>*</span>
            </label>
            <Input
              id="add-column-name"
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder=""
              className={styles.input}
              maxLength={200}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="add-column-type">
              Data type<span style={{ color: '#dc2626' }}>*</span>
            </label>
            <Select
              id="add-column-type"
              value={dataType ?? undefined}
              onChange={(v) => {
                const next = v as DataType;
                setDataType(next);
                setError(null);
                if (next === 'enum') {
                  setEnumOptions((prev) => (prev.length > 0 ? prev : ['']));
                  setReferenceLibraries([]);
                } else if (next === 'reference') {
                  setReferenceLibraries([]);
                  setEnumOptions([]);
                } else {
                  setEnumOptions([]);
                  setReferenceLibraries([]);
                }
              }}
              placeholder="Select type"
              className={styles.dataTypeSelect}
              style={{ width: '100%' }}
              getPopupContainer={(node) => node.parentElement ?? document.body}
              options={FIELD_TYPE_OPTIONS.map((opt) => ({
                value: opt.value,
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Image src={getFieldTypeIcon(opt.value)} alt="" width={16} height={16} className={styles.typeIcon} />
                    {opt.label}
                  </span>
                ),
              }))}
            />
          </div>
          <div className={styles.field}>
            <label className={`${styles.label} ${styles.labelOptional}`} htmlFor="add-column-desc">
              Description
            </label>
            <Input.TextArea
              id="add-column-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="Type..."
              className={styles.textarea}
              rows={1}
              maxLength={DESCRIPTION_MAX}
              showCount={false}
            />
            <span className={styles.hint}>({DESCRIPTION_MAX} characters limit)</span>
          </div>
          {dataType === 'enum' && (
            <div className={styles.field}>
              <label className={styles.label}>
                Options<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
              </label>
              <div className={styles.optionsContainer}>
                {enumOptions.map((opt, index) => (
                  <div key={index} className={styles.optionRow}>
                    <Input
                      value={opt}
                      onChange={(e) => {
                        const value = e.target.value;
                        setEnumOptions((prev) => {
                          const next = [...prev];
                          next[index] = value;
                          return next;
                        });
                      }}
                      placeholder="Enter option"
                      className={styles.optionInput}
                    />
                    <button
                      type="button"
                      className={styles.removeOptionBtn}
                      onClick={() => {
                        setEnumOptions((prev) => prev.filter((_, i) => i !== index));
                      }}
                      aria-label="Remove option"
                    >
                      −
                    </button>
                  </div>
                ))}
                {enumOptions.length === 0 && (
                  <div className={styles.emptyOptionsHint}>Click "Add option" to define choices.</div>
                )}
                <button
                  type="button"
                  className={styles.addOptionBtn}
                  onClick={() => setEnumOptions((prev) => [...prev, ''])}
                >
                  + Add option
                </button>
              </div>
            </div>
          )}
          {dataType === 'reference' && (
            <div className={styles.field}>
              <label className={styles.label}>
                Reference libraries<span style={{ color: '#dc2626', marginLeft: 4 }}>*</span>
              </label>
              <Select
                mode="multiple"
                style={{ width: '100%' }}
                placeholder="Select libraries to reference"
                value={referenceLibraries}
                loading={loadingLibraries || loadingFolders}
                onChange={(values) => {
                  setReferenceLibraries(values as string[]);
                  setError(null);
                }}
                getPopupContainer={(node) => node.parentElement ?? document.body}
                options={libraries.map((lib) => ({
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
                        {folders.map((folder) => (
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
                        {loadingLibraries || loadingFolders ? (
                          <div className={styles.referenceEmptyHint}>Loading libraries…</div>
                        ) : filteredReferenceLibraries.length === 0 ? (
                          <div className={styles.referenceEmptyHint}>No libraries found.</div>
                        ) : (
                          filteredReferenceLibraries.map((lib) => {
                            const checked = referenceLibraries.includes(lib.id);
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
                                    setReferenceLibraries((prev) => {
                                      const next = isChecked
                                        ? [...prev, lib.id]
                                        : prev.filter((id) => id !== lib.id);
                                      return Array.from(new Set(next));
                                    });
                                    setError(null);
                                  }}
                                />
                                <span className={styles.referenceOptionLabel}>{lib.name}</span>
                                {folderName && (
                                  <span className={styles.referenceOptionFolderTag}>{folderName}</span>
                                )}
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              />
              {!loadingLibraries && referenceLibraries.length === 0 && (
                <span className={styles.hint}>
                  Choose one or more libraries that this column can reference.
                </span>
              )}
            </div>
          )}
          {error && <div className={styles.errorText}>{error}</div>}
        </div>
        <div className={styles.body} style={{ paddingTop: 0, paddingBottom: '1.25rem' }}>
          <div className={styles.footer}>
            <button type="button" className={styles.cancelBtn} onClick={handleRequestClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.addBtn}
              onClick={handleSubmit}
              disabled={submitting}
            >
              Add
            </button>
          </div>
        </div>
        {showDiscardConfirm && (
          <div className={styles.confirmOverlay}>
            <div
              className={styles.confirmDialog}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-confirm-title"
              aria-describedby="discard-confirm-description"
            >
              <div className={styles.confirmHeader}>
                <h3 id="discard-confirm-title" className={styles.confirmTitle}>
                  Alert
                </h3>
                <button
                  type="button"
                  className={styles.confirmCloseBtn}
                  aria-label="Close"
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div id="discard-confirm-description" className={styles.confirmBody}>
                Are you sure you want to discard the changes?
              </div>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.confirmCancelBtn}
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.confirmDiscardBtn}
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    onClose();
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}
