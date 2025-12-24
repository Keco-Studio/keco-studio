import React, { useState } from 'react';
import { Input, Select, Button } from 'antd';
import {
  AssetRow,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import styles from './LibraryAssetsTable.module.css';

export type LibraryAssetsTableProps = {
  library: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  sections: SectionConfig[];
  properties: PropertyConfig[];
  rows: AssetRow[];
  onSaveAsset?: (assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onUpdateAsset?: (assetId: string, assetName: string, propertyValues: Record<string, any>) => Promise<void>;
  onDeleteAsset?: (assetId: string) => Promise<void>;
};

export function LibraryAssetsTable({
  library,
  sections,
  properties,
  rows,
  onSaveAsset,
  onUpdateAsset,
  onDeleteAsset,
}: LibraryAssetsTableProps) {
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowData, setNewRowData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  const hasSections = sections.length > 0;
  const hasProperties = properties.length > 0;
  const hasRows = rows.length > 0;

  // Handle save new asset
  const handleSaveNewAsset = async () => {
    if (!onSaveAsset) return;

    // Get asset name from first property (assuming first property is name)
    const assetName = newRowData[properties[0]?.id] || 'Untitled';

    setIsSaving(true);
    try {
      await onSaveAsset(assetName, newRowData);
      // Reset state
      setIsAddingRow(false);
      setNewRowData({});
    } catch (error) {
      console.error('Failed to save asset:', error);
      alert('Failed to save asset. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel adding
  const handleCancelAdding = () => {
    setIsAddingRow(false);
    setNewRowData({});
  };

  // Handle input change
  const handleInputChange = (propertyId: string, value: any) => {
    setNewRowData((prev) => ({ ...prev, [propertyId]: value }));
  };

  if (!hasProperties) {
    return (
      <div className={styles.tableContainer}>
        <div className={styles.emptyState}>
          No properties configured yet. Please configure fields in Predefine first.
        </div>
      </div>
    );
  }

  const grouped = (() => {
    const byId = new Map<string, SectionConfig>();
    sections.forEach((s) => byId.set(s.id, s));

    const groupMap = new Map<
      string,
      {
        section: SectionConfig;
        properties: PropertyConfig[];
      }
    >();

    for (const prop of properties) {
      const section = byId.get(prop.sectionId);
      if (!section) continue;

      let group = groupMap.get(section.id);
      if (!group) {
        group = { section, properties: [] };
        groupMap.set(section.id, group);
      }
      group.properties.push(prop);
    }

    const groups = Array.from(groupMap.values()).sort(
      (a, b) => a.section.orderIndex - b.section.orderIndex
    );

    groups.forEach((g) => {
      g.properties.sort((a, b) => a.orderIndex - b.orderIndex);
    });

    const orderedProperties = groups.flatMap((g) => g.properties);

    return { groups, orderedProperties };
  })();

  const { groups, orderedProperties } = grouped;

  // Calculate total columns: # + properties + actions
  const totalColumns = 1 + orderedProperties.length + 1;

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRowTop}>
            <th
              rowSpan={2}
              scope="col"
              className={`${styles.headerCell} ${styles.numberColumnHeader}`}
            >
              #
            </th>
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
            <th
              rowSpan={2}
              scope="col"
              className={`${styles.headerCell} ${styles.actionsColumnHeader}`}
            >
              Actions
            </th>
          </tr>
          <tr className={styles.headerRowBottom}>
            {groups.map((group) =>
              group.properties.map((property) => (
                <th
                  key={property.id}
                  scope="col"
                  className={styles.headerCell}
                >
                  {property.name}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody className={styles.body}>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              className={styles.row}
            >
              <td className={styles.numberCell}>{index + 1}</td>
              {orderedProperties.map((property) => {
                const value = row.propertyValues[property.key];
                const display =
                  value === null || value === undefined || value === ''
                    ? null
                    : String(value);

                return (
                  <td
                    key={property.id}
                    className={styles.cell}
                  >
                    {display ? (
                      display
                    ) : (
                      <span className={styles.placeholderValue}>—</span>
                    )}
                  </td>
                );
              })}
              <td className={styles.actionsCell}>
                <button
                  className={styles.actionButton}
                  onClick={() => onDeleteAsset && onDeleteAsset(row.id)}
                  title="Delete asset"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          
          {/* Add new asset row */}
          {isAddingRow ? (
            <tr className={styles.editRow}>
              <td className={styles.numberCell}>{rows.length + 1}</td>
              {orderedProperties.map((property) => (
                <td key={property.id} className={styles.editCell}>
                  <Input
                    value={newRowData[property.id] || ''}
                    onChange={(e) => handleInputChange(property.id, e.target.value)}
                    placeholder={`Enter ${property.name.toLowerCase()}`}
                    className={styles.editInput}
                  />
                </td>
              ))}
              <td className={styles.actionsCell}>
                <div className={styles.editActions}>
                  <Button
                    type="primary"
                    size="small"
                    onClick={handleSaveNewAsset}
                    loading={isSaving}
                    disabled={isSaving}
                  >
                    Save
                  </Button>
                  <Button
                    size="small"
                    onClick={handleCancelAdding}
                    disabled={isSaving}
                  >
                    Cancel
                  </Button>
                </div>
              </td>
            </tr>
          ) : (
            <tr className={styles.addRow}>
              <td colSpan={totalColumns}>
                <button
                  className={styles.addButton}
                  onClick={() => setIsAddingRow(true)}
                >
                  + Add New Asset
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default LibraryAssetsTable;


