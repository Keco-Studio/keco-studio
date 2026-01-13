'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ConfigProvider, Tabs, Switch } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { getFieldTypeIcon } from '../predefine/utils';
import styles from './page.module.css';
import Image from 'next/image';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineLabelConfigIcon from '@/app/assets/images/predefineLabelConfigIcon.svg';
import noassetIcon1 from '@/app/assets/images/NoassetIcon1.svg';
import noassetIcon2 from '@/app/assets/images/NoassetIcon2.svg';
import { MediaFileUpload } from '@/components/media/MediaFileUpload';
import type { MediaFileMetadata } from '@/lib/services/mediaFileUploadService';
import { AssetReferenceSelector } from '@/components/asset/AssetReferenceSelector';

type FieldDef = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference';
  enum_options: string[] | null;
  reference_libraries: string[] | null;
  required: boolean;
  order_index: number;
};

const DATA_TYPE_LABEL: Record<FieldDef['data_type'], string> = {
  string: 'String',
  int: 'Int',
  float: 'Float',
  boolean: 'Boolean',
  enum: 'Option',
  date: 'Date',
  image: 'Image',
  file: 'File',
  reference: 'Reference',
};

type AssetRow = {
  id: string;
  name: string;
  library_id: string;
};

type ValueRow = {
  field_id: string;
  value_json: any;
};

type AssetMode = 'view' | 'edit' | 'create';

