'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { App, Input, Select, Switch, Tooltip } from 'antd';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { ReferenceField } from './ReferenceField';
import { getFieldTypeIcon } from '@/app/(dashboard)/[projectId]/[libraryId]/predefine/utils';
import { evaluateFormulaForRow, getCustomFormulaExpressionFromCellValue } from '@/components/libraries/utils/formulaEvaluation';
import formulaIcon from '@/assets/images/formula.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';
import { normalizeReferenceSelections, normalizeReferenceValueToAssetIds } from '@/lib/utils/referenceValue';

export type AssetDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  row: AssetRow;
  orderedProperties: PropertyConfig[];
  userRole: 'admin' | 'editor' | 'viewer' | null;
  onUpdateRow: (assetId: string, name: string, propertyValues: Record<string, any>) => Promise<void>;
  onMediaFileChange: (rowId: string, propertyKey: string, value: MediaFileMetadata | null) => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: unknown, rowId: string) => void;
  assetNamesCache: Record<string, string>;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onAvatarMouseEnter: (
    assetId: string,
    element: HTMLDivElement,
    selection?: { fieldLabel?: string | null; displayValue?: string | null }
  ) => void;
  onAvatarMouseLeave: () => void;
};

function getTypeBadgeLabel(property: PropertyConfig): string {
  const t = property.dataType;
  switch (t) {
    case 'string':
      return 'String';
    case 'int':
      return 'Int';
    case 'int_array':
      return 'Int Array';
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
    case 'formula':
      return 'Formula';
    default:
      return 'String';
  }
}

