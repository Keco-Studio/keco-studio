'use client';

import React from 'react';
import type { SectionConfig, PropertyConfig } from '@/lib/types/libraryAssets';
import styles from '../LibraryAssetsTable.module.css';

export type TableHeaderGroup = {
  section: SectionConfig;
  properties: PropertyConfig[];
};

export type TableHeaderProps = {
  groups: TableHeaderGroup[];
};

export function TableHeader({ groups }: TableHeaderProps) {
  return (
    <thead>
      <tr className={styles.headerRowTop}>
        <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`} />
        {groups.map((group) => (
          <th
            key={group.section.id}
            scope="col"
            colSpan={group.properties.length}
            className={`${styles.headerCell} ${styles.sectionHeaderCell}`}
          >
            {group.section.name}
          </th>
        ))}
      </tr>
      <tr className={styles.headerRowBottom}>
        <th scope="col" className={`${styles.headerCell} ${styles.numberColumnHeader}`}>
          #
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
          ))
        )}
      </tr>
    </thead>
  );
}
