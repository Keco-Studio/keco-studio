'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Avatar, Spin } from 'antd';
import { SearchOutlined, UnorderedListOutlined, AppstoreOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import applyReference4Icon from '@/assets/images/ApplyReference4.svg';
import assetRefBookIcon from '@/assets/images/assetRefBookIcon.svg';
import assetRefMenuGridIcon from '@/assets/images/assetRefMenuGridIcon.svg';
import {
  normalizeReferenceSelections,
  referenceSelectionsToValue,
  type ReferenceSelection,
} from '@/lib/utils/referenceValue';
import styles from './AssetReferenceModal.module.css';

type Asset = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
  /** Value of the currently selected column (for avatar + search) */
  displayValue: string;
};

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

interface AssetReferenceModalProps {
  open: boolean;
  value?: unknown;
  referenceLibraries?: string[];
  onClose: () => void;
  onApply: (selections: ReferenceSelection[] | null) => void;
}

function cellDisplayString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (s === '' || s === 'null' || s === 'undefined') return '';
  return s;
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
  const [selectedColumnFieldId, setSelectedColumnFieldId] = useState<string | null>(null);
  const [assetRows, setAssetRows] = useState<
    { id: string; name: string; library_id: string; library_name?: string }[]
  >([]);
  const [valuesByAsset, setValuesByAsset] = useState<Record<string, Record<string, unknown>>>({});
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [tempSelectedAssets, setTempSelectedAssets] = useState<Array<{ id: string; libraryId: string; fieldId: string; fieldLabel: string; displayValue: string }>>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || referenceLibraries.length === 0) return;

    const loadLibraries = async () => {
      try {
        // First, get the library IDs for the currently selected assets
        const normalizedSelections = normalizeReferenceSelections(value);
        const selectedAssetIds = normalizedSelections.map((s) => s.assetId);

        let libraryIdToSelect: string | null = null;

        // If there are selected assets, find which library they belong to
        if (selectedAssetIds.length > 0) {
          const { data: assetLibData, error: assetLibError } = await supabase
            .from('library_assets')
            .select('id, library_id')
            .in('id', selectedAssetIds);

          if (!assetLibError && assetLibData && assetLibData.length > 0) {
            // Find the first library that contains a selected asset and is in referenceLibraries
            const assetLibraryMap = new Map(assetLibData.map((a) => [a.id, a.library_id]));
            for (const assetId of selectedAssetIds) {
              const libId = assetLibraryMap.get(assetId);
              if (libId && referenceLibraries.includes(libId)) {
                libraryIdToSelect = libId;
                break;
              }
            }
          }
        }

        const { data, error } = await supabase
          .from('libraries')
          .select('id, name')
          .in('id', referenceLibraries);

        if (error) throw error;
        setLibraries(data || []);

        // Use the library containing selected assets if found, otherwise use first library
        if (data && data.length > 0) {
          if (libraryIdToSelect && data.some((lib) => lib.id === libraryIdToSelect)) {
            setSelectedLibraryId(libraryIdToSelect);
          } else {
            setSelectedLibraryId(data[0].id);
          }
        }
      } catch (error) {
        console.error('[AssetReferenceModal] Failed to load libraries:', error);
      }
    };

    loadLibraries();
  }, [open, referenceLibraries, supabase, value]);

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

        const rows = assetsData
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            library_id: asset.library_id,
            library_name: libName,
          }))
          .filter((asset) => {
            const assetValues = assetValuesMap.get(asset.id);
            if (!assetValues || assetValues.size === 0) return false;
            for (const [, val] of assetValues.entries()) {
              const str = cellDisplayString(val);
              if (str !== '') return true;
            }
            return false;
          });

        const flatValues: Record<string, Record<string, unknown>> = {};
        assetValuesMap.forEach((m, assetId) => {
          flatValues[assetId] = Object.fromEntries(m.entries());
        });

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

  useEffect(() => {
    if (!libraryFields.length) {
      setSelectedColumnFieldId(null);
      return;
    }
    setSelectedColumnFieldId((prev) => {
      if (prev && libraryFields.some((f) => f.id === prev)) return prev;
      return libraryFields[0].id;
    });
  }, [libraryFields]);

  const assetsWithDisplay: Asset[] = useMemo(() => {
    if (!selectedColumnFieldId) return [];
    return assetRows
      .map((row) => {
        const vals = valuesByAsset[row.id] || {};
        const displayValue = cellDisplayString(vals[selectedColumnFieldId]);
        return {
          ...row,
          displayValue: displayValue || 'Untitled',
        };
      })
      .sort((a, b) =>
        (a.displayValue || 'Untitled').localeCompare(b.displayValue || 'Untitled')
      );
  }, [assetRows, valuesByAsset, selectedColumnFieldId]);

  const filteredAssets = useMemo(() => {
    const q = searchText.trim().toLowerCase();

    // Merge: current library's assets + already-selected assets from other libraries
    // Deduplicate by id: prefer assetsWithDisplay version (has complete data)
    const otherLibrarySelectedAssets = tempSelectedAssets
      .filter((a) => a.libraryId !== '' && a.libraryId !== selectedLibraryId)
      .map((a) => ({
        id: a.id,
        name: a.displayValue || 'Untitled',
        library_id: a.libraryId,
        library_name: libraries.find((l) => l.id === a.libraryId)?.name || '',
        displayValue: a.displayValue || 'Untitled',
      }));

    // Build a deduped map: id -> asset (assetsWithDisplay takes priority)
    const assetMap = new Map<string, Asset>();
    for (const asset of assetsWithDisplay) {
      assetMap.set(asset.id, asset);
    }
    for (const asset of otherLibrarySelectedAssets) {
      if (!assetMap.has(asset.id)) {
        assetMap.set(asset.id, asset);
      }
    }
    const allAssets = Array.from(assetMap.values());

    if (!q) return allAssets;
    return allAssets.filter((asset) =>
      (asset.displayValue || 'Untitled').toLowerCase().includes(q)
    );
  }, [searchText, assetsWithDisplay, tempSelectedAssets, selectedLibraryId, libraries]);

  const selectedColumnLabel = useMemo(() => {
    const f = libraryFields.find((x) => x.id === selectedColumnFieldId);
    return f?.label || 'Column';
  }, [libraryFields, selectedColumnFieldId]);

  // Track if we've restored selections at least once in current modal session
  // to avoid overwriting user changes if supabase instance changes mid-session
  const hasRestoredRef = useRef(false);

  useEffect(() => {
    if (!open) {
      // Reset restoration flag when modal closes
      hasRestoredRef.current = false;
      return;
    }

    // Only restore on first open (hasRestoredRef is false) or when explicitly opening
    // This prevents overwriting user changes if supabase changes during an open modal
    if (hasRestoredRef.current) {
      return;
    }

    const normalizedSelections = normalizeReferenceSelections(value);

    // Build fromExisting using composite key (assetId::fieldId) to preserve
    // selections of the same asset in different columns
    const fromExisting = new Map<string, { fieldId: string; fieldLabel: string; displayValue: string }>();
    for (const sel of normalizedSelections) {
      const key = `${sel.assetId}::${sel.fieldId || ''}`;
      if (!fromExisting.has(key)) {
        fromExisting.set(key, {
          fieldId: sel.fieldId || '',
          fieldLabel: sel.fieldLabel || '',
          displayValue: sel.displayValue || '',
        });
      }
    }

    // Get unique entries preserving all assetId::fieldId combinations
    const uniqueEntries = Array.from(fromExisting.entries());
    const uniqueAssetIds = [...new Set(uniqueEntries.map(([key]) => key.split('::')[0]))];

    // Query library_id for each selected asset, then set tempSelectedAssets
    const restoreSelections = async () => {
      if (uniqueAssetIds.length === 0) {
        setTempSelectedAssets([]);
        hasRestoredRef.current = true;
        return;
      }
      const { data, error } = await supabase
        .from('library_assets')
        .select('id, library_id')
        .in('id', uniqueAssetIds);

      if (error || !data) {
        // Fallback: set with empty libraryId
        setTempSelectedAssets(
          uniqueEntries.map(([key, val]) => ({
            id: key.split('::')[0],
            libraryId: '',
            fieldId: val.fieldId,
            fieldLabel: val.fieldLabel,
            displayValue: val.displayValue,
          }))
        );
        hasRestoredRef.current = true;
        return;
      }
      const libraryMap = new Map(data.map((a) => [a.id, a.library_id]));
      setTempSelectedAssets(
        uniqueEntries.map(([key, val]) => ({
          id: key.split('::')[0],
          libraryId: libraryMap.get(key.split('::')[0]) || '',
          fieldId: val.fieldId,
          fieldLabel: val.fieldLabel,
          displayValue: val.displayValue,
        }))
      );
      hasRestoredRef.current = true;
    };

    restoreSelections();
    setSearchText('');
    setViewMode('grid');
  }, [open, value, supabase]);

  const handleAssetToggle = (asset: Asset) => {
    // Note: we only check by id, NOT by fieldId. Once selected, the asset's fieldId
    // stays as-is. Changing column dropdown should NOT affect existing selections.
    setTempSelectedAssets((prev) => {
      const existingIndex = prev.findIndex((a) => a.id === asset.id);
      if (existingIndex !== -1) {
        // Already selected: remove it (toggle off)
        return prev.filter((a) => a.id !== asset.id);
      }
      // Not selected: add it (column info will be from the current dropdown)
      return [...prev, {
        id: asset.id,
        libraryId: asset.library_id,
        fieldId: selectedColumnFieldId || '',
        fieldLabel: selectedColumnLabel || '',
        displayValue: asset.displayValue || 'Untitled',
      }];
    });
  };

  const handleLibraryChange = (newLibraryId: string) => {
    setSelectedLibraryId(newLibraryId);
    // Note: do NOT filter tempSelectedAssets by library here.
    // Users can select assets from multiple libraries and all should be kept until Apply.
    // selectedColumnFieldId will be auto-reset to the new library's first field by the useEffect below.
  };

  const handleApply = () => {
    // Use stored fieldId, fieldLabel and displayValue directly for all selected assets
    const selections: ReferenceSelection[] = tempSelectedAssets
      .filter((a) => a.fieldId)
      .map((asset) => ({
        assetId: asset.id,
        fieldId: asset.fieldId,
        fieldLabel: asset.fieldLabel,
        displayValue: asset.displayValue,
      }));
    onApply(referenceSelectionsToValue(selections));
    onClose();
  };

  const handleCancel = () => {
    const normalizedSelections = normalizeReferenceSelections(value);
    // Build fromExisting using composite key (assetId::fieldId) to preserve
    // selections of the same asset in different columns
    // Note: We don't know libraryId here, will be resolved on modal open
    const fromExisting = new Map<string, { fieldId: string; fieldLabel: string; displayValue: string }>();
    for (const sel of normalizedSelections) {
      const key = `${sel.assetId}::${sel.fieldId || ''}`;
      if (!fromExisting.has(key)) {
        fromExisting.set(key, {
          fieldId: sel.fieldId || '',
          fieldLabel: sel.fieldLabel || '',
          displayValue: sel.displayValue || '',
        });
      }
    }
    const uniqueEntries = Array.from(fromExisting.entries());
    setTempSelectedAssets(
      uniqueEntries.map(([key, val]) => ({
        id: key.split('::')[0],
        libraryId: '',
        fieldId: val.fieldId,
        fieldLabel: val.fieldLabel,
        displayValue: val.displayValue,
      }))
    );
    onClose();
  };

  const getAvatarText = (name: string) => {
    if (!name || name.trim() === '') return 'U';
    return name.charAt(0).toUpperCase();
  };

  const assetColorPalette = [
    '#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#87d068', '#f50', '#2db7f5', '#108ee9',
    '#FF6CAA', '#52c41a', '#fa8c16', '#eb2f96', '#13c2c2', '#722ed1', '#faad14', '#a0d911',
    '#1890ff', '#f5222d', '#fa541c', '#2f54eb', '#096dd9', '#531dab', '#c41d7f', '#cf1322',
    '#d4380d', '#7cb305', '#389e0d', '#0958d9', '#1d39c4', '#10239e', '#061178', '#780650',
  ];

  const getAvatarColor = (assetId: string, name: string) => {
    const hash =
      assetId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) +
      name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return assetColorPalette[hash % assetColorPalette.length];
  };

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop}>
      <div className={styles.modalContainer}>
        <div ref={modalRef} className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.title}>APPLY REFERENCE</div>
            <button className={styles.closeButton} onClick={handleCancel} aria-label="Close">
              <Image src={applyReference4Icon} alt="Close" width={24} height={24} className="icon-24" />
            </button>
          </div>

          <div className={styles.content}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />

            <div className={styles.filterToolbar}>
              <div className={styles.parallelSelects}>
                <Select
                  value={selectedLibraryId}
                  onChange={handleLibraryChange}
                  className={styles.toolbarSelect}
                  placeholder={libraries.length === 0 ? 'No libraries' : 'Select library'}
                  disabled={libraries.length === 0}
                  getPopupContainer={() => modalRef.current || document.body}
                  popupMatchSelectWidth={false}
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

                <Select
                  value={selectedColumnFieldId}
                  onChange={setSelectedColumnFieldId}
                  className={styles.toolbarSelect}
                  placeholder={libraryFields.length === 0 ? 'No columns' : 'Select column'}
                  disabled={libraryFields.length === 0 || !selectedLibraryId}
                  getPopupContainer={() => modalRef.current || document.body}
                  popupMatchSelectWidth={false}
                  optionLabelProp="label"
                >
                  {libraryFields.map((f) => (
                    <Select.Option key={f.id} value={f.id} label={f.label}>
                      <div className={styles.selectOptionRow}>
                        <UnorderedListOutlined className={styles.columnSelectIcon} />
                        <span className={styles.selectOptionText}>{f.label}</span>
                      </div>
                    </Select.Option>
                  ))}
                </Select>
              </div>

              <div className={styles.viewToggle} role="group" aria-label="View mode">
                <button
                  type="button"
                  className={`${styles.viewToggleBtn} ${viewMode === 'list' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                  aria-label="List view"
                >
                  <UnorderedListOutlined />
                </button>
                <button
                  type="button"
                  className={`${styles.viewToggleBtn} ${viewMode === 'grid' ? styles.viewToggleBtnActive : ''}`}
                  onClick={() => setViewMode('grid')}
                  aria-pressed={viewMode === 'grid'}
                  aria-label="Grid view"
                >
                  <Image src={assetRefMenuGridIcon} alt="" width={18} height={18} className="icon-18" />
                </button>
              </div>
            </div>

            {viewMode === 'grid' ? (
              <div className={styles.assetsGrid}>
                {loading ? (
                  <div className={styles.loading}>
                    <Spin />
                  </div>
                ) : filteredAssets.length === 0 ? (
                  <div className={styles.emptyMessage}>No assets found</div>
                ) : (
                  filteredAssets.map((asset) => (
                    <div
                      key={asset.id}
                      className={`${styles.assetCard} ${
                        tempSelectedAssets.some((a) => a.id === asset.id) ? styles.assetCardSelected : ''
                      }`}
                      onClick={() => handleAssetToggle(asset)}
                    >
                      <Avatar
                        style={{
                          backgroundColor: getAvatarColor(asset.id, asset.displayValue || 'Untitled'),
                        }}
                        size={30}
                        className={styles.assetIcon}
                      >
                        {getAvatarText(asset.displayValue || 'Untitled')}
                      </Avatar>
                      {tempSelectedAssets.some((a) => a.id === asset.id) ? (
                        <span className={styles.assetCardCheck}>✓</span>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className={styles.assetsList}>
                {loading ? (
                  <div className={styles.loading}>
                    <Spin />
                  </div>
                ) : filteredAssets.length === 0 ? (
                  <div className={styles.emptyMessage}>No assets found</div>
                ) : (
                  filteredAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className={`${styles.assetListRow} ${
                        tempSelectedAssets.some((a) => a.id === asset.id) ? styles.assetListRowSelected : ''
                      }`}
                      onClick={() => handleAssetToggle(asset)}
                    >
                      <Avatar
                        size={28}
                        style={{
                          backgroundColor: getAvatarColor(asset.id, asset.displayValue || 'Untitled'),
                          flexShrink: 0,
                        }}
                      >
                        {getAvatarText(asset.displayValue || 'Untitled')}
                      </Avatar>
                      <span className={styles.assetListLabel}>{asset.displayValue || 'Untitled'}</span>
                      {tempSelectedAssets.some((a) => a.id === asset.id) ? (
                        <span className={styles.assetListCheck}>✓</span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className={styles.footer}>
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
            <button
              className={styles.applyButton}
              onClick={handleApply}
              style={{ opacity: tempSelectedAssets.length === 0 ? 0.5 : 1, cursor: tempSelectedAssets.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
