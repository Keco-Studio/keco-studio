'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Input, Select, Switch } from 'antd';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { ReferenceField } from './ReferenceField';
import { getFieldTypeIcon } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type AssetDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  row: AssetRow;
  orderedProperties: PropertyConfig[];
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onUpdateRow: (assetId: string, name: string, propertyValues: Record<string, any>) => Promise<void>;
  onMediaFileChange: (rowId: string, propertyKey: string, value: MediaFileMetadata | null) => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: string | null, rowId: string) => void;
  assetNamesCache: Record<string, string>;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
  onAvatarMouseLeave: () => void;
};

function getTypeBadgeLabel(property: PropertyConfig): string {
  const t = property.dataType;
  switch (t) {
    case 'string':
      return 'String';
    case 'int':
      return 'Int';
    case 'float':
      return 'Float';
    case 'boolean':
      return 'Boolean';
    case 'enum':
      return 'Option';
    case 'reference':
      return 'Reference';
    case 'image':
      return 'Image';
    case 'file':
      return 'File';
    case 'date':
      return 'Date';
    default:
      return 'String';
  }
}

export const AssetDetailDrawer: React.FC<AssetDetailDrawerProps> = ({
  open,
  onClose,
  row,
  orderedProperties,
  userRole,
  onUpdateRow,
  onMediaFileChange,
  onOpenReferenceModal,
  assetNamesCache,
  avatarRefs,
  onAvatarMouseEnter,
  onAvatarMouseLeave,
}) => {
  const isViewer = userRole === 'viewer';
  const readOnly = isViewer;

  const [localTextValues, setLocalTextValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    orderedProperties.forEach((p) => {
      const v = row.propertyValues[p.key];
      next[p.key] =
        v !== null && v !== undefined && v !== '' ? String(v) : '';
    });
    setLocalTextValues(next);
  }, [open, row.id, row.propertyValues, orderedProperties]);

  const handleFieldChange = useCallback(
    async (propertyKey: string, value: string | number | boolean | null) => {
      if (readOnly || !onUpdateRow) return;
      const property = orderedProperties.find((p) => p.key === propertyKey);
      const isNameField = property?.name === 'name' && property?.dataType === 'string';
      const assetName = isNameField && value !== null ? String(value) : row.name || 'Untitled';
      const updatedPropertyValues = { ...row.propertyValues, [propertyKey]: value };
      await onUpdateRow(row.id, assetName, updatedPropertyValues);
    },
    [row, orderedProperties, onUpdateRow, readOnly]
  );

  const commitTextValue = useCallback(
    (propertyKey: string, raw: string) => {
      if (readOnly || !onUpdateRow) return;
      const property = orderedProperties.find((p) => p.key === propertyKey);
      if (!property) return;
      const isNameField = property.name === 'name' && property.dataType === 'string';
      let value: string | number | null = raw === '' ? null : raw;
      if (property.dataType === 'int' && raw !== '' && raw !== '-') {
        const v = parseInt(raw, 10);
        if (!Number.isNaN(v)) value = v;
      } else if (property.dataType === 'float' && raw !== '' && raw !== '-' && raw !== '.') {
        const v = parseFloat(raw);
        if (!Number.isNaN(v)) value = v;
      }
      const assetName = isNameField && value !== null ? String(value) : row.name || 'Untitled';
      const updatedPropertyValues = { ...row.propertyValues, [propertyKey]: value };
      onUpdateRow(row.id, assetName, updatedPropertyValues);
    },
    [row, orderedProperties, onUpdateRow, readOnly]
  );

  const handleInputBlur = useCallback(
    (property: PropertyConfig, e: React.FocusEvent<HTMLInputElement>) => {
      if (readOnly) return;
      const raw = e.target.value;
      commitTextValue(property.key, raw);
    },
    [readOnly, commitTextValue]
  );

  if (!open) return null;

  const firstProp = orderedProperties[0];
  const firstValue = firstProp ? row.propertyValues[firstProp.key] : undefined;
  const getTitleDisplay = (): string => {
    if (!firstProp || firstValue === null || firstValue === undefined || firstValue === '')
      return row.name || 'Untitled';
    const val = firstValue;
    if (firstProp.dataType === 'reference' && typeof val === 'string') {
      return (assetNamesCache[val] ?? val) || (row.name || 'Untitled');
    }
    if (val && typeof val === 'object' && 'fileName' in (val as object)) {
      return ((val as MediaFileMetadata).fileName ?? row.name) || 'Untitled';
    }
    return String(val) || row.name || 'Untitled';
  };

  return (
    <>
      <div
        className={styles.detailDrawerOverlay}
        onClick={onClose}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        role="button"
        tabIndex={0}
        aria-label="Close drawer"
      />
      <div className={styles.detailDrawer} role="dialog" aria-label="Asset detail">
        <div className={styles.detailDrawerHeader}>
          <h2 className={styles.detailDrawerTitle}>{getTitleDisplay()}</h2>
          <button
            type="button"
            className={styles.detailDrawerClose}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.detailDrawerBody}>
          {orderedProperties.map((property) => {
            const value = row.propertyValues[property.key];
            const isNameField = property.name === 'name' && property.dataType === 'string';
            const displayValue =
              value !== null && value !== undefined && value !== ''
                ? String(value)
                : '';

            if (property.dataType === 'reference' && property.referenceLibraries) {
              const assetId = value ? String(value) : null;
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <label className={styles.detailDrawerLabel}>{property.name}</label>
                  <div className={styles.detailDrawerTypeBadge}>
                    <Image
                      src={getFieldTypeIcon(property.dataType as any)}
                      alt={property.dataType}
                      width={16}
                      height={16}
                      className="icon-16"
                      style={{ marginRight: 4 }}
                    />
                    {getTypeBadgeLabel(property)}
                  </div>
                  <div className={styles.detailDrawerInputWrap}>
                    <ReferenceField
                      property={property}
                      assetId={assetId}
                      rowId={row.id}
                      assetNamesCache={assetNamesCache}
                      isCellSelected={true}
                      avatarRefs={avatarRefs}
                      onAvatarMouseEnter={onAvatarMouseEnter}
                      onAvatarMouseLeave={onAvatarMouseLeave}
                      onOpenReferenceModal={onOpenReferenceModal}
                    />
                  </div>
                </div>
              );
            }

            if (property.dataType === 'image' || property.dataType === 'file') {
              let mediaValue: MediaFileMetadata | null = null;
              if (value) {
                if (typeof value === 'string') {
                  try {
                    mediaValue = JSON.parse(value) as MediaFileMetadata;
                  } catch {
                    mediaValue = null;
                  }
                } else if (typeof value === 'object' && value !== null) {
                  mediaValue = value as MediaFileMetadata;
                }
              }
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <label className={styles.detailDrawerLabel}>{property.name}</label>
                  <span className={styles.detailDrawerTypeBadge}>
                    <Image
                      src={getFieldTypeIcon(property.dataType as any)}
                      alt={property.dataType}
                      width={16}
                      height={16}
                      className="icon-16"
                      style={{ marginRight: 4 }}
                    />
                    {getTypeBadgeLabel(property)}
                  </span>
                  <div className={styles.detailDrawerInputWrap}>
                    <MediaFileUpload
                      value={mediaValue || null}
                      onChange={(v) => onMediaFileChange(row.id, property.key, v)}
                      disabled={readOnly}
                      fieldType={property.dataType}
                    />
                  </div>
                </div>
              );
            }

            if (property.dataType === 'boolean') {
              const checked = value === true || value === 'true' || String(value).toLowerCase() === 'true';
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <label className={styles.detailDrawerLabel}>{property.name}</label>
                  <span className={styles.detailDrawerTypeBadge}>
                    <Image
                      src={getFieldTypeIcon(property.dataType as any)}
                      alt={property.dataType}
                      width={16}
                      height={16}
                      className="icon-16"
                      style={{ marginRight: 4 }}
                    />
                    {getTypeBadgeLabel(property)}
                  </span>
                  <div className={styles.detailDrawerInputWrap}>
                    <Switch
                      checked={checked}
                      onChange={(v) => handleFieldChange(property.key, v)}
                      disabled={readOnly}
                    />
                  </div>
                </div>
              );
            }

            if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
              const selectValue = displayValue || undefined;
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <label className={styles.detailDrawerLabel}>{property.name}</label>
                  <span className={styles.detailDrawerTypeBadge}>
                    <Image
                      src={getFieldTypeIcon(property.dataType as any)}
                      alt={property.dataType}
                      width={16}
                      height={16}
                      className="icon-16"
                      style={{ marginRight: 4 }}
                    />
                    {getTypeBadgeLabel(property)}
                  </span>
                  <div className={styles.detailDrawerInputWrap}>
                    <Select
                      value={selectValue}
                      onChange={(v) => handleFieldChange(property.key, v ?? null)}
                      disabled={readOnly}
                      style={{ width: '100%' }}
                      getPopupContainer={(n) => n.parentElement ?? document.body}
                      options={property.enumOptions.map((opt) => ({ label: opt, value: opt }))}
                    />
                  </div>
                </div>
              );
            }

            const inputValue = localTextValues[property.key] ?? displayValue;
            return (
              <div key={property.id} className={styles.detailDrawerField}>
                <label className={styles.detailDrawerLabel}>{property.name}</label>
                <span className={styles.detailDrawerTypeBadge}>
                  <Image
                    src={getFieldTypeIcon(property.dataType as any)}
                    alt={property.dataType}
                    width={16}
                    height={16}
                    className="icon-16"
                    style={{ marginRight: 4 }}
                  />
                  {getTypeBadgeLabel(property)}
                </span>
                <div className={styles.detailDrawerInputWrap}>
                  <Input
                    value={inputValue}
                    onChange={(e) => {
                      let v = e.target.value;
                      if (property.dataType === 'int') v = v.replace(/[^\d-]/g, '');
                      else if (property.dataType === 'float') v = v.replace(/[^\d.-]/g, '');
                      setLocalTextValues((prev) => ({ ...prev, [property.key]: v }));
                    }}
                    onBlur={(e) => handleInputBlur(property, e)}
                    onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                    disabled={readOnly}
                    className={styles.detailDrawerInput}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
