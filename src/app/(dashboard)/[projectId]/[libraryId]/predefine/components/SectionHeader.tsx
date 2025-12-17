import Image from 'next/image';
import { Input } from 'antd';
import predefineItemIcon from '@/app/assets/images/predefineItemIcon.svg';
import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  sectionName?: string;
  isEditing?: boolean;
  onNameChange?: (name: string) => void;
}

export function SectionHeader({ sectionName, isEditing, onNameChange }: SectionHeaderProps) {
  return (
    <div className={styles.generalSection}>
      <div>
        <span className={styles.generalLabel}>General</span>
        <div className={styles.sectionNameContainer}>
          <div className={styles.dragHandle}>
            <Image src={predefineItemIcon} alt="Drag" width={16} height={16} />
          </div>
          {isEditing && onNameChange ? (
            <Input
              placeholder="Enter section name"
              value={sectionName}
              onChange={(e) => onNameChange(e.target.value)}
              className={styles.sectionNameInput}
            />
          ) : sectionName ? (
            <span className={styles.sectionNameDisplay}>{sectionName}</span>
          ) : (
            <span className={styles.noSectionSelected}>No section selected</span>
          )}
        </div>
      </div>
    </div>
  );
}

