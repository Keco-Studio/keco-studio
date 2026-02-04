import React, { useRef } from 'react';
import { Input, Select, Switch } from 'antd';
import Image from 'next/image';
import { PropertyConfig } from '@/lib/types/libraryAssets';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { ReferenceField } from './ReferenceField';
import libraryAssetTableSelectIcon from '@/assets/images/LibraryAssetTableSelectIcon2.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export interface AddNewRowFormProps {
  orderedProperties: PropertyConfig[];
  newRowData: Record<string, any>;
  isSaving: boolean;
  userRole: 'admin' | 'editor' | 'viewer' | null;
  openEnumSelects: Record<string, boolean>;
  assetNamesCache: Record<string, string>;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  // Event handlers
  handleInputChange: (key: string, value: any) => void;
  handleMediaFileChange: (key: string, value: MediaFileMetadata | null) => void;
  handleOpenReferenceModal: (property: PropertyConfig, currentValue: string | null, rowId: string) => void;
  handleAvatarMouseEnter: (assetId: string, element: HTMLDivElement) => void;
  handleAvatarMouseLeave: () => void;
  setOpenEnumSelects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

/**
 * AddNewRowForm component for LibraryAssetsTable
 * Renders the form for adding a new asset row
 */
export const AddNewRowForm: React.FC<AddNewRowFormProps> = ({
  orderedProperties,
  newRowData,
  isSaving,
  userRole,
  openEnumSelects,
  assetNamesCache,
  avatarRefs,
  handleInputChange,
  handleMediaFileChange,
  handleOpenReferenceModal,
  handleAvatarMouseEnter,
  handleAvatarMouseLeave,
  setOpenEnumSelects,
}) => {
  return (
    <>
      {orderedProperties.map((property) => {
        // Check if this is a reference type field
        if (property.dataType === 'reference' && property.referenceLibraries) {
          const assetId = newRowData[property.key] ? String(newRowData[property.key]) : null;
          
          return (
            <td 
              key={property.id} 
              className={styles.editCell}
              onMouseEnter={(e) => {
                // Show ASSET CARD when hovering over cell with assetId
                if (assetId) {
                  handleAvatarMouseEnter(assetId, e.currentTarget);
                }
              }}
              onMouseLeave={(e) => {
                // Hide ASSET CARD when leaving cell
                if (assetId) {
                  handleAvatarMouseLeave();
                }
              }}
            >
              <div className={styles.referenceInputContainer}>
                <ReferenceField
                  property={property}
                  assetId={assetId}
                  rowId="new"
                  assetNamesCache={assetNamesCache}
                  isCellSelected={false}
                  avatarRefs={avatarRefs}
                  onAvatarMouseEnter={handleAvatarMouseEnter}
                  onAvatarMouseLeave={handleAvatarMouseLeave}
                  onOpenReferenceModal={handleOpenReferenceModal}
                />
              </div>
            </td>
          );
        }
        
        // Check if this is an image or file type field
        if (property.dataType === 'image' || property.dataType === 'file') {
          const mediaValue = newRowData[property.key] as MediaFileMetadata | null | undefined;
          return (
            <td key={property.id} className={styles.editCell}>
              <MediaFileUpload
                value={mediaValue || null}
                onChange={(value) => handleMediaFileChange(property.key, value)}
                disabled={isSaving || userRole === 'viewer'}
                fieldType={property.dataType}
              />
            </td>
          );
        }
        
        // Check if this is a boolean type field
        if (property.dataType === 'boolean') {
          const boolValue = newRowData[property.key];
          const checked = boolValue === true || boolValue === 'true' || String(boolValue).toLowerCase() === 'true';
          
          return (
            <td key={property.id} className={styles.editCell}>
              <div className={styles.booleanToggle}>
                <Switch
                  checked={checked}
                  onChange={(checked) => handleInputChange(property.key, checked)}
                  disabled={isSaving}
                />
                <span className={styles.booleanLabel}>
                  {checked ? 'True' : 'False'}
                </span>
              </div>
            </td>
          );
        }
        
        // Check if this is an enum/option type field
        if (property.dataType === 'enum' && property.enumOptions && property.enumOptions.length > 0) {
          const enumSelectKey = `new-${property.key}`;
          const isOpen = openEnumSelects[enumSelectKey] || false;
          const value = newRowData[property.key];
          const display = value !== null && value !== undefined && value !== '' ? String(value) : null;
          
          return (
            <td key={property.id} className={styles.editCell}>
              <div className={styles.enumSelectWrapper}>
                <Select
                  value={display || undefined}
                  open={isOpen}
                  onOpenChange={(open) => {
                    setOpenEnumSelects(prev => ({
                      ...prev,
                      [enumSelectKey]: open
                    }));
                  }}
                  onChange={(newValue) => {
                    handleInputChange(property.key, newValue);
                    // Close dropdown
                    setOpenEnumSelects(prev => ({
                      ...prev,
                      [enumSelectKey]: false
                    }));
                  }}
                  className={styles.enumSelectDisplay}
                  suffixIcon={null}
                  disabled={isSaving}
                  getPopupContainer={() => document.body}
                >
                  {property.enumOptions.map((option) => (
                    <Select.Option key={option} value={option} title="">
                      {option}
                    </Select.Option>
                  ))}
                </Select>
                <Image
                  src={libraryAssetTableSelectIcon}
                  alt=""
                  width={16}
                  height={16}
                  className={styles.enumSelectIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenEnumSelects(prev => ({
                      ...prev,
                      [enumSelectKey]: !prev[enumSelectKey]
                    }));
                  }}
                />
              </div>
            </td>
          );
        }
        
        // Determine input type and validation based on data type
        const isInt = property.dataType === 'int';
        const isFloat = property.dataType === 'float';
        const inputType = isInt || isFloat ? 'number' : 'text';
        const step = isInt ? '1' : isFloat ? 'any' : undefined;
        
        return (
          <td key={property.id} className={styles.editCell}>
            <Input
              type={inputType}
              step={step}
              value={newRowData[property.key] || ''}
              onChange={(e) => {
                let value = e.target.value;
                // Validate int type: only allow integers
                if (isInt && value !== '') {
                  // Remove any non-digit characters except minus sign at the start
                  const cleaned = value.replace(/[^\d-]/g, '');
                  const intValue = cleaned.startsWith('-') 
                    ? '-' + cleaned.slice(1).replace(/-/g, '')
                    : cleaned.replace(/-/g, '');
                  
                  // Only update if valid integer format
                  if (!/^-?\d*$/.test(intValue)) {
                    return; // Don't update if invalid
                  }
                  value = intValue;
                }
                // Validate float type: allow decimals (integers are also valid for float)
                else if (isFloat && value !== '') {
                  // Remove invalid characters but keep valid float format
                  const cleaned = value.replace(/[^\d.-]/g, '');
                  const floatValue = cleaned.startsWith('-') 
                    ? '-' + cleaned.slice(1).replace(/-/g, '')
                    : cleaned.replace(/-/g, '');
                  // Ensure only one decimal point
                  const parts = floatValue.split('.');
                  const finalValue = parts.length > 2 
                    ? parts[0] + '.' + parts.slice(1).join('')
                    : floatValue;
                  
                  if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                    return; // Don't update if invalid
                  }
                  value = finalValue;
                }
                handleInputChange(property.key, value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Delete') {
                  e.preventDefault();
                  handleInputChange(property.key, '');
                }
              }}
              placeholder=""
              className={styles.editInput}
              disabled={isSaving}
            />
          </td>
        );
      })}
    </>
  );
};