function validateValueByTypeForDrawer(
  value: string,
  dataType: string
): { isValid: boolean; normalizedValue: string | number | null } {
  if (value === '' || value === null || value === undefined) {
    return { isValid: true, normalizedValue: null };
  }

  if (dataType === 'int') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '-') {
      return { isValid: true, normalizedValue: null };
    }
    if (trimmed.includes('.')) {
      return { isValid: false, normalizedValue: null };
    }
    const intValue = parseInt(trimmed, 10);
    if (Number.isNaN(intValue)) {
      return { isValid: false, normalizedValue: null };
    }
    return { isValid: true, normalizedValue: intValue };
  }

  if (dataType === 'float') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') {
      return { isValid: true, normalizedValue: null };
    }
    if (!trimmed.includes('.')) {
      return { isValid: false, normalizedValue: null };
    }
    const floatValue = parseFloat(trimmed);
    if (Number.isNaN(floatValue)) {
      return { isValid: false, normalizedValue: null };
    }
    return { isValid: true, normalizedValue: floatValue };
  }

  if (dataType === 'date') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { isValid: true, normalizedValue: null };
    }
    const timestamp = Date.parse(trimmed);
    if (Number.isNaN(timestamp)) {
      return { isValid: false, normalizedValue: null };
    }
    return { isValid: true, normalizedValue: trimmed };
  }

  return { isValid: true, normalizedValue: value === '' ? null : value };
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
  const { message } = App.useApp();

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

      if (
        property.dataType === 'int' ||
        property.dataType === 'float' ||
        property.dataType === 'date'
      ) {
        const { isValid, normalizedValue } = validateValueByTypeForDrawer(
          raw,
          property.dataType
        );
        if (!isValid) {
          message.error('datatype mismatch');
          setLocalTextValues((prev) => ({
            ...prev,
            [property.key]:
              row.propertyValues[property.key] !== null &&
              row.propertyValues[property.key] !== undefined &&
              row.propertyValues[property.key] !== ''
                ? String(row.propertyValues[property.key])
                : '',
          }));
          return;
        }
        value = normalizedValue;
      }

      const assetName = isNameField && value !== null ? String(value) : row.name || 'Untitled';
      const updatedPropertyValues = { ...row.propertyValues, [propertyKey]: value };
      onUpdateRow(row.id, assetName, updatedPropertyValues);
    },
    [row, orderedProperties, onUpdateRow, readOnly, message]
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
    if (firstProp.dataType === 'reference') {
      const selections = normalizeReferenceSelections(val);
      const firstSelection = selections[0];
      if (firstSelection) {
        if (firstSelection.displayValue && String(firstSelection.displayValue).trim() !== '') {
          return String(firstSelection.displayValue);
        }
        return (assetNamesCache[firstSelection.assetId] ?? firstSelection.assetId) || (row.name || 'Untitled');
      }
    }
    if (val && typeof val === 'object' && 'fileName' in (val as object)) {
      return ((val as MediaFileMetadata).fileName ?? row.name) || 'Untitled';
    }
    return String(val) || row.name || 'Untitled';
  };
  const titleDisplay = getTitleDisplay();

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
          <Tooltip
            title={titleDisplay}
            zIndex={2100}
            getPopupContainer={(triggerNode) => triggerNode.parentElement ?? document.body}
          >
            <h2 className={styles.detailDrawerTitle}>{titleDisplay}</h2>
          </Tooltip>
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
              const assetIds = normalizeReferenceValueToAssetIds(value);
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <div className={styles.detailDrawerFieldHeader}>
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
                  </div>
                  <div className={styles.detailDrawerInputWrap}>
                    <ReferenceField
                      property={property}
                      assetIds={assetIds}
                      currentValue={value}
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

            if (
              property.dataType === 'image' ||
              property.dataType === 'file' ||
              property.dataType === 'multimedia' ||
              property.dataType === 'audio'
            ) {
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
                  <div className={styles.detailDrawerFieldHeader}>
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
                  </div>
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
                  <div className={styles.detailDrawerFieldHeader}>
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
                  </div>
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
                  <div className={styles.detailDrawerFieldHeader}>
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
                  </div>
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

            if (property.dataType === 'formula') {
              const customFormulaExpression = getCustomFormulaExpressionFromCellValue(
                row.propertyValues[property.key]
              );
              const effectiveFormulaExpression =
                customFormulaExpression ?? property.formulaExpression;
              const formulaResult = evaluateFormulaForRow(
                effectiveFormulaExpression,
                row,
                orderedProperties
              );

              if (typeof formulaResult === 'boolean') {
                return (
                  <div key={property.id} className={styles.detailDrawerField}>
                    <div className={styles.detailDrawerFieldHeader}>
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
                    </div>
                    <div className={`${styles.detailDrawerInputWrap} ${styles.detailDrawerFormulaWrap}`}>
                      <Switch checked={formulaResult} disabled />
                      {customFormulaExpression ? (
                        <Tooltip
                          title={customFormulaExpression.replace(/^=/, '')}
                          zIndex={2100}
                          getPopupContainer={(triggerNode) =>
                            triggerNode.parentElement ?? document.body
                          }
                        >
                          <Image
                            src={formulaIcon}
                            alt="Custom formula"
                            width={16}
                            height={16}
                            className={styles.customFormulaIcon}
                          />
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                );
              }

              const formulaDisplay =
                formulaResult === null || formulaResult === undefined ? '' : String(formulaResult);
              return (
                <div key={property.id} className={styles.detailDrawerField}>
                  <div className={styles.detailDrawerFieldHeader}>
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
                  </div>
                  <div className={`${styles.detailDrawerInputWrap} ${styles.detailDrawerFormulaWrap}`}>
                    <Tooltip
                      title={formulaDisplay}
                      zIndex={2100}
                      getPopupContainer={(triggerNode) =>
                        triggerNode.parentElement ?? document.body
                      }
                    >
                      <Input
                        value={formulaDisplay}
                        disabled
                        className={`${styles.detailDrawerInput} ${styles.detailDrawerFormulaInput}`}
                      />
                    </Tooltip>
                    {customFormulaExpression ? (
                      <Tooltip
                        title={customFormulaExpression.replace(/^=/, '')}
                        zIndex={2100}
                        getPopupContainer={(triggerNode) =>
                          triggerNode.parentElement ?? document.body
                        }
                      >
                        <Image
                          src={formulaIcon}
                          alt="Custom formula"
                          width={16}
                          height={16}
                          className={styles.customFormulaIcon}
                        />
                      </Tooltip>
                    ) : null}
                  </div>
                </div>
              );
            }

            const inputValue = localTextValues[property.key] ?? displayValue;
            const isStringType = property.dataType === 'string';
            return (
              <div key={property.id} className={styles.detailDrawerField}>
                <div className={styles.detailDrawerFieldHeader}>
                  <label className={styles.detailDrawerLabel}>{property.name}</label>
                  <span className={
                    isStringType
                    ? `${styles.detailDrawerTypeBadge} ${styles.detailDrawerTypeBadgeString}`
                    : styles.detailDrawerTypeBadge
                  }>
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
                </div>
                <div className={styles.detailDrawerInputWrap}>
                  <Tooltip
                    title={inputValue}
                    zIndex={2100}
                    getPopupContainer={(triggerNode) => triggerNode.parentElement ?? document.body}
                  >
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
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};
