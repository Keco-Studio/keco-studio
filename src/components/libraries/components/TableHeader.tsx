'use client';

import React from 'react';
import { Checkbox } from 'antd';
import type { SectionConfig, PropertyConfig } from '@/lib/types/libraryAssets';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

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
              {property.name}
            </th>
          )),
        )}
      </tr>
    </thead>
  );
}

