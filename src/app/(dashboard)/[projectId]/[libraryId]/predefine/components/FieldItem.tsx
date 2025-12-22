import { useRef, useState, useEffect } from 'react';
import { Button, Input } from 'antd';
import Image from 'next/image';
import type { FieldConfig, FieldType } from '../types';
import { FIELD_TYPE_OPTIONS, getFieldTypeIcon } from '../utils';
import predefineLabelDelIcon from '@/app/assets/images/predefineLabelDelIcon.svg';
import predefineLabelConfigIcon from '@/app/assets/images/predefineLabelConfigIcon.svg';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineTypeSwitchIcon from '@/app/assets/images/predefineTypeSwitchIcon.svg';
import styles from './FieldItem.module.css';

interface FieldItemProps {
  field: FieldConfig;
  /** Sync changes to parent when editing field inline */
  onChangeField: (fieldId: string, data: Omit<FieldConfig, 'id'>) => void;
  onDelete: (fieldId: string) => void;
  isFirst?: boolean;
  disabled?: boolean;
  isMandatoryNameField?: boolean;
}

export function FieldItem({
  field,
  onChangeField,
  onDelete,
  isFirst = false,
  disabled,
  isMandatoryNameField = false,
}: FieldItemProps) {
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const dataTypeInputRef = useRef<any>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  const getDataTypeLabel = (value: FieldType) => {
    const option = FIELD_TYPE_OPTIONS.find((opt) => opt.value === value);
    return option?.label ?? '';
  };

  const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // If this is the mandatory name field, don't allow modifying label
    if (isMandatoryNameField) {
      return;
    }
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      label: e.target.value,
    });
  };

  const handleSlashMenuSelect = (dataType: FieldType) => {
    // If this is the mandatory name field, don't allow modifying type
    if (isMandatoryNameField) {
      setShowSlashMenu(false);
      return;
    }
    const { id, ...rest } = field;
    onChangeField(field.id, {
      ...rest,
      dataType,
      enumOptions: dataType === 'enum' ? rest.enumOptions ?? [] : undefined,
    });
    setShowSlashMenu(false);
    setTimeout(() => {
      if (dataTypeInputRef.current) {
        dataTypeInputRef.current.focus();
      }
    }, 0);
  };

  const handleDataTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // If this is the mandatory name field, don't allow opening slash menu
    if (isMandatoryNameField) {
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      setShowSlashMenu(true);
    }
  };

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

  return (
    <div className={`${styles.fieldItem} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.dragHandle}>
        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
      </div>
      <div className={styles.fieldInfo}>
        <div className={styles.inputWrapper}>
          <Input
            value={field.label}
            className={styles.labelInput}
            onChange={handleLabelChange}
            disabled={disabled || isMandatoryNameField}
          />
        </div>
        <div className={styles.dataTypeDisplay}>
          <Input
            ref={dataTypeInputRef}
            placeholder="/ Slash Action..."
            value={getDataTypeLabel(field.dataType as FieldType)}
            readOnly
            onKeyDown={handleDataTypeKeyDown}
            className={styles.dataTypeInput}
            disabled={disabled || isMandatoryNameField}
            prefix={
              <Image
                src={getFieldTypeIcon(field.dataType)}
                alt={field.dataType}
                width={16}
                height={16}
              />
            }
            suffix={
              !isMandatoryNameField && (
                <button
                  type="button"
                  className={styles.typeSwitchButton}
                  onClick={() => !disabled && setShowSlashMenu(true)}
                  disabled={disabled}
                  title="Choose type"
                >
                  <Image
                    src={predefineTypeSwitchIcon}
                    alt="Switch type"
                    width={16}
                    height={16}
                  />
                </button>
              )
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
        {field.required && <span className={styles.requiredMark}>*</span>}
      </div>
      <div className={styles.fieldActions}>
        {/* Only show configure icon for Reference and Option (enum) data types */}
        {(field.dataType === 'reference' || field.dataType === 'enum') && (
          <button className={styles.configButton}>
            <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
          </button>
        )}
        {!isFirst && !isMandatoryNameField && (
          <Button
            type="text"
            size="small"
            icon={<Image src={predefineLabelDelIcon} alt="Delete" width={20} height={20} />}
            onClick={() => onDelete(field.id)}
            className={styles.deleteButton}
            title="Delete property"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
