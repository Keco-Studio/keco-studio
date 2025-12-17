'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import styles from './page.module.css';

type FieldDef = {
  id: string;
  library_id: string;
  section: string;
  label: string;
  data_type: 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date';
  enum_options: string[] | null;
  required: boolean;
  order_index: number;
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

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(null);
    if (!asset) return;
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{asset.name}</h1>
          <div className={styles.subtitle}>Asset ID: {asset.id}</div>
        </div>
        {saveError && (
          <div className={styles.saveError}>{saveError}</div>
        )}
        {saveSuccess && (
          <div className={styles.saveSuccess}>{saveSuccess}</div>
        )}
      </div>

      {!userProfile && <div className={styles.authWarning}>Please sign in to edit.</div>}

      {userProfile && (
        <div className={styles.formContainer}>
          <div className={styles.saveButtonContainer}>
            <button
              onClick={handleSave}
              disabled={saving}
              className={styles.saveButton}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className={styles.fieldsContainer}>
            {Object.keys(sections).length === 0 && (
              <div className={styles.emptyFieldsMessage}>No field definitions. Define headers in Predefine.</div>
            )}
            {Object.entries(sections).map(([sectionName, fields]) => (
              <div
                key={sectionName}
                className={styles.section}
              >
                <div className={styles.sectionTitle}>{sectionName}</div>
                <div className={styles.fieldsGrid}>
                  {fields.map((f) => {
                    const value = values[f.id] ?? (f.data_type === 'boolean' ? false : '');
                    const label = f.label + (f.required ? ' *' : '');
                    if (f.data_type === 'boolean') {
                      return (
                        <label key={f.id} className={styles.checkboxLabel}>
                          <input
                            type="checkbox"
                            checked={!!value}
                            onChange={(e) => handleValueChange(f.id, e.target.checked)}
                          />
                          {label}
                        </label>
                      );
                    }
                    if (f.data_type === 'enum') {
                      return (
                        <label key={f.id} className={styles.fieldLabel}>
                          <span>{label}</span>
                          <select
                            value={value || ''}
                            onChange={(e) => handleValueChange(f.id, e.target.value || null)}
                            className={styles.fieldSelect}
                          >
                            <option value="">-- Select --</option>
                            {(f.enum_options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    const inputType =
                      f.data_type === 'int' || f.data_type === 'float'
                        ? 'number'
                        : f.data_type === 'date'
                        ? 'date'
                        : 'text';
                    return (
                      <label key={f.id} className={styles.fieldLabel}>
                        <span>{label}</span>
                        <input
                          type={inputType}
                          value={value ?? ''}
                          onChange={(e) => handleValueChange(f.id, e.target.value)}
                          className={styles.fieldInput}
                          placeholder={f.label}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


