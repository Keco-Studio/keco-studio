'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ConfigProvider, Tabs } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { getFieldTypeIcon } from '../../predefine/utils';
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

export default function NewAssetPage() {
  const params = useParams();
  const supabase = useSupabase();
  const router = useRouter();
  const { userProfile } = useAuth();

  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;

  const [library, setLibrary] = useState<Library | null>(null);
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const sections = useMemo(() => {
    const map: Record<string, FieldDef[]> = {};
    fieldDefs.forEach((f) => {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push(f);
    });
    Object.keys(map).forEach((k) => {
      map[k] = map[k].slice().sort((a, b) => a.order_index - b.order_index);
    });
    return map;
  }, [fieldDefs]);

  // Find the name field from the first section (should be the first field with label="name")
  const nameField = useMemo(() => {
    if (fieldDefs.length === 0) return null;
    const firstSection = sections[Object.keys(sections)[0]];
    if (!firstSection || firstSection.length === 0) return null;
    // The first field in the first section should be the "name" field
    const firstField = firstSection[0];
    if (firstField.label === 'name' && firstField.data_type === 'string') {
      return firstField;
    }
    return null;
  }, [fieldDefs, sections]);

  // Get asset name from the name field value
  const assetName = useMemo(() => {
    if (!nameField) return '';
    return values[nameField.id] || '';
  }, [nameField, values]);

  useEffect(() => {
    const load = async () => {
      if (!libraryId) return;
      setLoading(true);
      setError(null);
      try {
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
        setFieldDefs((defsRes.data as FieldDef[]) || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load library');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [libraryId, projectId, supabase]);

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(null);
    
    // Get asset name from the name field
    const nameValue = assetName.trim();
    if (!nameValue) {
      setSaveError('Asset name is required (please fill in the "name" field)');
      return;
    }

    setSaving(true);
    try {
      const { data: asset, error: assetErr } = await supabase
        .from('library_assets')
        .insert({ library_id: libraryId, name: nameValue })
        .select()
        .single();
      if (assetErr) throw assetErr;

      const assetId = asset.id as string;

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
        return { asset_id: assetId, field_id: f.id, value_json: v };
      });

      if (payload.length > 0) {
        const { error: valErr } = await supabase
          .from('library_asset_values')
          .upsert(payload, { onConflict: 'asset_id,field_id' });
        if (valErr) throw valErr;
      }

      setSaveSuccess('Asset created');
      setValues({});

      // Navigate to edit page for further changes
      router.push(`/${projectId}/${libraryId}/${assetId}`);
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to create asset');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div>Loading library...</div>
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

  if (!library) {
    return (
      <div className={styles.notFoundContainer}>
        <div>Library not found</div>
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
              {userProfile && (
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={styles.primaryButton}
                >
                  {saving ? 'Saving...' : 'Create asset'}
                </button>
              )}
            </div>
          </div>

          {!userProfile && (
            <div className={styles.authWarning}>Please sign in to add assets.</div>
          )}

          {userProfile && (
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
                                              onChange={(e) =>
                                                handleValueChange(f.id, e.target.checked)
                                              }
                                            />
                                            <span>Enabled</span>
                                          </label>
                                        </div>
                                        <button className={styles.configButton}>
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
                                            onChange={(e) =>
                                              handleValueChange(
                                                f.id,
                                                e.target.value || null
                                              )
                                            }
                                            className={styles.fieldSelect}
                                          >
                                            <option value="">Select option...</option>
                                            {(f.enum_options || []).map((opt) => (
                                              <option key={opt} value={opt}>
                                                {opt}
                                              </option>
                                            ))}
                                          </select>
                                        </div>
                                        <button className={styles.configButton}>
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
                                          onChange={(e) =>
                                            handleValueChange(f.id, e.target.value)
                                          }
                                          className={styles.fieldInput}
                                          placeholder={f.label}
                                        />
                                      </div>
                                      <button className={styles.configButton}>
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
          )}
        </div>
      </div>
    </ConfigProvider>
  );
}