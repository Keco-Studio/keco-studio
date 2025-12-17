import { Button } from 'antd';
import Image from 'next/image';
import type { FieldConfig } from '../types';
import { getFieldTypeIcon } from '../utils';
import predefineLabelCfigIcon from '@/app/assets/images/predefineLabelCfigIcon.svg';
import predefineLabelDelIcon from '@/app/assets/images/predefineLabelDelIcon.svg';
import predefineItemIcon from '@/app/assets/images/predefineItemIcon.svg';
import styles from './FieldItem.module.css';

interface FieldItemProps {
  field: FieldConfig;
  onEdit: (field: FieldConfig) => void;
  onDelete: (fieldId: string) => void;
}

export function FieldItem({ field, onEdit, onDelete }: FieldItemProps) {
  return (
    <div className={styles.fieldItem}>
      <div className={styles.dragHandle}>
        <Image src={predefineItemIcon} alt="Drag" width={16} height={16} />
      </div>
      <div className={styles.fieldInfo}>
        <Image
          src={getFieldTypeIcon(field.dataType)}
          alt={field.dataType}
          width={16}
          height={16}
        />
        <span className={styles.fieldLabel}>{field.label}</span>
        {field.required && <span className={styles.requiredMark}>*</span>}
      </div>
      <div className={styles.fieldActions}>
        <Button
          type="text"
          size="small"
          icon={<Image src={predefineLabelCfigIcon} alt="Config" width={20} height={20} />}
          onClick={() => onEdit(field)}
          style={{ padding: 0, minWidth: 'auto' }}
        />
        <Button
          type="text"
          size="small"
          icon={<Image src={predefineLabelDelIcon} alt="Delete" width={20} height={20} />}
          onClick={() => onDelete(field.id)}
          style={{ padding: 0, minWidth: 'auto' }}
        />
      </div>
    </div>
  );
}

