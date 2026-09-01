'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Checkbox, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import assetRefBookIcon from '@/assets/images/assetRefBookIcon.svg';
import {
  normalizeReferenceSelections,
  referenceSelectionsToValue,
  type ReferenceSelection,
} from '@/lib/utils/referenceValue';
import {
  assetHasAnyNonEmptyDisplayValue,
  cellDisplayString,
  getReferencePickerDisplayValue,
  hasNonEmptyDisplayValue,
} from '@/lib/utils/assetEmptiness';
import styles from './AssetReferenceModal.module.css';

type Library = {
  id: string;
  name: string;
};

type FieldDefinition = {
  id: string;
  library_id: string;
  label: string;
  order_index: number;
};

type AssetRow = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
};

interface AssetReferenceModalProps {
  open: boolean;
  value?: unknown;
  referenceLibraries?: string[];
  onClose: () => void;
  onApply: (selections: ReferenceSelection[] | null) => void;
}

export function AssetReferenceModal({
  open,
  value,
  referenceLibraries = [],
  onClose,
  onApply,
}: AssetReferenceModalProps) {
  const supabase = useSupabase();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryFields, setLibraryFields] = useState<FieldDefinition[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);
  const [valuesByAsset, setValuesByAsset] = useState<Record<string, Record<string, unknown>>>({});
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const selectedAssetIdsRef = useRef(selectedAssetIds);

  const updateSelectedAssetIds = (next: string[] | ((prev: string[]) => string[])) => {
    const valueNext = typeof next === 'function' ? next(selectedAssetIdsRef.current) : next;
    selectedAssetIdsRef.current = valueNext;
    setSelectedAssetIds(valueNext);
  };

  useEffect(() => {
    if (!open || referenceLibraries.length === 0) return;

    updateSelectedAssetIds([]);

    const loadLibraries = async () => {
      try {
        const { data, error } = await supabase
          .from('libraries')
          .select('id, name')
          .in('id', referenceLibraries);

        if (error) throw error;
        setLibraries(data || []);
        if (data && data.length > 0) {
          setSelectedLibraryId(data[0].id);
        }
      } catch (error) {
        console.error('[AssetReferenceModal] Failed to load libraries:', error);
      }
    };

    loadLibraries();
  }, [open, referenceLibraries, supabase]);

  useEffect(() => {
    if (!open || !selectedLibraryId) {
      setLibraryFields([]);
      setAssetRows([]);
      setValuesByAsset({});
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const { data: fieldDefs, error: fieldError } = await supabase
          .from('library_field_definitions')
          .select('id, library_id, label, order_index')
          .eq('library_id', selectedLibraryId)
          .order('order_index', { ascending: true });

        if (fieldError) throw fieldError;
        const fields = (fieldDefs || []) as FieldDefinition[];
        setLibraryFields(fields);

        const { data: assetsData, error: assetsError } = await supabase
          .from('library_assets')
          .select('id, name, library_id')
          .eq('library_id', selectedLibraryId);

        if (assetsError) throw assetsError;

        if (!assetsData || assetsData.length === 0) {
          setAssetRows([]);
          setValuesByAsset({});
          return;
        }

        const assetIds = assetsData.map((a) => a.id);
        const { data: valuesData, error: valuesError } = await supabase
          .from('library_asset_values')
          .select('asset_id, field_id, value_json')
          .in('asset_id', assetIds);

        if (valuesError) throw valuesError;

        const assetValuesMap = new Map<string, Map<string, unknown>>();
        (valuesData || []).forEach((v) => {
          if (!assetValuesMap.has(v.asset_id)) {
            assetValuesMap.set(v.asset_id, new Map());
          }
          assetValuesMap.get(v.asset_id)!.set(v.field_id, v.value_json);
        });

        const libName = libraries.find((lib) => lib.id === selectedLibraryId)?.name;

        const flatValues: Record<string, Record<string, unknown>> = {};
        assetValuesMap.forEach((m, assetId) => {
          flatValues[assetId] = Object.fromEntries(m.entries());
        });

        const rows = assetsData
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            library_id: asset.library_id,
            library_name: libName,
          }))
          .filter((asset) => assetHasAnyNonEmptyDisplayValue(flatValues[asset.id] ?? {}));

        setAssetRows(rows);
        setValuesByAsset(flatValues);
      } catch (error) {
        console.error('Failed to load reference modal data:', error);
        setLibraryFields([]);
        setAssetRows([]);
        setValuesByAsset({});
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, selectedLibraryId, supabase, libraries]);

  const primaryFieldId = libraryFields[0]?.id ?? null;

  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return assetRows;
    return assetRows.filter((row) => {
      const vals = valuesByAsset[row.id] || {};
      if (row.name.toLowerCase().includes(q)) return true;
      return Object.values(vals).some((v) => cellDisplayString(v).toLowerCase().includes(q));
    });
  }, [assetRows, valuesByAsset, searchText]);

  const allVisibleSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selectedAssetIds.includes(row.id));
  const someVisibleSelected =
    filteredRows.some((row) => selectedAssetIds.includes(row.id)) && !allVisibleSelected;

  useEffect(() => {
    if (!open) return;
    const normalizedSelections = normalizeReferenceSelections(value);
    const validSelections = normalizedSelections.filter((s) => s.assetId);
    const ids = [...new Set(validSelections.map((s) => s.assetId))];
    updateSelectedAssetIds(ids);
    setSearchText('');
  }, [open, value]);

  const handleRowToggle = (assetId: string) => {
    updateSelectedAssetIds((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]
    );
  };

  const handleToggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredRows.map((r) => r.id));
      updateSelectedAssetIds((prev) => prev.filter((id) => !visibleIds.has(id)));
      return;
    }
    updateSelectedAssetIds((prev) => {
      const next = new Set(prev);
      filteredRows.forEach((r) => next.add(r.id));
      return [...next];
    });
  };

  const handleApply = () => {
    const ids = selectedAssetIdsRef.current;
    if (!primaryFieldId || ids.length === 0) {
      onApply(null);
      onClose();
      return;
    }

    const fieldDef = libraryFields.find((f) => f.id === primaryFieldId);
    const fieldLabel = fieldDef?.label || 'Column';
    const allSelections: ReferenceSelection[] = [];

    ids.forEach((assetId) => {
      const vals = valuesByAsset[assetId] || {};
      let displayValue = getReferencePickerDisplayValue(vals, primaryFieldId);
      let fieldId = primaryFieldId;
      let label = fieldLabel;

      // Match table UI: if the primary field is empty, fall back to the first
      // non-empty field, then the asset name.
      if (!hasNonEmptyDisplayValue(displayValue)) {
        for (const field of libraryFields) {
          const candidate = getReferencePickerDisplayValue(vals, field.id);
          if (hasNonEmptyDisplayValue(candidate)) {
            displayValue = candidate;
            fieldId = field.id;
            label = field.label || 'Column';
            break;
          }
        }
      }
      if (!hasNonEmptyDisplayValue(displayValue)) {
        const assetName = assetRows.find((row) => row.id === assetId)?.name?.trim();
        if (!assetName) return;
        displayValue = assetName;
      }

      allSelections.push({
        assetId,
        fieldId,
        fieldLabel: label,
        displayValue,
      });
    });

    onApply(referenceSelectionsToValue(allSelections));
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop} data-testid="apply-reference-modal">
      <div className={styles.modalContainer}>
        <div ref={modalRef} className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.title}>Apply Reference</div>
          </div>

          <div className={styles.content}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />

            <Select
              value={selectedLibraryId}
              onChange={setSelectedLibraryId}
              className={styles.librarySelect}
              placeholder={libraries.length === 0 ? 'No libraries' : 'Select library'}
              disabled={libraries.length === 0}
              getPopupContainer={() => modalRef.current || document.body}
              popupMatchSelectWidth
              optionLabelProp="label"
            >
              {libraries.map((lib) => (
                <Select.Option key={lib.id} value={lib.id} label={lib.name}>
                  <div className={styles.selectOptionRow}>
                    <Image src={assetRefBookIcon} alt="" width={16} height={16} className="icon-16" />
                    <span className={styles.selectOptionText}>{lib.name}</span>
                  </div>
                </Select.Option>
              ))}
            </Select>

            <div className={styles.tableWrap}>
              {loading ? (
                <div className={styles.loading}>
                  <Spin />
                </div>
              ) : filteredRows.length === 0 ? (
                <div className={styles.emptyMessage}>No assets found</div>
              ) : (
                <table className={styles.refTable}>
                  <thead>
                    <tr>
                      <th className={styles.checkCol}>
                        <Checkbox
                          checked={allVisibleSelected}
                          indeterminate={someVisibleSelected}
                          onChange={handleToggleAllVisible}
                        />
                      </th>
                      {libraryFields.map((field) => (
                        <th key={field.id} className={styles.fieldCol}>
                          <span className={styles.fieldHeaderLabel}>{field.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const selected = selectedAssetIds.includes(row.id);
                      const vals = valuesByAsset[row.id] || {};
                      return (
                        <tr
                          key={row.id}
                          className={selected ? styles.rowSelected : undefined}
                          onClick={() => handleRowToggle(row.id)}
                        >
                          <td className={styles.checkCol} onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected}
                              onChange={() => handleRowToggle(row.id)}
                            />
                          </td>
                          {libraryFields.map((field, fieldIndex) => {
                            const text = cellDisplayString(vals[field.id]);
                            const isPrimary = fieldIndex === 0;
                            return (
                              <td key={field.id} className={styles.fieldCol}>
                                {isPrimary ? (
                                  <span className={styles.nameCell}>
                                    <span className={styles.refBadge} aria-hidden>
                                      R
                                    </span>
                                    <span className={styles.nameText} title={text || row.name}>
                                      {text || row.name || '—'}
                                    </span>
                                  </span>
                                ) : (
                                  <span className={styles.cellText} title={text}>
                                    {text || '—'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.applyButton} onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
