import type { FieldConfig } from '../types';
import { FieldItem } from './FieldItem';
import styles from './FieldsList.module.css';

interface FieldsListProps {
  fields: FieldConfig[];
  onEditField: (field: FieldConfig) => void;
  onDeleteField: (fieldId: string) => void;
}

export function FieldsList({ fields, onEditField, onDeleteField }: FieldsListProps) {
  if (fields.length === 0) {
    return (
      <div className={styles.emptyFields}>
        No fields yet. Add a field to get started.
      </div>
    );
  }

  return (
    <div className={styles.fieldsList}>
      {fields.map((field) => (
        <FieldItem
          key={field.id}
          field={field}
          onEdit={onEditField}
          onDelete={onDeleteField}
        />
      ))}
    </div>
  );
}

