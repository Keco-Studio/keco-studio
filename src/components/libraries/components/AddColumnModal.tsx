'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select } from 'antd';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { getFieldTypeIcon, FIELD_TYPE_OPTIONS } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import { useSupabase } from '@/lib/SupabaseContext';
import { listLibraries, type Library } from '@/lib/services/libraryService';
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<any>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

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
      updatePosition();
      setTimeout(() => nameInputRef.current?.focus(), 80);
    }
  }, [open]);

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
      onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose, anchorRef]);

  // Lazy-load libraries when configuring a reference field
  useEffect(() => {
    if (!open || dataType !== 'reference' || !projectId) return;

    setLoadingLibraries(true);
    const loadLibraries = async () => {
      try {
        const libs = await listLibraries(supabase, projectId);
        const filtered = libs.filter((lib) => lib.id !== currentLibraryId);
        setLibraries(filtered);
      } catch (e) {
        console.error('Failed to load libraries for reference field', e);
        setLibraries([]);
      } finally {
        setLoadingLibraries(false);
      }
    };

    void loadLibraries();
  }, [open, dataType, projectId, currentLibraryId, supabase]);

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
    if (e.key === 'Escape') onClose();
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
            onClick={onClose}
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
                loading={loadingLibraries}
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
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
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
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
}