export default function AssetPage() {
  const params = useParams();
  const supabase = useSupabase();
  const router = useRouter();
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const assetId = params.assetId as string;
  
  // Check if this is a new asset creation
  const isNewAsset = assetId === 'new';

  const [library, setLibrary] = useState<Library | null>(null);
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<AssetMode>(isNewAsset ? 'create' : 'edit');
  const [navigating, setNavigating] = useState(false);

  const sections = useMemo(() => {
    const map: Record<string, FieldDef[]> = {};
    fieldDefs.forEach((f) => {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push(f);
    });
    Object.keys(map).forEach((k) => (map[k] = map[k].slice().sort((a, b) => a.order_index - b.order_index)));
    return map;
  }, [fieldDefs]);

  // Find the name field (for both new and existing assets)
  const nameField = useMemo(() => {
    if (fieldDefs.length === 0) return null;
    // First try to find a field with label 'name' and type 'string'
    const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
    if (nameFieldDef) return nameFieldDef;
    
    // Fallback: for new assets, use the first field of the first section
    if (isNewAsset) {
      const firstSectionKey = Object.keys(sections)[0];
      const firstSection = sections[firstSectionKey];
      if (!firstSection || firstSection.length === 0) return null;
      const firstField = firstSection[0];
      if (firstField.label === 'name' && firstField.data_type === 'string') {
        return firstField;
      }
    }
    return null;
  }, [isNewAsset, fieldDefs, sections]);

  // Get asset name (prioritize edited value, then asset name)
  const assetName = useMemo(() => {
    // If we have a name field and its value is being edited, use that
    if (nameField && values[nameField.id] !== undefined && values[nameField.id] !== null) {
      const editedValue = String(values[nameField.id]).trim();
      if (editedValue !== '') {
        return editedValue;
      }
    }
    // Otherwise, use the asset's name (for existing assets)
    return asset?.name || '';
  }, [nameField, values, asset]);

  useEffect(() => {
    const load = async () => {
      if (!libraryId) return;
      setLoading(true);
      setError(null);
      try {
        if (isNewAsset) {
          // Load library and field definitions only
          const [lib, defsRes] = await Promise.all([
            getLibrary(supabase, libraryId, projectId),
            supabase
              .from('library_field_definitions')
              .select('*')
              .eq('library_id', libraryId)
              .order('section', { ascending: true })
              .order('order_index', { ascending: true }),
          ]);

          if (!lib) {
            setError('Library not found');
            return;
          }

          if (defsRes.error) {
            throw defsRes.error;
          }

          setLibrary(lib);
          // Migrate legacy 'media' type to 'image' for backward compatibility
          const defs = (defsRes.data as FieldDef[]) || [];
          const migratedDefs = defs.map(def => ({
            ...def,
            data_type: def.data_type === 'media' as any ? 'image' : def.data_type
          }));
          setFieldDefs(migratedDefs);
        } else {
          // Load field definitions, asset, and values
          const [{ data: defs, error: defErr }, { data: assetRow, error: assetErr }, { data: vals, error: valErr }] =
            await Promise.all([
              supabase
                .from('library_field_definitions')
                .select('*')
                .eq('library_id', libraryId)
                .order('section', { ascending: true })
                .order('order_index', { ascending: true }),
              supabase.from('library_assets').select('id,name,library_id').eq('id', assetId).single(),
              supabase.from('library_asset_values').select('field_id,value_json').eq('asset_id', assetId),
            ]);

          if (defErr) throw defErr;
          if (assetErr) throw assetErr;
          if (!assetRow) throw new Error('Asset not found');
          if (assetRow.library_id !== libraryId) throw new Error('Asset not in this library');
          if (valErr) throw valErr;

          // Migrate legacy 'media' type to 'image' for backward compatibility
          const fieldDefs = (defs as FieldDef[]) || [];
          const migratedDefs = fieldDefs.map(def => ({
            ...def,
            data_type: def.data_type === 'media' as any ? 'image' : def.data_type
          }));
          setFieldDefs(migratedDefs);
          setAsset(assetRow as AssetRow);
          
          // Create a map of field IDs to field definitions for easier lookup
          const fieldDefMap = new Map(migratedDefs.map(f => [f.id, f]));
          
          const valueMap: Record<string, any> = {};
          (vals as ValueRow[] | null)?.forEach((v) => {
            let parsedValue = v.value_json;
            const fieldDef = fieldDefMap.get(v.field_id);
            
            // Parse JSON strings for image/file/reference fields
            if (fieldDef && (fieldDef.data_type === 'image' || fieldDef.data_type === 'file' || fieldDef.data_type === 'reference')) {
              if (typeof parsedValue === 'string' && parsedValue.trim() !== '') {
                try {
                  parsedValue = JSON.parse(parsedValue);
                } catch {
                  // If parsing fails, keep the original value (might be legacy format)
                }
              }
            }
            
            valueMap[v.field_id] = parsedValue;
          });
          setValues(valueMap);
        }
      } catch (e: any) {
        setError(e?.message || (isNewAsset ? 'Failed to load library' : 'Failed to load asset'));
      } finally {
        setLoading(false);
      }
    };
    
    load();
  }, [assetId, libraryId, projectId, supabase, isNewAsset]);

  // Notify TopBar about current mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asset-page-mode', {
          detail: { mode, isNewAsset },
        })
      );
    }
  }, [mode, isNewAsset]);

  // Listen for asset updates to refresh asset name
  useEffect(() => {
    if (isNewAsset) return; // New assets don't need to listen for updates
    
    const handleAssetUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent<{ assetId: string; libraryId?: string }>;
      // Only refresh if the event is for this asset
      if (customEvent.detail?.assetId === assetId) {
        try {
          // Use a small delay to ensure database transaction is committed
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Refresh asset data - query directly from database
          const { data: assetRow, error: assetErr } = await supabase
            .from('library_assets')
            .select('id, name, library_id')
            .eq('id', assetId)
            .single();
          
          if (!assetErr && assetRow) {
            setAsset(assetRow as AssetRow);
            // If there's a name field, update its value too
            const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
            if (nameFieldDef) {
              setValues(prev => ({ ...prev, [nameFieldDef.id]: assetRow.name }));
            }
          } else if (assetErr) {
            console.error('Error refreshing asset:', assetErr);
          }
        } catch (e: any) {
          console.error('Failed to refresh asset:', e);
        }
      }
    };

    window.addEventListener('assetUpdated', handleAssetUpdated as EventListener);

    return () => {
      window.removeEventListener('assetUpdated', handleAssetUpdated as EventListener);
    };
  }, [assetId, isNewAsset, supabase, fieldDefs]);

  // Listen to top bar Viewing / Editing toggle (only for existing assets)
  useEffect(() => {
    if (isNewAsset) return; // New assets don't need mode toggle from TopBar
    
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ mode?: AssetMode }>;
      const nextMode = custom.detail?.mode;
      if (nextMode === 'view' || nextMode === 'edit') {
        setMode(nextMode);
        // Clear status messages when switching mode
        setSaveError(null);
        setSaveSuccess(null);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-mode-change', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-mode-change', handler as EventListener);
      }
    };
  }, [isNewAsset]);

  // Handle navigate to predefine page
  const handlePredefineClick = () => {
    router.push(`/${projectId}/${libraryId}/predefine`);
  };

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(null);
    
    // Validate int fields before saving
    for (const f of fieldDefs) {
      if (f.data_type === 'int') {
        const raw = values[f.id];
        if (raw !== '' && raw !== undefined && raw !== null) {
          const strValue = String(raw).trim();
          if (strValue !== '') {
            // Check if value contains decimal point or is not a valid integer
            if (strValue.includes('.') || !/^-?\d+$/.test(strValue)) {
              setSaveError(`Field "${f.label}" must be an integer (no decimals allowed). Please enter a valid integer.`);
              return;
            }
          }
        }
      }
    }
    
    if (isNewAsset) {
      // Create new asset
      const nameValue = assetName.trim();
      if (!nameValue) {
        setSaveError('Asset name is required (please fill in the "name" field)');
        return;
      }

      setSaving(true);
      try {
        const { data: newAsset, error: assetErr } = await supabase
          .from('library_assets')
          .insert({ library_id: libraryId, name: nameValue })
          .select()
          .single();
        if (assetErr) throw assetErr;

        const newAssetId = newAsset.id as string;

        const payload = fieldDefs.map((f) => {
          const raw = values[f.id];
          let v: any = raw;
          if (f.data_type === 'int') {
            v = raw === '' || raw === undefined ? null : parseInt(raw, 10);
          } else if (f.data_type === 'float') {
            v = raw === '' || raw === undefined ? null : parseFloat(raw);
          } else if (f.data_type === 'boolean') {
            v = !!raw;
          } else if (f.data_type === 'date') {
            v = raw || null;
          } else if (f.data_type === 'enum') {
            v = (raw === '' || raw === undefined || raw === null) ? null : raw;
          } else if (f.data_type === 'image' || f.data_type === 'file' || f.data_type === 'reference') {
            v = raw || null;
          } else {
            v = raw ?? null;
          }
          return { asset_id: newAssetId, field_id: f.id, value_json: v };
        });

        if (payload.length > 0) {
          const { error: valErr } = await supabase
            .from('library_asset_values')
            .upsert(payload, { onConflict: 'asset_id,field_id' });
          if (valErr) throw valErr;
        }

        setSaveSuccess('Asset created successfully! Loading asset page...');
        setValues({});
        setNavigating(true);

        // Dispatch event to notify Sidebar to refresh assets
        window.dispatchEvent(new CustomEvent('assetCreated', {
          detail: { libraryId, assetId: newAssetId }
        }));

        // Navigate to edit page for further changes with a slight delay
        setTimeout(() => {
          router.push(`/${projectId}/${libraryId}/${newAssetId}`);
        }, 500);
      } catch (e: any) {
        setSaveError(e?.message || 'Failed to create asset');
      } finally {
        setSaving(false);
      }
    } else {
      // Update existing asset
      if (!asset) return;
      
      setSaving(true);
      try {
        // Find the name field and update asset name if changed
        const nameFieldDef = fieldDefs.find(f => f.label === 'name' && f.data_type === 'string');
        let newAssetName = asset.name;
        
        if (nameFieldDef) {
          const nameValue = values[nameFieldDef.id];
          if (nameValue !== undefined && nameValue !== null && String(nameValue).trim() !== '') {
            newAssetName = String(nameValue).trim();
          }
        }
        
        // Update asset name if it changed
        if (newAssetName !== asset.name) {
          const { error: assetUpdateErr } = await supabase
            .from('library_assets')
            .update({ name: newAssetName })
            .eq('id', asset.id);
          if (assetUpdateErr) throw assetUpdateErr;
          
          // Update local asset state
          setAsset({ ...asset, name: newAssetName });
        }
        
        const payload = fieldDefs.map((f) => {
          const raw = values[f.id];
          let v: any = raw;
          if (f.data_type === 'int') {
            v = raw === '' || raw === undefined ? null : parseInt(raw, 10);
          } else if (f.data_type === 'float') {
            v = raw === '' || raw === undefined ? null : parseFloat(raw);
          } else if (f.data_type === 'boolean') {
            v = !!raw;
          } else if (f.data_type === 'date') {
            v = raw || null;
          } else if (f.data_type === 'enum') {
            v = (raw === '' || raw === undefined || raw === null) ? null : raw;
          } else if (f.data_type === 'image' || f.data_type === 'file' || f.data_type === 'reference') {
            v = raw || null;
          } else {
            v = raw ?? null;
          }
          return { asset_id: asset.id, field_id: f.id, value_json: v };
        });

        if (payload.length > 0) {
          const { error: valErr } = await supabase
            .from('library_asset_values')
            .upsert(payload, { onConflict: 'asset_id,field_id' });
          if (valErr) throw valErr;
        }

        // Dispatch event to notify Sidebar to refresh assets
        window.dispatchEvent(new CustomEvent('assetUpdated', {
          detail: { libraryId, assetId: asset.id }
        }));

        setSaveSuccess('Saved');
      } catch (e: any) {
        setSaveError(e?.message || 'Save failed');
      } finally {
        setSaving(false);
      }
    }
  }, [isNewAsset, assetName, supabase, libraryId, fieldDefs, values, asset, router, projectId]);

  // Auto-clear save success message after 2 seconds
  useEffect(() => {
    if (saveSuccess) {
      const timer = setTimeout(() => {
        setSaveSuccess(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [saveSuccess]);

  // Listen to TopBar Create Asset button click for new assets
  useEffect(() => {
    if (!isNewAsset) return;
    
    const handler = () => {
      handleSave();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-create-save', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-create-save', handler as EventListener);
      }
    };
  }, [isNewAsset, handleSave]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div>{isNewAsset ? 'Loading library...' : 'Loading asset...'}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorText}>{error}</div>
      </div>
    );
  }

  if (!isNewAsset && !asset) {
    return (
      <div className={styles.notFoundContainer}>
        <div>Asset not found</div>
      </div>
    );
  }

  const sectionKeys = Object.keys(sections);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#8726EE',
        },
      }}
    >
    <div className={styles.container}>
        <div className={styles.contentWrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{assetName || 'New asset'}</h1>
        </div>
            <div className={styles.headerRight}>
              {saveError && <div className={styles.saveError}>{saveError}</div>}
              {saveSuccess && <div className={styles.saveSuccess}>{saveSuccess}</div>}
              {!isNewAsset && userProfile && mode === 'edit' && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={styles.primaryButton}
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              )}
            </div>
          </div>
          {!authLoading && !isAuthenticated && isNewAsset && (
            <div className={styles.authWarning}>Please sign in to add assets.</div>
          )}

          <div className={styles.formContainer}>
          <div className={styles.fieldsContainer}>
              {sectionKeys.length === 0 && (
                <div className={styles.emptyState}>
                  <Image
                    src={noassetIcon1}
                    alt=""
                    width={72}
                    height={72}
                    className={styles.emptyStateIcon}
                  />
                  <p className={styles.emptyStateText}>
                    There is no any asset here. You need to create an asset firstly.
                  </p>
                  <button className={styles.predefineButton} onClick={handlePredefineClick}>
                    <Image
                      src={noassetIcon2}
                      alt=""
                      width={24}
                      height={24}
                      className={styles.predefineButtonIcon}
                    />
                    <span>Predefine</span>
                  </button>
                </div>
              )}

              {sectionKeys.length > 0 && (
                <div className={styles.tabsContainer}>
                  <Tabs
                    defaultActiveKey={sectionKeys[0]}
                    items={sectionKeys.map((sectionName) => {
                      const fields = sections[sectionName] || [];
                      return {
                        key: sectionName,
                        label: sectionName,
                        children: (
                          <div className={styles.tabContent}>
                            <div className={styles.fieldsList}>
                  {fields.map((f) => {
                                const value =
                                  values[f.id] ?? (f.data_type === 'boolean' ? false : '');
                                const label = f.label;

                    if (f.data_type === 'boolean') {
                      return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                   
                                      <div className={styles.fieldControl}>
                                        <div className={styles.booleanToggle}>
                                          <Switch
                                            checked={!!value}
                                            disabled={mode === 'view'}
                                            onChange={
                                              mode !== 'view'
                                                ? (checked) => handleValueChange(f.id, checked)
                                                : undefined
                                            }
                                          />
                                          <span className={styles.booleanLabel}>
                                            {value ? 'True' : 'False'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                      );
                    }

                    if (f.data_type === 'enum') {
                      return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                    
                                      <div className={styles.fieldControl}>
                          <select
                            value={value ?? ''}
                                          disabled={mode === 'view'}
                                          onChange={
                                            mode !== 'view'
                                              ? (e) =>
                                                  handleValueChange(
                                                    f.id,
                                                    e.target.value === '' ? null : e.target.value
                                                  )
                                              : undefined
                                          }
                                          className={`${styles.fieldSelect} ${
                                            mode === 'view' ? styles.disabledInput : ''
                                          }`}
                          >
                            <option value="">Select an option</option>
                            {(f.enum_options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                                      </div>
                                    </div>
                      );
                    }

                                if (f.data_type === 'image' || f.data_type === 'file') {
                                  return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                     
                                      <div className={styles.fieldControl}>
                                        <MediaFileUpload
                                          value={value as MediaFileMetadata | null}
                                          onChange={(newValue) => handleValueChange(f.id, newValue)}
                                          disabled={mode === 'view'}
                                          fieldType={f.data_type}
                                        />
                                      </div>
                                    </div>
                                  );
                                }

                                if (f.data_type === 'reference') {
                                  return (
                                    <div key={f.id} className={styles.fieldRow}>
                                      <div className={styles.dragHandle}>
                                        <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                      </div>
                                      <div className={styles.fieldMeta}>
                                        <span className={styles.fieldLabel}>
                                          {label}
                                          {f.required && (
                                            <span className={styles.requiredMark}>*</span>
                                          )}
                                        </span>
                                        <div className={styles.dataTypeTag}>
                                          <Image
                                            src={getFieldTypeIcon(f.data_type)}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className={styles.dataTypeIcon}
                                          />
                                          {DATA_TYPE_LABEL[f.data_type]}
                                        </div>
                                      </div>                                     
                                      <div className={styles.fieldControl}>
                                        <AssetReferenceSelector
                                          value={value}
                                          onChange={(newValue) => handleValueChange(f.id, newValue)}
                                          referenceLibraries={f.reference_libraries ?? []}
                                          disabled={mode === 'view'}
                                        />
                                      </div>
                                    </div>
                                  );
                                }

                    const inputType =
                      f.data_type === 'int' || f.data_type === 'float'
                        ? 'number'
                        : f.data_type === 'date'
                        ? 'date'
                        : 'text';
                    
                    // Add class to hide spinner for int type
                    const inputClassName = f.data_type === 'int' 
                      ? `${styles.fieldInput} ${styles.noSpinner} ${mode === 'view' ? styles.disabledInput : ''}`
                      : `${styles.fieldInput} ${mode === 'view' ? styles.disabledInput : ''}`;

                    return (
                                  <div key={f.id} className={styles.fieldRow}>
                                    <div className={styles.dragHandle}>
                                      <Image src={predefineDragIcon} alt="Drag" width={16} height={16} />
                                    </div>
                                    <div className={styles.fieldMeta}>
                                      <span className={styles.fieldLabel}>
                                        {label}
                                        {f.required && (
                                          <span className={styles.requiredMark}>*</span>
                                        )}
                                      </span>
                                      <div className={styles.dataTypeTag}>
                                        <Image
                                          src={getFieldTypeIcon(f.data_type)}
                                          alt=""
                                          width={16}
                                          height={16}
                                          className={styles.dataTypeIcon}
                                        />
                                        {DATA_TYPE_LABEL[f.data_type]}
                                      </div>
                                    </div>
                                    <div className={styles.fieldControl}>
                        <input
                          type={inputType}
                          value={value ?? ''}
                                        disabled={mode === 'view'}
                                        onChange={
                                          mode !== 'view'
                                            ? (e) =>
                                                handleValueChange(f.id, e.target.value)
                                            : undefined
                                        }
                                        className={inputClassName}
                          placeholder={f.label}
                        />
                                    </div>
                                    {/* Only Reference and Option (enum) show configure icon */}
                                  </div>
                    );
                  })}
                </div>
              </div>
                        ),
                      };
                    })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
    </ConfigProvider>
  );
}


