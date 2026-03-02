'use client';

import React from 'react';
import Image from 'next/image';
import { Checkbox } from 'antd';
import type { SectionConfig, PropertyConfig } from '@/lib/types/libraryAssets';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';
import showIcon from '@/assets/images/showIcon.svg';

export type TableHeaderGroup = {
  section: SectionConfig;
  properties: PropertyConfig[];
};

export type TableHeaderProps = {
  groups: TableHeaderGroup[];
  allRowsSelected: boolean;
  hasSomeRowsSelected: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  /** When true (e.g. section tabs mode), hide the section name row and only show property names */
  showSectionRow?: boolean;
};

export function TableHeader({
  groups,
  allRowsSelected,
  hasSomeRowsSelected,
  onToggleSelectAll,
  showSectionRow = true,
}: TableHeaderProps) {
  return (
    <thead>
      {showSectionRow && (
        <tr className={styles.headerRowTop}>
          <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
            <div className={styles.checkboxContainer}>
              <Checkbox
                checked={allRowsSelected}
                indeterminate={hasSomeRowsSelected && !allRowsSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </div>
          </th>
          {groups.map((group, index) => (
            <th
              key={group.section.id}
              scope="col"
              colSpan={group.properties.length}
              className={`${styles.headerCell} ${styles.sectionHeaderCell} ${
                index < groups.length - 1 ? styles.sectionHeaderCellDivider : ''
              }`}
            >
              {group.section.name}
            </th>
          ))}
        </tr>
      )}
      <tr className={styles.headerRowBottom}>
        <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
          {showSectionRow ? (
            '#'
          ) : (
            <div className={styles.checkboxContainer}>
              <Checkbox
                checked={allRowsSelected}
                indeterminate={hasSomeRowsSelected && !allRowsSelected}
                onChange={(e) => onToggleSelectAll(e.target.checked)}
              />
            </div>
          )}
        </th>
        {groups.map((group) =>
          group.properties.map((property) => (
            <th
              key={property.id}
              scope="col"
              className={`${styles.headerCell} ${styles.propertyHeaderCell}`}
            >
              <div className={styles.propertyHeaderContent}>
                <span className={styles.propertyHeaderText}>{property.name}</span>
                <div style={{ width: 16, height: 16, backgroundColor: 'rgba(11, 153, 255, 0.08)', borderRadius: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Image
                    src={showIcon}
                    alt=""
                    width={8}
                    height={4}
                    className={styles.propertyHeaderIcon}
                  />
                </div>
              
              </div>
            </th>
          )),
        )}
      </tr>
    </thead>
  );
}

