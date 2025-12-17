import { useState } from 'react';
import { Button, Input } from 'antd';
import Image from 'next/image';
import type { FieldConfig } from '../types';
import { fieldSchema } from '../validation';
import { uid } from '../types';
import { SectionHeader } from './SectionHeader';
import { FieldsList } from './FieldsList';
import { FieldForm } from './FieldForm';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import styles from './NewSectionForm.module.css';

interface NewSectionFormProps {
  onCancel: () => void;
  onSave: (section: { name: string; fields: FieldConfig[] }) => Promise<void>;
  saving?: boolean;
}

export function NewSectionForm({ onCancel, onSave, saving }: NewSectionFormProps) {
  const [sectionName, setSectionName] = useState('');
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [draftField, setDraftField] = useState<Omit<FieldConfig, 'id'> | null>(null);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const handleAddField = (fieldData: Omit<FieldConfig, 'id'>) => {
    const parsed = fieldSchema.safeParse(fieldData);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    if (editingFieldId) {
      setFields((prev) =>
        prev.map((f) => (f.id === editingFieldId ? { ...f, ...parsed.data } : f))
      );
      setEditingFieldId(null);
    } else {
      const field: FieldConfig = {
        id: uid(),
        ...parsed.data,
      };
      setFields((prev) => [...prev, field]);
    }
    setDraftField(null);
    setErrors([]);
  };

  const handleEditField = (field: FieldConfig) => {
    setEditingFieldId(field.id);
    setDraftField({
      label: field.label,
      dataType: field.dataType,
      required: field.required,
      enumOptions: field.enumOptions,
    });
  };

  const handleDeleteField = (fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  };

  const handleCancelEdit = () => {
    setDraftField(null);
    setEditingFieldId(null);
  };

  const handleSave = async () => {
    const trimmedName = sectionName.trim();
    if (!trimmedName) {
      setErrors(['Section name is required']);
      return;
    }

    if (fields.length === 0) {
      setErrors(['At least one field is required']);
      return;
    }

    setErrors([]);
    await onSave({ name: trimmedName, fields });
  };

  return (
    <div>
      <div className={styles.newSectionContainer}>
        <SectionHeader
          sectionName={sectionName}
          isEditing
          onNameChange={(name) => {
            setSectionName(name);
            setErrors([]);
          }}
        />
      </div>

      <div className={styles.newSectionContainer}>
        <h3 className={styles.sectionTitle}>Pre-define property</h3>
        <FieldsList
          fields={fields}
          onEditField={handleEditField}
          onDeleteField={handleDeleteField}
        />
        {draftField || editingFieldId ? (
          <FieldForm
            initialField={draftField || undefined}
            onSubmit={handleAddField}
            onCancel={handleCancelEdit}
            disabled={saving}
          />
        ) : (
          <div className={styles.addFieldTrigger}>
            <Button
              type="dashed"
              icon={<Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />}
              onClick={() => setDraftField({ label: '', dataType: 'string', required: false, enumOptions: [] })}
              disabled={saving}
            >
              Add Field
            </Button>
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <div className={styles.errorsContainer}>
          {errors.map((err, idx) => (
            <div key={idx}>{err}</div>
          ))}
        </div>
      )}

      <div className={styles.newSectionActions}>
        <Button onClick={onCancel} disabled={saving}>
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
      </div>
    </div>
  );
}

