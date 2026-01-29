'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input } from 'antd';
import Image from 'next/image';
import type { FieldConfig } from '../types';
import { fieldSchema } from '../validation';
import { uid } from '../types';
import { FieldsList } from './FieldsList';
import { FieldForm } from './FieldForm';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import styles from './NewSectionForm.module.css';
import sectionHeaderStyles from './SectionHeader.module.css';
import predefineExpandIcon from '@/app/assets/images/predefineExpandIcon.svg';

interface NewSectionFormProps {
  onCancel?: () => void;
  onSave: (section: { name: string; fields: FieldConfig[] }) => Promise<void>;
  saving?: boolean;
  isFirstSection?: boolean;
  sectionName: string;
}

export function NewSectionForm({ onCancel, onSave, saving, isFirstSection = false, sectionName }: NewSectionFormProps) {
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingField, setPendingField] = useState<Omit<FieldConfig, 'id'> | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingFieldRef = useRef<Omit<FieldConfig, 'id'> | null>(null);

  const handleAddField = (fieldData: Omit<FieldConfig, 'id'>) => {
    // Allow adding fields (allow undefined dataType)
    const field: FieldConfig = {
      id: uid(),
      label: fieldData.label || '',
      dataType: fieldData.dataType, // Allow undefined
      required: fieldData.required,
      ...(fieldData.enumOptions && { enumOptions: fieldData.enumOptions }),
      ...(fieldData.referenceLibraries && { referenceLibraries: fieldData.referenceLibraries }),
    };
    const updatedFields = [...fields, field];
    setFields(updatedFields);
    setErrors([]);
    
    // Auto-save after adding field (without reload to avoid flickering)
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleDeleteField = (fieldId: string) => {
    const updatedFields = fields.filter((f) => f.id !== fieldId);
    setFields(updatedFields);
    
    // Auto-save after deleting field (without reload to avoid flickering)
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleChangeField = (fieldId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    // Allow updating field (allow undefined dataType)
    const updatedFields = fields.map((f) => (f.id === fieldId ? { 
      ...f, 
      ...fieldData,
      label: fieldData.label !== undefined ? fieldData.label : f.label,
      dataType: fieldData.dataType !== undefined ? fieldData.dataType : f.dataType,
    } : f));
    setFields(updatedFields);
    setErrors([]);
    
    // Auto-save after changing field (without reload to avoid flickering)
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleReorderFields = (newOrder: FieldConfig[]) => {
    setFields(newOrder);
    setErrors([]);
    
    // Auto-save after reordering fields (without reload to avoid flickering)
    setTimeout(() => {
      void onSave({ name: sectionName, fields: newOrder });
    }, 300);
  };


  return (
    <div>
      <div className={styles.newSectionContainer}>
        <div className={styles.headerRow}>
          <div className={styles.headerLabel}>Label text</div>
          <div className={styles.headerDataType}>Data type</div>
          <div className={styles.headerActions} />
        </div>
        <FieldsList
          fields={fields}
          onChangeField={(fieldId, data) => {
            handleChangeField(fieldId, data);
          }}
          onDeleteField={handleDeleteField}
          onReorderFields={handleReorderFields}
          disabled={saving}
          isFirstSection={isFirstSection}
          invalidFields={new Set()}
        />
        <FieldForm
          onSubmit={handleAddField}
          onCancel={onCancel}
          disabled={saving}
          onFieldChange={(field) => {
            setPendingField(field);
            // Update ref synchronously for onFieldBlur to access latest value
            pendingFieldRef.current = field;
          }}
          onFieldBlur={() => {
            // Auto-save when field loses focus (including pending field if it has content)
            // Clear any existing timer
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current);
            }
            
            saveTimerRef.current = setTimeout(() => {
              const currentPendingField = pendingFieldRef.current;
              
              // If pending field has any content, add it to fields before saving
              if (currentPendingField && (currentPendingField.label?.trim() || currentPendingField.dataType)) {
                const newField: FieldConfig = {
                  id: uid(),
                  label: currentPendingField.label || '',
                  dataType: currentPendingField.dataType,
                  required: currentPendingField.required,
                  ...(currentPendingField.enumOptions && { enumOptions: currentPendingField.enumOptions }),
                  ...(currentPendingField.referenceLibraries && { referenceLibraries: currentPendingField.referenceLibraries }),
                };
                
                // Use functional update to get latest fields
                setFields((prevFields) => {
                  const updatedFields = [...prevFields, newField];
                  // Save with updated fields
                  void onSave({ name: sectionName, fields: updatedFields });
                  return updatedFields;
                });
                
                // Clear pending field
                setPendingField(null);
                pendingFieldRef.current = null;
                // Trigger reset event to clear FieldForm
                window.dispatchEvent(new CustomEvent('fieldform-reset'));
              } else {
                // No pending field content, just save current fields
                void onSave({ name: sectionName, fields });
              }
            }, 300);
          }}
          validationError={undefined}
        />
      </div>

      {errors.length > 0 && (
        <div className={styles.errorsContainer}>
          {errors.map((err, idx) => (
            <div key={idx}>{err}</div>
          ))}
        </div>
      )}

      {/* <div className={styles.newSectionActions}>
        <Button onClick={onCancel} disabled={saving} className={styles.cancelButton}>
          Cancel
        </Button>
        <Button
          type="primary"
          size="large"
          onClick={handleSave}
          loading={saving}
          className={styles.saveButton}
        >
          {saving ? 'Saving...' : 'Save Schema'}
        </Button>
      </div> */}
    </div>
  );
}

