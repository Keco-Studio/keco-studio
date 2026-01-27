'use client';
import { useState, useEffect, useCallback } from 'react';
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

  // If this is the first section, automatically add mandatory name field on initialization
  useEffect(() => {
    if (isFirstSection && fields.length === 0) {
      const nameField: FieldConfig = {
        id: uid(),
        label: 'name',
        dataType: 'string',
        required: true,
      };
      setFields([nameField]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstSection]);

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
    
    // Auto-save after adding field
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleDeleteField = (fieldId: string) => {
    const updatedFields = fields.filter((f) => f.id !== fieldId);
    setFields(updatedFields);
    
    // Auto-save after deleting field
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleChangeField = (fieldId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    // If this is the mandatory name field of the first section, don't allow modifying label and dataType
    if (isFirstSection) {
      const field = fields.find((f) => f.id === fieldId);
      if (field && field.label === 'name' && field.dataType === 'string') {
        // Only allow modifying required property, don't allow modifying label and dataType
        const updatedFields = fields.map((f) => (f.id === fieldId ? { ...f, required: fieldData.required } : f));
        setFields(updatedFields);
        setErrors([]);
        // Auto-save after changing field
        setTimeout(() => {
          void onSave({ name: sectionName, fields: updatedFields });
        }, 300);
        return;
      }
    }

    // Allow updating field (allow undefined dataType)
    const updatedFields = fields.map((f) => (f.id === fieldId ? { 
      ...f, 
      ...fieldData,
      label: fieldData.label !== undefined ? fieldData.label : f.label,
      dataType: fieldData.dataType !== undefined ? fieldData.dataType : f.dataType,
    } : f));
    setFields(updatedFields);
    setErrors([]);
    
    // Auto-save after changing field
    setTimeout(() => {
      void onSave({ name: sectionName, fields: updatedFields });
    }, 300);
  };

  const handleReorderFields = (newOrder: FieldConfig[]) => {
    setFields(newOrder);
    setErrors([]);
    
    // Auto-save after reordering fields
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

