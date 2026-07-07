import React from 'react';
import Image from 'next/image';
import { Input } from 'antd';
import type { PropertyGroup } from '../utils/tableStructure';
import addSectionIcon from '@/assets/images/addProjectIcon.svg';
import styles from '../LibraryAssetsTable.module.css';

type SectionTabsProps = {
  groups: PropertyGroup[];
  activeSectionId: string | null;
  editingSectionId: string | null;
  editingSectionName: string;
  sectionInputRef: React.RefObject<HTMLInputElement>;
  canAddSection: boolean;
  onSelectSection: (sectionId: string) => void;
  onStartEdit: (sectionId: string, currentName: string) => void;
  onChangeEditingName: (name: string) => void;
  onFinishEdit: (submit: boolean) => void;
  onAddSection: () => Promise<void>;
};

export function SectionTabs({
  groups,
  activeSectionId,
  editingSectionId,
  editingSectionName,
  sectionInputRef,
  canAddSection,
  onSelectSection,
  onStartEdit,
  onChangeEditingName,
  onFinishEdit,
  onAddSection,
}: SectionTabsProps) {
  return (
    <div className={styles.sectionTabs}>
      {groups.map((group) => (
        editingSectionId === group.section.id ? (
          <div key={group.section.id} className={styles.sectionTabEdit}>
            <Input
              ref={sectionInputRef}
              value={editingSectionName}
              onChange={(event) => onChangeEditingName(event.target.value)}
              onBlur={() => onFinishEdit(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onFinishEdit(true);
                if (event.key === 'Escape') onFinishEdit(false);
              }}
              className={styles.sectionTabInput}
              size="small"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        ) : (
          <button
            key={group.section.id}
            type="button"
            className={`${styles.sectionTab} ${activeSectionId === group.section.id ? styles.sectionTabActive : ''}`}
            onClick={() => onSelectSection(group.section.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              onStartEdit(group.section.id, group.section.name);
            }}
          >
            {group.section.name}
          </button>
        )
      ))}

      <button
        type="button"
        className={styles.addSectionButton}
        onClick={onAddSection}
        aria-label="Add section"
        disabled={!canAddSection}
      >
        <Image src={addSectionIcon} alt="Add section" width={16} height={16} />
      </button>
    </div>
  );
}
