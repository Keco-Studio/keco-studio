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
}

export function NewSectionForm({ onCancel, onSave, saving, isFirstSection = false }: NewSectionFormProps) {
  const [sectionName, setSectionName] = useState('');
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [pendingField, setPendingField] = useState<Omit<FieldConfig, 'id'> | null>(null);
  // Track invalid fields for validation UI (show red border)
  const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
  const [invalidPendingField, setInvalidPendingField] = useState<{ labelInvalid: boolean; dataTypeInvalid: boolean } | undefined>(undefined);

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
    // Allow adding empty field rows (user can fill them later)
    // Validation will happen at section save time
    const field: FieldConfig = {
      id: uid(),
      label: fieldData.label,
      dataType: fieldData.dataType,
      required: fieldData.required,
      ...(fieldData.enumOptions && { enumOptions: fieldData.enumOptions }),
      ...(fieldData.referenceLibraries && { referenceLibraries: fieldData.referenceLibraries }),
    };
    setFields((prev) => [...prev, field]);
    setErrors([]);
  };

  const handleDeleteField = (fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  const handleChangeField = (fieldId: string, fieldData: Omit<FieldConfig, 'id'>) => {
    // If this is the mandatory name field of the first section, don't allow modifying label and dataType
    if (isFirstSection) {
      const field = fields.find((f) => f.id === fieldId);
      if (field && field.label === 'name' && field.dataType === 'string') {
        // Only allow modifying required property, don't allow modifying label and dataType
        setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, required: fieldData.required } : f)));
        setErrors([]);
        return;
      }
    }

    // Allow updating field without validation
    // Validation will happen at section save time
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...fieldData } : f)));
    setErrors([]);
  };

  const handleReorderFields = (newOrder: FieldConfig[]) => {
    setFields(newOrder);
    setErrors([]);
  };

  const handleSave = useCallback(async () => {
    const trimmedName = sectionName.trim();
    if (!trimmedName) {
      setErrors(['Section name is required']);
      return;
    }

    // If there's a pending field with data, add it first
    let finalFields = fields;
    if (pendingField && pendingField.label.trim() && pendingField.dataType) {
      // Only add pending field if it has both label and dataType
      const newField: FieldConfig = {
        id: uid(),
        label: pendingField.label,
        dataType: pendingField.dataType,
        required: pendingField.required,
        ...(pendingField.enumOptions && { enumOptions: pendingField.enumOptions }),
        ...(pendingField.referenceLibraries && { referenceLibraries: pendingField.referenceLibraries }),
      };
      finalFields = [...fields, newField];
    }

    if (finalFields.length === 0) {
      setErrors(['At least one field is required']);
      return;
    }

    // Validate: check for empty labels or missing data types
    let hasInvalidFields = false;
    const newInvalidFields = new Set<string>();
    let newInvalidPendingField: { labelInvalid: boolean; dataTypeInvalid: boolean } | undefined = undefined;
    
    finalFields.forEach((field) => {
      if (!field.label || !field.label.trim() || !field.dataType) {
        hasInvalidFields = true;
        newInvalidFields.add(field.id);
      }
    });
    
    // Check pending field
    if (pendingField) {
      // If pending field exists and has any content (label OR dataType), both must be filled
      const hasLabel = pendingField.label && pendingField.label.trim();
      const hasDataType = !!pendingField.dataType;
      
      if (hasLabel || hasDataType) {
        // User has started filling the field, validate both are complete
        const labelInvalid = !hasLabel;
        const dataTypeInvalid = !hasDataType;
        if (labelInvalid || dataTypeInvalid) {
          hasInvalidFields = true;
          newInvalidPendingField = { labelInvalid, dataTypeInvalid };
        }
      }
    }

    if (hasInvalidFields) {
      const errorMessage = 'Please complete all fields: Label text and Data type are required for each field';
      setErrors([errorMessage]);
      setInvalidFields(newInvalidFields);
      setInvalidPendingField(newInvalidPendingField);
      return;
    }

    // Clear validation errors if all fields are valid
    setInvalidFields(new Set());
    setInvalidPendingField(undefined);
    setErrors([]);
    await onSave({ name: trimmedName, fields: finalFields });
  }, [sectionName, fields, pendingField, onSave]);

  // Listen to top bar "Save" button when creating new section
  useEffect(() => {
    const handler = () => {
      void handleSave();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('predefine-save-new-section', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('predefine-save-new-section', handler);
      }
    };
  }, [handleSave]);

  return (
    <div>
      <div className={styles.newSectionContainer}>
        <div className={sectionHeaderStyles.generalSection}>
          <div>
            <div>
              <Image src={predefineExpandIcon} alt="expand" width={16} height={16} style={{ paddingTop: 3 }}/>
              <span className={sectionHeaderStyles.generalLabel}>General</span>
            </div>
            <div className={sectionHeaderStyles.lineSeparator}></div>
            <div className={sectionHeaderStyles.sectionNameContainer}>
              <div className={sectionHeaderStyles.dragHandle} style={{ visibility: 'hidden' }}>
                <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
              </div>
              <Input
                placeholder="Enter section name"
                value={sectionName}
                onChange={(e) => {
                  setSectionName(e.target.value);
                  setErrors([]);
                }}
                className={sectionHeaderStyles.sectionNameInput}
              />
            </div>
          </div>
        </div>
      </div>

      <div className={styles.newSectionContainer}>
        <div>
          <Image src={predefineExpandIcon} alt="expand" width={16} height={16} style={{ paddingTop: 3 }}/>
          <span className={styles.sectionTitle}>Pre-define property</span>
        </div>
        <div className={sectionHeaderStyles.lineSeparator}></div>
        <div className={styles.headerRow}>
          <div className={styles.headerLabel}>Label text</div>
          <div className={styles.headerDataType}>Data type</div>
          <div className={styles.headerActions} />
        </div>
        <FieldsList
          fields={fields}
          onChangeField={(fieldId, data) => {
            handleChangeField(fieldId, data);
            // Clear validation error for this field when user edits it
            if (invalidFields.has(fieldId)) {
              setInvalidFields((prev) => {
                const newSet = new Set(prev);
                newSet.delete(fieldId);
                return newSet;
              });
            }
          }}
          onDeleteField={handleDeleteField}
          onReorderFields={handleReorderFields}
          disabled={saving}
          isFirstSection={isFirstSection}
          invalidFields={invalidFields}
        />
        <FieldForm
          onSubmit={handleAddField}
          onCancel={onCancel}
          disabled={saving}
          onFieldChange={(field) => {
            setPendingField(field);
            // Clear validation error for pending field when user edits it
            if (invalidPendingField) {
              setInvalidPendingField(undefined);
            }
          }}
          validationError={invalidPendingField}
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

