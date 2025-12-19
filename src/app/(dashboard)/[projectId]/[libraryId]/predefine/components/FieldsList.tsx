import type { FieldConfig } from '../types';
import { FieldItem } from './FieldItem';
import styles from './FieldsList.module.css';

interface FieldsListProps {
  fields: FieldConfig[];
  /** 行内编辑时直接更新字段 */
  onChangeField: (fieldId: string, data: Omit<FieldConfig, 'id'>) => void;
  onDeleteField: (fieldId: string) => void;
  disabled?: boolean;
  isFirstSection?: boolean;
}

export function FieldsList({ fields, onChangeField, onDeleteField, disabled, isFirstSection = false }: FieldsListProps) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <div className={styles.fieldsList}>
      {fields.map((field, index) => {
        // 如果是第一个section的第一个字段，且label是'name'，type是'string'，则是mandatory字段
        const isMandatoryNameField = isFirstSection && index === 0 && field.label === 'name' && field.dataType === 'string';
        
        return (
          <FieldItem
            key={field.id}
            field={field}
            onChangeField={onChangeField}
            onDelete={onDeleteField}
            isFirst={index === 0}
            disabled={disabled}
            isMandatoryNameField={isMandatoryNameField}
          />
        );
      })}
    </div>
  );
}
