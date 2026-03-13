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
import {
  isFormulaExpressionValid,
  type FormulaEvaluableField,
  hasFormulaCircularReference,
  getFormulaReferencedFieldNames,
} from '@/lib/utils/formula';
import styles from './EditColumnModal.module.css';
import addColumnStyles from './AddColumnModal.module.css';

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
  propertyFormulaExpression?: string;
  /** 当前库已有的字段列表，用于校验重名 */
  existingProperties?: PropertyConfig[];
  onClose: () => void;
};

type EditColumnFormState = {
  propertyId?: string;
  name: string;
  dataType?: PropertyConfig['dataType'];
  description: string;
  enumOptions: string[];
  referenceLibraries: string[];
  formulaExpression: string;
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
  formulaExpression: '',
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
  propertyFormulaExpression,
  existingProperties,
  onClose,
}: EditColumnModalProps) {
  const supabase = useSupabase();
  const params = useParams();
  const queryClient = useQueryClient();
  const libraryId = params?.libraryId as string | undefined;
  const projectId = params?.projectId as string | undefined;

  const [editColumnModal, setEditColumnModal] = useState<EditColumnFormState>(EMPTY_STATE);
  const [referenceFolderFilter, setReferenceFolderFilter] =
    useState<'all' | 'root' | string>('all');
  const [referenceSearch, setReferenceSearch] = useState('');
  const [referenceDropdownOpen, setReferenceDropdownOpen] = useState(false);
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [dataTypeSearch, setDataTypeSearch] = useState('');
  const [formulaDropdownOpen, setFormulaDropdownOpen] = useState(false);
  const dataTypeSearchRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const filteredFieldTypeOptions = useMemo(() => {
    if (!dataTypeSearch.trim()) return FIELD_TYPE_OPTIONS;
    const q = dataTypeSearch.trim().toLowerCase();
    return FIELD_TYPE_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [dataTypeSearch]);

  // Initialize form state with current column configuration when modal opens
  useEffect(() => {
    if (!open || !propertyId) return;

    setShowOverwriteConfirm(false);
    setEditColumnModal({
      propertyId,
      name: propertyName ?? '',
      dataType: propertyDataType,
      description: propertyDescription ?? '',
      enumOptions: propertyDataType === 'enum' ? propertyEnumOptions ?? [] : [],
      referenceLibraries:
        propertyDataType === 'reference' ? propertyReferenceLibraries ?? [] : [],
      formulaExpression:
        propertyDataType === 'formula' ? propertyFormulaExpression ?? '' : '',
      libraries: [],
      folders: [],
      loadingLibraries: false,
      loadingFolders: false,
      error: null,
    });
    setReferenceFolderFilter('all');
    setReferenceSearch('');
    setReferenceDropdownOpen(false);
    setFormulaDropdownOpen(false);
  }, [
    open,
    propertyId,
    propertyName,
    propertyDescription,
    propertyDataType,
    propertyEnumOptions,
    propertyReferenceLibraries,
    propertyFormulaExpression,
  ]);

  // 关闭时重置内部状态
  useEffect(() => {
    if (!open) {
      setShowOverwriteConfirm(false);
      setEditColumnModal(EMPTY_STATE);
      setReferenceFolderFilter('all');
      setReferenceSearch('');
      setReferenceDropdownOpen(false);
    }
  }, [open]);

  // Click outside to close the modal (but does not close when clicking on the overlay of the Alert dialog)
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // If the Alert dialog is currently displayed, clicking anywhere inside the dialog or its overlay does not trigger close
      if (showOverwriteConfirm) {
        if (
          target.closest(`.${addColumnStyles.confirmOverlay}`) ||
          target.closest(`.${addColumnStyles.confirmDialog}`)
        ) {
          return;
        }
      }

      if (modalRef.current && modalRef.current.contains(target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown, true);
    };
  }, [open, onClose, showOverwriteConfirm]);

  // When the edit popup opens and the reference type is selected, load the list of optional libraries and folders
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

  const validateForm = () => {
    // Frontend validation: name and type are required, enum/reference need to be configured completely
    const trimmedName = editColumnModal.name.trim();
    if (!trimmedName) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Header name is required.',
      }));
      return false;
    }
    if (
      existingProperties &&
      existingProperties.some(
        (prop) =>
          prop.id !== editColumnModal.propertyId &&
          prop.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Header name already exists.',
      }));
      return false;
    }
    if (!editColumnModal.dataType) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Data type is required.',
      }));
      return false;
    }
    if (
      editColumnModal.dataType === 'enum' &&
      editColumnModal.enumOptions.every((opt) => !opt.trim())
    ) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Please add at least one option for enum type.',
      }));
      return false;
    }
    if (
      editColumnModal.dataType === 'reference' &&
      editColumnModal.referenceLibraries.length === 0
    ) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Please select at least one reference library.',
      }));
      return false;
    }
    if (
      editColumnModal.dataType === 'formula' &&
      !editColumnModal.formulaExpression.trim()
    ) {
      setEditColumnModal((prev) => ({
        ...prev,
        error: 'Please enter a formula expression.',
      }));
      return false;
    }

    if (editColumnModal.dataType === 'formula') {
      const expr = editColumnModal.formulaExpression.trim();
      if (!isFormulaExpressionValid(expr)) {
        setEditColumnModal((prev) => ({
          ...prev,
          error: 'Formula contains an error',
        }));
        return false;
      }

      // Validate that the formula does not reference non-calculable columns.
      // Only numeric or formula columns are allowed to participate in calculations.
      if (existingProperties && existingProperties.length > 0) {
        const referencedNames = getFormulaReferencedFieldNames(expr);
        if (referencedNames.length > 0) {
          const nonCalculable = referencedNames
            .map((name) =>
              existingProperties.find(
                (prop) => prop.name.trim().toLowerCase() === name.trim().toLowerCase()
              )
            )
            .filter(
              (prop): prop is PropertyConfig =>
                !!prop &&
                !['int', 'float', 'formula'].includes((prop.dataType ?? '').toString())
            );

          if (nonCalculable.length > 0) {
            setEditColumnModal((prev) => ({
              ...prev,
              error: 'This column cannot be calculated',
            }));
            return false;
          }
        }
      }

      // Circular reference detection for editing an existing formula column.
      // We construct the prospective schema after this change, then run a static
      // cycle check between all formula columns by column name.
      if (existingProperties && existingProperties.length > 0 && editColumnModal.propertyId) {
        const fields: FormulaEvaluableField[] = existingProperties.map((prop) => ({
          id: prop.id,
          name: prop.name,
          dataType: prop.dataType ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formulaExpression:
            prop.id === editColumnModal.propertyId
              ? expr
              : ((prop as any).formulaExpression ?? null),
        }));

        if (hasFormulaCircularReference(fields)) {
          setEditColumnModal((prev) => ({
            ...prev,
            error: 'Formula has circular reference',
          }));
          return false;
        }
      }
    }

    if (!libraryId || !editColumnModal.propertyId) {
      showErrorToast('Missing libraryId or column id, cannot save');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      await updateLibraryField(supabase, libraryId!, editColumnModal.propertyId!, {
        label: editColumnModal.name,
        dataType: editColumnModal.dataType,
        description: editColumnModal.description.trim() || undefined,
        enumOptions: editColumnModal.enumOptions,
        referenceLibraries: editColumnModal.referenceLibraries,
        formulaExpression:
          editColumnModal.dataType === 'formula'
            ? editColumnModal.formulaExpression.trim()
            : undefined,
      });

      await queryClient.invalidateQueries({
        queryKey: queryKeys.librarySchema(libraryId!),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.libraryAssets(libraryId!),
      });
      showSuccessToast('Column updated');
      onClose();
    } catch (e: any) {
      showErrorToast(e?.message || 'Failed to update column');
    }
  };

  /** Check if two string arrays are equal (order and elements match) */
  const stringArraysEqual = (a: string[], b: string[] | undefined): boolean => {
    const left = a ?? [];
    const right = b ?? [];
    if (left.length !== right.length) return false;
    return left.every((v, i) => v === right[i]);
  };

  /** Whether there are modifications that will overwrite the column data: type, enum, reference library, description, etc.; only changing the column name does not count */
  const hasOverwriteRelevantChanges = (): boolean => {
    const nameChanged = (editColumnModal.name ?? '').trim() !== (propertyName ?? '').trim();
    const descChanged =
      (editColumnModal.description ?? '').trim() !== (propertyDescription ?? '').trim();
    const typeChanged = editColumnModal.dataType !== propertyDataType;
    const enumChanged = !stringArraysEqual(
      editColumnModal.enumOptions ?? [],
      propertyDataType === 'enum' ? propertyEnumOptions ?? [] : [],
    );
    const refChanged = !stringArraysEqual(
      editColumnModal.referenceLibraries ?? [],
      propertyDataType === 'reference' ? propertyReferenceLibraries ?? [] : [],
    );
    const formulaChanged =
      (editColumnModal.formulaExpression ?? '').trim() !==
      (propertyDataType === 'formula' ? propertyFormulaExpression ?? '' : '').trim();
    return descChanged || typeChanged || enumChanged || refChanged || formulaChanged;
  };

  const handleSaveClick = () => {
    if (!validateForm()) {
      return;
    }
    // No modifications, or only modified the column name: save directly, without showing the overwrite confirmation
    if (!hasOverwriteRelevantChanges()) {
      void handleSubmit();
      return;
    }
    setShowOverwriteConfirm(true);
  };

  if (!open || !editColumnModal.propertyId) {
    return null;
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorPosition?.y,
    // Align the popup's right edge to the current column's right edge.
    left: anchorPosition?.x,
    transform: 'translateX(-100%)',
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
        {/* Same as AddColumnModal: the top part is scrollable, the bottom button is fixed */}
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
            onChange={(v) => {
              const next = v as PropertyConfig['dataType'];
              setEditColumnModal((prev) => ({
                ...prev,
                dataType: next,
                formulaExpression:
                  next === 'formula' ? propertyFormulaExpression ?? '' : '',
              }));
            }}
            placeholder="Select type"
            className={styles.dataTypeSelect}
            style={{ width: '100%', backgroundColor: '#ffffff' }}
            suffixIcon={
              <svg
                width="12"
                height="7"
                viewBox="0 0 12 7"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M0.75 0.75L5.75 5.75L10.75 0.75"
                  stroke="#21272A"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            getPopupContainer={(node) => node.parentElement ?? document.body}
            popupRender={(originNode) => (
              <div className={styles.dataTypeDropdown}>
                <div className={styles.dataTypeSearchWrap}>
                  <span className={styles.dataTypeSearchIcon} aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.35-4.35" />
                    </svg>
                  </span>
                  <input
                    ref={dataTypeSearchRef}
                    type="text"
                    className={styles.dataTypeSearchInput}
                    placeholder="Search"
                    value={dataTypeSearch}
                    onChange={(e) => setDataTypeSearch(e.target.value)}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                </div>
                {originNode}
              </div>
            )}
            onOpenChange={(open) => {
              if (!open) setDataTypeSearch('');
              else setTimeout(() => dataTypeSearchRef.current?.focus(), 0);
            }}
            options={filteredFieldTypeOptions.map((opt) => ({
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
        {editColumnModal.dataType === 'formula' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-column-formula">
              Column value<span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div className={styles.formulaInputWrapper}>
              <Input
                id="edit-column-formula"
                value={editColumnModal.formulaExpression}
                onChange={(e) =>
                  setEditColumnModal((prev) => ({
                    ...prev,
                    formulaExpression: e.target.value,
                  }))
                }
                placeholder="INSERT EXPRESSION"
                className={styles.formulaInput}
                onFocus={() => setFormulaDropdownOpen(true)}
                onBlur={() => {
                  setTimeout(() => setFormulaDropdownOpen(false), 120);
                }}
              />
              {formulaDropdownOpen && (
                <div className={styles.formulaDropdown}>
                  <div className={styles.formulaDropdownHeader}>
                    INSERT OPERATOR OR FUNCTION
                  </div>
                  <div className={styles.formulaDropdownSectionLabel}>Operators</div>
                  <div className={styles.formulaOperatorsRow}>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '+',
                        }));
                      }}
                      title="Add"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '-',
                        }));
                      }}
                      title="Subtraction"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '*',
                        }));
                      }}
                      title="Multiplication"
                    >
                      *
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '/',
                        }));
                      }}
                      title="Division"
                    >
                      /
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '(',
                        }));
                      }}
                      title="Left parenthesis"
                    >
                      (
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + ')',
                        }));
                      }}
                      title="Right parenthesis"
                    >
                      )
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '>',
                        }));
                      }}
                      title="Greater than"
                    >
                      &gt;
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '<',
                        }));
                      }}
                      title="Less than"
                    >
                      &lt;
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '>=',
                        }));
                      }}
                      title="Greater than or equal"
                    >
                      ≥
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '<=',
                        }));
                      }}
                      title="Less than or equal"
                    >
                      ≤
                    </button>
                    <button
                      type="button"
                      className={styles.formulaOperatorBtn}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setEditColumnModal((prev) => ({
                          ...prev,
                          formulaExpression: prev.formulaExpression + '=',
                        }));
                      }}
                      title="Equal"
                    >
                      =
                    </button>
                  </div>
                  <div className={styles.formulaDropdownSectionLabel}>Functions</div>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'IF( , , )';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>IF()</span>
                      <span className={styles.formulaItemMeta}>
                        condition returns different values
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'SUM( , , )';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>SUM()</span>
                      <span className={styles.formulaItemMeta}>sum of values</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'AVERAGE( , , )';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>AVERAGE()</span>
                      <span className={styles.formulaItemMeta}>average of values</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'MIN( , , )';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>MIN()</span>
                      <span className={styles.formulaItemMeta}>minimum of values</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'MAX( , , )';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>MAX()</span>
                      <span className={styles.formulaItemMeta}>maximum of values</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={styles.formulaItem}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const template = 'ROUND( , 2)';
                      setEditColumnModal((prev) => {
                        const needsSpace =
                          prev.formulaExpression && !prev.formulaExpression.endsWith(' ');
                        return {
                          ...prev,
                          formulaExpression: `${prev.formulaExpression}${needsSpace ? ' ' : ''}${template}`,
                        };
                      });
                    }}
                  >
                    <div className={styles.formulaItemMain}>
                      <span className={styles.formulaItemName}>ROUND()</span>
                      <span className={styles.formulaItemMeta}>round number</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Description 字段保留占位，暂不持久化到后端 */}
        <div className={styles.field}>
          <label className={`${styles.label} ${styles.labelOptional}`} htmlFor="edit-column-desc">
            Description
          </label>
          <Input.TextArea
            id="edit-column-desc"
            value={editColumnModal.description}
            onChange={(e) => {
              const nextDescription = e.target.value;
              if (nextDescription.length > 250) {
                showErrorToast('Comment cannot exceed 250 characters.');
                return;
              }
              setEditColumnModal((prev) => ({
                ...prev,
                description: nextDescription,
              }));
            }}
            placeholder="Type..."
            className={styles.textarea}
            rows={2}
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
                + Add new option
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
              className={styles.referenceSelect}
              placeholder="Select libraries to reference"
            suffixIcon={
              <svg
                width="12"
                height="7"
                viewBox="0 0 12 7"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M0.75 0.75L5.75 5.75L10.75 0.75"
                  stroke="#21272A"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
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
              onOpenChange={(openDropdown) => {
                setReferenceDropdownOpen(openDropdown);
                if (!openDropdown) {
                  setReferenceFolderFilter('all');
                  setReferenceSearch('');
                }
              }}
              popupRender={() => (
                <div className={styles.referenceDropdown}>
                  <div className={styles.referenceDropdownContent}>
                    <Input
                      allowClear
                      placeholder="Search libraries"
                      value={referenceSearch}
                      onChange={(e) => setReferenceSearch(e.target.value)}
                      className={styles.referenceSearchInput}
                      prefix={
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M20.9999 20.9999L16.6499 16.6499"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      }
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
          <button type="button" className={styles.addBtn} onClick={handleSaveClick}>
            Save
          </button>
        </div>
      </div>
    </div>
  );

  const confirmOverlay =
    showOverwriteConfirm && typeof document !== 'undefined'
      ? createPortal(
          <div className={addColumnStyles.confirmOverlay}>
            <div
              className={addColumnStyles.confirmDialog}
              style={{ height: '15.5rem' }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="overwrite-confirm-title"
              aria-describedby="overwrite-confirm-description"
            >
              <div className={addColumnStyles.confirmHeader}>
                <h3 id="overwrite-confirm-title" className={addColumnStyles.confirmTitle}>
                  Alert
                </h3>
                <button
                  type="button"
                  className={addColumnStyles.confirmCloseBtn}
                  aria-label="Close"
                  onClick={() => setShowOverwriteConfirm(false)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M12 4L4 12M4 4l8 8"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div
                id="overwrite-confirm-description"
                className={addColumnStyles.confirmBody}
              >
                This operation may overwrite the existing content in this column. Do you
                want to continue?
              </div>
              <div className={addColumnStyles.confirmActions}>
                <button
                  type="button"
                  className={addColumnStyles.confirmCancelBtn}
                  onClick={() => setShowOverwriteConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={addColumnStyles.confirmDiscardBtn}
                  style={{ background: '#0B99FF' }}
                  onClick={async () => {
                    setShowOverwriteConfirm(false);
                    await handleSubmit();
                  }}
                >
                  Overwrite
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : modalContent}
      {confirmOverlay}
    </>
  );
}

