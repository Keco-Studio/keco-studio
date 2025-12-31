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
    const parsed = fieldSchema.safeParse(fieldData);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    const field: FieldConfig = {
      id: uid(),
      label: parsed.data.label,
      dataType: parsed.data.dataType,
      required: parsed.data.required,
      ...(parsed.data.enumOptions && { enumOptions: parsed.data.enumOptions }),
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
        const parsed = fieldSchema.safeParse({
          ...fieldData,
          label: 'name',
          dataType: 'string',
        });
        if (!parsed.success) {
          setErrors(parsed.error.issues.map((i) => i.message));
          return;
        }
        setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, required: parsed.data.required } : f)));
        setErrors([]);
        return;
      }
    }

    const parsed = fieldSchema.safeParse(fieldData);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...parsed.data } : f)));
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
    if (pendingField && pendingField.label.trim()) {
      const parsed = fieldSchema.safeParse(pendingField);
      if (parsed.success) {
        const newField: FieldConfig = {
          id: uid(),
          label: parsed.data.label,
          dataType: parsed.data.dataType,
          required: parsed.data.required,
          ...(parsed.data.enumOptions && { enumOptions: parsed.data.enumOptions }),
        };
        finalFields = [...fields, newField];
      }
    }

    if (finalFields.length === 0) {
      setErrors(['At least one field is required']);
      return;
    }

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
          onChangeField={handleChangeField}
          onDeleteField={handleDeleteField}
          onReorderFields={handleReorderFields}
          disabled={saving}
          isFirstSection={isFirstSection}
        />
        <FieldForm
          onSubmit={handleAddField}
          onCancel={onCancel}
          disabled={saving}
          onFieldChange={setPendingField}
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

