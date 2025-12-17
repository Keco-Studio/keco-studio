import { useState, useEffect } from 'react';
import { Input, Select, Button } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '../types';
import { FIELD_TYPE_OPTIONS } from '../utils';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineItemIcon from '@/app/assets/images/predefineItemIcon.svg';
import styles from './FieldForm.module.css';

interface FieldFormProps {
  initialField?: Omit<FieldConfig, 'id'>;
  onSubmit: (field: Omit<FieldConfig, 'id'>) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function FieldForm({ initialField, onSubmit, onCancel, disabled }: FieldFormProps) {
  const [field, setField] = useState<Omit<FieldConfig, 'id'>>(
    initialField || {
      label: '',
      dataType: 'string',
      required: false,
      enumOptions: [],
    }
  );

  useEffect(() => {
    if (initialField) {
      setField(initialField);
    } else {
      // Reset form when initialField becomes null/undefined
      setField({
        label: '',
        dataType: 'string',
        required: false,
        enumOptions: [],
      });
    }
  }, [initialField]);

  const handleSubmit = () => {
    const payload = {
      ...field,
      enumOptions:
        field.dataType === 'enum'
          ? (field.enumOptions || []).filter((v) => v.trim().length > 0)
          : undefined,
    };
    onSubmit(payload);
    if (!initialField) {
      // Reset form only if not editing
      setField({
        label: '',
        dataType: 'string',
        required: false,
        enumOptions: [],
      });
    }
  };

  const isEditing = !!initialField;

  return (
    <div className={`${styles.addFieldContainer} ${disabled ? styles.disabled : ''}`}>
      <div style={{ cursor: 'grab', display: 'flex', alignItems: 'center' }}>
        <Image src={predefineItemIcon} alt="Drag" width={16} height={16} />
      </div>
      <Input
        placeholder="Label"
        value={field.label}
        onChange={(e) => setField((p) => ({ ...p, label: e.target.value }))}
        style={{ flex: 1 }}
        onPressEnter={handleSubmit}
        disabled={disabled}
      />
      <Select
        value={field.dataType}
        onChange={(value) =>
          setField((p) => ({
            ...p,
            dataType: value as FieldType,
            enumOptions: value === 'enum' ? p.enumOptions ?? [] : undefined,
          }))
        }
        style={{ width: 120 }}
        options={FIELD_TYPE_OPTIONS}
        disabled={disabled}
      />
      {field.dataType === 'enum' && (
        <Input
          placeholder="Enum options (comma separated)"
          value={(field.enumOptions || []).join(',')}
          onChange={(e) =>
            setField((p) => ({
              ...p,
              enumOptions: e.target.value
                .split(',')
                .map((v) => v.trim())
                .filter((v) => v.length > 0),
            }))
          }
          style={{ width: 200 }}
          disabled={disabled}
        />
      )}
      <Button
        type="primary"
        icon={<Image src={predefineLabelAddIcon} alt="Add" width={24} height={24} />}
        onClick={handleSubmit}
        disabled={!field.label.trim() || disabled}
      >
        {isEditing ? 'Update Field' : 'Add Field'}
      </Button>
      {isEditing && onCancel && (
        <Button onClick={onCancel} style={{ marginLeft: 8 }} disabled={disabled}>
          Cancel
        </Button>
      )}
    </div>
  );
}

