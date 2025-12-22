import { useState, useEffect, useRef } from 'react';
import { Input, Button } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '../types';
import { FIELD_TYPE_OPTIONS, getFieldTypeIcon } from '../utils';
import predefineLabelAddIcon from '@/app/assets/images/predefineLabelAddIcon.svg';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import styles from './FieldForm.module.css';

interface FieldFormProps {
  initialField?: Omit<FieldConfig, 'id'>;
  onSubmit: (field: Omit<FieldConfig, 'id'>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  onFieldChange?: (field: Omit<FieldConfig, 'id'> | null) => void;
}

export function FieldForm({ initialField, onSubmit, onCancel, disabled, onFieldChange }: FieldFormProps) {
  const [field, setField] = useState<Omit<FieldConfig, 'id'>>(
    initialField || {
      label: '',
      dataType: 'string',
      required: false,
      enumOptions: [],
    }
  );
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  // Whether data type has been selected via slash, used to control placeholder display
  const [dataTypeSelected, setDataTypeSelected] = useState(!!initialField);
  const inputRef = useRef<any>(null);
  const dataTypeInputRef = useRef<any>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Notify parent of field changes
  useEffect(() => {
    if (onFieldChange) {
      // Only pass field if it has content (label is not empty)
      if (field.label.trim()) {
        onFieldChange(field);
      } else {
        onFieldChange(null);
      }
    }
  }, [field, onFieldChange]);

  useEffect(() => {
    if (initialField) {
      setField(initialField);
      setDataTypeSelected(true);
    } else {
      // Reset form when initialField becomes null/undefined
      setField({
        label: '',
        dataType: 'string',
        required: false,
        enumOptions: [],
      });
      setDataTypeSelected(false);
    }
  }, [initialField]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        dataTypeInputRef.current &&
        !dataTypeInputRef.current.input?.contains(event.target as Node)
      ) {
        setShowSlashMenu(false);
      }
    };

    if (showSlashMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSlashMenu]);

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
      setDataTypeSelected(false); // Reset dataType selection state
    }
    setShowSlashMenu(false);
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setField((p) => ({ ...p, label: value }));
  };

  const handleSlashMenuSelect = (dataType: FieldType) => {
    setField((p) => ({
      ...p,
      dataType,
      enumOptions: dataType === 'enum' ? p.enumOptions ?? [] : undefined,
    }));
    setDataTypeSelected(true);
    setShowSlashMenu(false);
    // Focus back on data type input
    setTimeout(() => {
      if (dataTypeInputRef.current) {
        dataTypeInputRef.current.focus();
      }
    }, 0);
  };

  const handleDataTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === '/') {
      e.preventDefault();
      setShowSlashMenu(true);
    }
  };

  const getDataTypeLabel = (value: FieldType) => {
    const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === value);
    return option?.label ?? '';
  };

  const isEditing = !!initialField;

  return (
    <div className={`${styles.addFieldContainer} ${disabled ? styles.disabled : ''}`}>
      <button 
        className={styles.addButton} 
        onClick={handleSubmit}
        disabled={!field.label.trim() || disabled}
        title="Add property"
      >
        <Image src={predefineLabelAddIcon} alt="Add" width={20} height={20} />
      </button>
      <div className={styles.dragHandle}>
        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
      </div>
      <div className={styles.inputWrapper}>
        <Input
          ref={inputRef}
          placeholder="Type label for property..."
          value={field.label}
          onChange={handleLabelChange}
          className={styles.labelInput}
          onPressEnter={handleSubmit}
          disabled={disabled}
        />
      </div>
      <div className={styles.dataTypeDisplay}>
        <Input
          ref={dataTypeInputRef}
          placeholder="/ Slash Action..."
          value={dataTypeSelected ? getDataTypeLabel(field.dataType) : ''}
          readOnly
          onKeyDown={handleDataTypeKeyDown}
          className={styles.dataTypeInput}
          disabled={disabled}
          prefix={
            dataTypeSelected ? (
              <Image
                src={getFieldTypeIcon(field.dataType)}
                alt={field.dataType}
                width={16}
                height={16}
              />
            ) : undefined
          }
        />
        {showSlashMenu && (
          <div ref={slashMenuRef} className={styles.slashMenu}>
            <div className={styles.slashMenuHeader}>Data Type</div>
            {FIELD_TYPE_OPTIONS.map((option) => (
              <div
                key={option.value}
                className={styles.slashMenuItem}
                onClick={() => handleSlashMenuSelect(option.value as FieldType)}
              >
                <Image
                  src={getFieldTypeIcon(option.value as FieldType)}
                  alt={option.value}
                  width={16}
                  height={16}
                  style={{ marginRight: 8 }}
                />
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
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
          className={styles.enumInput}
          disabled={disabled}
        />
      )}
      <div className={styles.actions}>
        {isEditing && onCancel && (
          <Button onClick={onCancel} className={styles.cancelButton} disabled={disabled}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

