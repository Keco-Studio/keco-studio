'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { getLibrary, Library } from '@/lib/services/libraryService';
import LibraryAssetsTable from '@/components/libraries/LibraryAssetsTable';
import {
  AssetRow,
  LibrarySummary,
  PropertyConfig,
  SectionConfig,
} from '@/lib/types/libraryAssets';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
  getLibrarySummary,
  createAsset,
  updateAsset,
  deleteAsset,
} from '@/lib/services/libraryAssetsService';
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

export default function LibraryPage() {
  const params = useParams();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  
  const [project, setProject] = useState<Project | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { userProfile } = useAuth();
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [assetName, setAssetName] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Phase 2: state for Library assets table view (placeholder data, wired via service layer)
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [tableSections, setTableSections] = useState<SectionConfig[]>([]);
  const [tableProperties, setTableProperties] = useState<PropertyConfig[]>([]);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);

  const sections = useMemo(() => {
    const map: Record<string, FieldDef[]> = {};
    fieldDefs.forEach((f) => {
      if (!map[f.section]) map[f.section] = [];
      map[f.section].push(f);
    });
    // ensure order within section
    Object.keys(map).forEach((key) => {
      map[key] = map[key].slice().sort((a, b) => a.order_index - b.order_index);
    });
    return map;
  }, [fieldDefs]);

  const fetchDefinitions = useCallback(async () => {
    const { data, error } = await supabase
      .from('library_field_definitions')
      .select('*')
      .eq('library_id', libraryId)
      .order('section', { ascending: true })
      .order('order_index', { ascending: true });
    if (error) throw error;
    setFieldDefs((data as FieldDef[]) || []);
  }, [supabase, libraryId]);

  useEffect(() => {
    const fetchData = async () => {
      if (!projectId || !libraryId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        const [projectData, libraryData] = await Promise.all([
          getProject(supabase, projectId),
          getLibrary(supabase, libraryId, projectId),
        ]);
        
        if (!projectData) {
          setError('Project not found');
          return;
        }
        
        if (!libraryData) {
          setError('Library not found');
          return;
        }
        
        setProject(projectData);
        setLibrary(libraryData);

        // Existing form: keep definitions loading for now
        await fetchDefinitions();

        // Phase 2: wire Library assets table using placeholder service implementations.
        const [summary, schema, rows] = await Promise.all([
          getLibrarySummary(supabase, libraryId),
          getLibrarySchema(supabase, libraryId),
          getLibraryAssetsWithProperties(supabase, libraryId),
        ]);

        setLibrarySummary(summary);
        setTableSections(schema.sections);
        setTableProperties(schema.properties);
        setAssetRows(rows);
      } catch (e: any) {
        setError(e?.message || 'Failed to load library');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId, libraryId, supabase, fetchDefinitions]);

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleCreateAsset = async () => {
    setSaveError(null);
    setSaveSuccess(null);
    if (!assetName.trim()) {
      setSaveError('Asset name is required');
      return;
    }
    setSaving(true);
    try {
      // create asset
      const { data: asset, error: assetErr } = await supabase
        .from('library_assets')
        .insert({ library_id: libraryId, name: assetName.trim() })
        .select()
        .single();
      if (assetErr) throw assetErr;

      const assetId = asset.id as string;

      // build values payload
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
        return { asset_id: assetId, field_id: f.id, value_json: v };
      });

      if (payload.length > 0) {
        const { error: valErr } = await supabase
          .from('library_asset_values')
          .upsert(payload, { onConflict: 'asset_id,field_id' });
        if (valErr) throw valErr;
      }

      setSaveSuccess('Asset created');
      setAssetName('');
      setValues({});
      // Notify Sidebar to refresh assets for this library
      window.dispatchEvent(new CustomEvent('assetCreated', { detail: { libraryId } }));
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to create asset');
    } finally {
      setSaving(false);
    }
  };

  // Callback for saving new asset from table
  const handleSaveAssetFromTable = async (assetName: string, propertyValues: Record<string, any>) => {
    await createAsset(supabase, libraryId, assetName, propertyValues);
    // Refresh asset rows
    const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
    setAssetRows(rows);
    // Notify Sidebar to refresh assets for this library
    window.dispatchEvent(new CustomEvent('assetCreated', { detail: { libraryId } }));
  };

  // Callback for updating asset from table
  const handleUpdateAssetFromTable = async (assetId: string, assetName: string, propertyValues: Record<string, any>) => {
    await updateAsset(supabase, assetId, assetName, propertyValues);
    // Refresh asset rows
    const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
    setAssetRows(rows);
  };

  // Callback for deleting asset from table
  const handleDeleteAssetFromTable = async (assetId: string) => {
    await deleteAsset(supabase, assetId);
    // Refresh asset rows
    const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
    setAssetRows(rows);
    // Notify Sidebar to refresh assets for this library
    window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
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

  if (!library || !project) {
    return (
      <div className={styles.notFoundContainer}>
        <div>Library not found</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{library.name}</h1>
          <div className={styles.subtitle}>{library.description}</div>
        </div>
      </div>

      {/* Phase 2: Library assets table preview (placeholder data).
          Later phases will replace placeholder service logic with real Supabase-backed data
          and upgrade the table to a two-level header that mirrors predefine + Figma. */}
      <LibraryAssetsTable
        library={
          librarySummary
            ? {
                id: librarySummary.id,
                name: librarySummary.name,
                description: librarySummary.description,
              }
            : {
                id: library.id,
                name: library.name,
                description: library.description,
              }
        }
        sections={tableSections}
        properties={tableProperties}
        rows={assetRows}
        onSaveAsset={handleSaveAssetFromTable}
        onUpdateAsset={handleUpdateAssetFromTable}
        onDeleteAsset={handleDeleteAssetFromTable}
      />

      {saveError && (
        <div className={styles.saveError}>
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className={styles.saveSuccess}>
          {saveSuccess}
        </div>
      )}

      {!userProfile && <div className={styles.authWarning}>Please sign in to edit.</div>}

      {/* {userProfile && (
        <div className={styles.formContainer}>
          <div className={styles.inputRow}>
            <input
              className={styles.assetNameInput}
              placeholder="Asset name"
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
            />
            <button
              onClick={handleCreateAsset}
              disabled={saving}
              className={styles.addButton}
            >
              {saving ? 'Saving...' : 'Add New Asset'}
            </button>
          </div>

          <div className={styles.fieldsContainer}>
            {Object.keys(sections).length === 0 && (
              <div className={styles.emptyFieldsMessage}>No field definitions yet. Please configure fields in Predefine first.</div>
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
                    const inputType = f.data_type === 'int' || f.data_type === 'float' ? 'number' : f.data_type === 'date' ? 'date' : 'text';
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
      )} */}
    </div>
  );
}

