'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';

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
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Loading asset...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: '#dc2626' }}>{error}</div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div>Asset not found</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{asset.name}</h1>
          <div style={{ color: '#64748b' }}>Asset ID: {asset.id}</div>
        </div>
        {saveError && (
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>{saveError}</div>
        )}
        {saveSuccess && (
          <div style={{ padding: '8px 10px', borderRadius: 8, background: '#ecfdf3', color: '#166534' }}>{saveSuccess}</div>
        )}
      </div>

      {!userProfile && <div style={{ color: '#dc2626' }}>Please sign in to edit.</div>}

      {userProfile && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: 'none',
                background: '#4f46e5',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
            {Object.keys(sections).length === 0 && (
              <div style={{ color: '#94a3b8' }}>No field definitions. Define headers in Predefine.</div>
            )}
            {Object.entries(sections).map(([sectionName, fields]) => (
              <div
                key={sectionName}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: 12,
                  background: '#f8fafc',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 10 }}>{sectionName}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  {fields.map((f) => {
                    const value = values[f.id] ?? (f.data_type === 'boolean' ? false : '');
                    const label = f.label + (f.required ? ' *' : '');
                    if (f.data_type === 'boolean') {
                      return (
                        <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                        <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span>{label}</span>
                          <select
                            value={value || ''}
                            onChange={(e) => handleValueChange(f.id, e.target.value || null)}
                            style={{ padding: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}
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
                      <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span>{label}</span>
                        <input
                          type={inputType}
                          value={value ?? ''}
                          onChange={(e) => handleValueChange(f.id, e.target.value)}
                          style={{ padding: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}
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


