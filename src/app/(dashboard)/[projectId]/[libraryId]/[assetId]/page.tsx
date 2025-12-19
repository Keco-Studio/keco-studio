'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { ConfigProvider, Tabs } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getFieldTypeIcon } from '../predefine/utils';
import styles from './page.module.css';
import Image from 'next/image';
import predefineDragIcon from '@/app/assets/images/predefineDragIcon.svg';
import predefineLabelConfigIcon from '@/app/assets/images/predefineLabelConfigIcon.svg';

type FieldDef = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'media' | 'reference';
  enum_options: string[] | null;
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
  media: 'Media/File',
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

type AssetMode = 'view' | 'edit';

export default function AssetPage() {
  const params = useParams();
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  const assetId = params.assetId as string;

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [asset, setAsset] = useState<AssetRow | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [mode, setMode] = useState<AssetMode>('view');

  const sections = useMemo(() => {
    const map: Record<string, FieldDef[]> = {};
    fieldDefs.forEach((f) => {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push(f);
    });
    Object.keys(map).forEach((k) => (map[k] = map[k].slice().sort((a, b) => a.order_index - b.order_index)));
    return map;
  }, [fieldDefs]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
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

        setFieldDefs((defs as FieldDef[]) || []);
        setAsset(assetRow as AssetRow);
        const valueMap: Record<string, any> = {};
        (vals as ValueRow[] | null)?.forEach((v) => {
          valueMap[v.field_id] = v.value_json;
        });
        setValues(valueMap);
      } catch (e: any) {
        setError(e?.message || 'Failed to load asset');
      } finally {
        setLoading(false);
      }
    };
    if (assetId && libraryId) {
      load();
    }
  }, [assetId, libraryId, supabase]);

  // Listen to top bar Viewing / Editing toggle
  useEffect(() => {
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
  }, []);

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    if (!asset) return;
    setSaveError(null);
    setSaveSuccess(null);
    setSaving(true);
    try {
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
          v = raw || null;
        } else if (f.data_type === 'media' || f.data_type === 'reference') {
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

      setSaveSuccess('Saved');
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div>Loading asset...</div>
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

  if (!asset) {
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
          <h1 className={styles.title}>{asset.name}</h1>
        </div>
            <div className={styles.headerRight}>
              {saveError && <div className={styles.saveError}>{saveError}</div>}
              {saveSuccess && <div className={styles.saveSuccess}>{saveSuccess}</div>}
              {userProfile && mode === 'edit' && (
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

          <div className={styles.formContainer}>
          <div className={styles.fieldsContainer}>
              {sectionKeys.length === 0 && (
                <div className={styles.emptyFieldsMessage}>
                  还没有表头定义，请先在 Predefine 设置字段。
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
                                        <label className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={!!value}
                                            disabled={mode === 'view'}
                                            onChange={
                                              mode === 'edit'
                                                ? (e) =>
                                                    handleValueChange(
                                                      f.id,
                                                      e.target.checked
                                                    )
                                                : undefined
                                            }
                                            className={styles.disabledInput}
                          />
                                          <span>Enabled</span>
                        </label>
                                      </div>
                                      <button className={styles.configButton} disabled>
                                        <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
                                      </button>
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
                            value={value || ''}
                                          disabled={mode === 'view'}
                                          onChange={
                                            mode === 'edit'
                                              ? (e) =>
                                                  handleValueChange(
                                                    f.id,
                                                    e.target.value || null
                                                  )
                                              : undefined
                                          }
                                          className={`${styles.fieldSelect} ${
                                            mode === 'view' ? styles.disabledInput : ''
                                          }`}
                          >
                                          <option value="">Select option...</option>
                            {(f.enum_options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                                      </div>
                                      <button className={styles.configButton} disabled>
                                        <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
                                      </button>
                                    </div>
                      );
                    }

                                if (f.data_type === 'reference' || f.data_type === 'media') {
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
                                        <div
                                          className={`${styles.fieldInput} ${
                                            mode === 'view' ? styles.disabledInput : ''
                                          }`}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                          }}
                                        >
                                          {value ? (
                                            <>
                                              <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
                                              <Image src={predefineLabelConfigIcon} alt="Expand" width={16} height={16} />
                                            </>
                                          ) : (
                                            <span style={{ color: '#9ca3af' }}>No value</span>
                                          )}
                                        </div>
                                      </div>
                                      <button className={styles.configButton} disabled>
                                        <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
                                      </button>
                                    </div>
                                  );
                                }

                    const inputType =
                      f.data_type === 'int' || f.data_type === 'float'
                        ? 'number'
                        : f.data_type === 'date'
                        ? 'date'
                        : 'text';

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
                                          mode === 'edit'
                                            ? (e) =>
                                                handleValueChange(f.id, e.target.value)
                                            : undefined
                                        }
                                        className={`${styles.fieldInput} ${
                                          mode === 'view' ? styles.disabledInput : ''
                                        }`}
                          placeholder={f.label}
                        />
                                    </div>
                                    <button className={styles.configButton} disabled>
                                      <Image src={predefineLabelConfigIcon} alt="Config" width={20} height={20} />
                                    </button>
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


