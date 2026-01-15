'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Tooltip, message } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import { getProject, Project } from '@/lib/services/projectService';
import { getLibrary, Library } from '@/lib/services/libraryService';
import LibraryAssetsTable from '@/components/libraries/LibraryAssetsTable';
import { LibraryHeader } from '@/components/libraries/LibraryHeader';
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
import { usePresenceTracking } from '@/lib/hooks/usePresenceTracking';
import { PresenceIndicators } from '@/components/collaboration/PresenceIndicators';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import type { PresenceState, CollaboratorRole } from '@/lib/types/collaboration';
import { YjsProvider } from '@/contexts/YjsContext';
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
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [assetName, setAssetName] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<CollaboratorRole>('viewer');

  // Phase 2: state for Library assets table view (placeholder data, wired via service layer)
  const [librarySummary, setLibrarySummary] = useState<LibrarySummary | null>(null);
  const [tableSections, setTableSections] = useState<SectionConfig[]>([]);
  const [tableProperties, setTableProperties] = useState<PropertyConfig[]>([]);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);

  // Presence tracking for real-time collaboration
  const userAvatarColor = useMemo(() => {
    return userProfile?.id ? getUserAvatarColor(userProfile.id) : '#999999';
  }, [userProfile?.id]);

  // Presence join/leave event handlers
  const handlePresenceJoin = useCallback((user: PresenceState) => {
    message.success(`${user.userName} joined the library`, 2);
  }, []);

  const handlePresenceLeave = useCallback((userId: string, userName: string) => {
    message.info(`${userName} left the library`, 2);
  }, []);

  // Initialize presence tracking
  const {
    isTracking,
    presenceUsers,
    activeUserCount,
    updateActiveCell,
    updateCursorPosition,
    getUsersEditingCell,
    getActiveUsers,
  } = usePresenceTracking({
    libraryId: libraryId,
    userId: userProfile?.id || '',
    userName: userProfile?.full_name || userProfile?.username || 'Anonymous',
    userEmail: userProfile?.email || '',
    avatarColor: userAvatarColor,
    onPresenceJoin: handlePresenceJoin,
    onPresenceLeave: handlePresenceLeave,
  });

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

  // Fetch user role for this project
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!projectId || !userProfile?.id) return;
      
      try {
        const { data, error } = await supabase
          .from('project_collaborators')
          .select('role')
          .eq('project_id', projectId)
          .eq('user_id', userProfile.id)
          .maybeSingle();
        
        if (error) {
          console.error('Error fetching user role:', error);
          return;
        }
        
        if (data) {
          setUserRole(data.role as CollaboratorRole);
        } else {
          // Check if user is the project owner
          const { data: projectData } = await supabase
            .from('projects')
            .select('user_id')
            .eq('id', projectId)
            .single();
          
          if (projectData?.user_id === userProfile.id) {
            setUserRole('admin');
          }
        }
      } catch (e) {
        console.error('Failed to fetch user role:', e);
      }
    };
    
    fetchUserRole();
  }, [projectId, userProfile?.id, supabase]);

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

  // Listen for library updates to refresh library name
  useEffect(() => {
    const handleLibraryUpdated = async (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      // Only refresh if the event is for this library
      if (customEvent.detail?.libraryId === libraryId) {
        try {
          // Refresh library data
          const libraryData = await getLibrary(supabase, libraryId, projectId);
          if (libraryData) {
            setLibrary(libraryData);
          }
          // Also refresh library summary for the table
          const summary = await getLibrarySummary(supabase, libraryId);
          if (summary) {
            setLibrarySummary(summary);
          }
        } catch (e: any) {
          console.error('Failed to refresh library:', e);
        }
      }
    };

    window.addEventListener('libraryUpdated', handleLibraryUpdated as EventListener);

    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdated as EventListener);
    };
  }, [libraryId, projectId, supabase]);

  // Listen for asset changes (created/updated/deleted) from Sidebar or other sources
  useEffect(() => {
    const handleAssetChange = async (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string; assetId?: string }>;
      // Only refresh if the event is for this library
      if (customEvent.detail?.libraryId === libraryId) {
        try {
          // Force refresh by directly querying the database
          // Use a small delay to ensure database transaction is committed
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Query directly from database to bypass any caching
          const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
          setAssetRows(rows);
        } catch (e: any) {
          console.error('Failed to refresh assets:', e);
        }
      }
    };

    window.addEventListener('assetCreated', handleAssetChange);
    window.addEventListener('assetUpdated', handleAssetChange);
    window.addEventListener('assetDeleted', handleAssetChange);

    return () => {
      window.removeEventListener('assetCreated', handleAssetChange);
      window.removeEventListener('assetUpdated', handleAssetChange);
      window.removeEventListener('assetDeleted', handleAssetChange);
    };
  }, [libraryId, supabase]);

  // Listen to database changes for real-time sync across users
  useEffect(() => {
    if (!libraryId || !isAuthenticated) return;

    console.log(`[Library Page] Setting up database subscription for library: ${libraryId}`);

    // Subscribe to changes in library_assets table
    const assetsChannel = supabase
      .channel(`library-assets:${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'library_assets',
          filter: `library_id=eq.${libraryId}`,
        },
        async (payload) => {
          console.log('[Library Page] Asset change detected:', payload);
          
          // Refresh asset rows
          try {
            const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
            setAssetRows(rows);
          } catch (e: any) {
            console.error('Failed to refresh assets after DB change:', e);
          }
        }
      )
      .subscribe();

    // Also subscribe to changes in library_asset_values table for property updates
    const valuesChannel = supabase
      .channel(`library-asset-values:${libraryId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'library_asset_values',
        },
        async (payload) => {
          console.log('[Library Page] Asset value change detected:', payload);
          
          // Check if this change is for an asset in this library
          // Refresh asset rows to get latest data
          try {
            const rows = await getLibraryAssetsWithProperties(supabase, libraryId);
            setAssetRows(rows);
          } catch (e: any) {
            console.error('Failed to refresh assets after value change:', e);
          }
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      console.log(`[Library Page] Cleaning up database subscription for library: ${libraryId}`);
      supabase.removeChannel(assetsChannel);
      supabase.removeChannel(valuesChannel);
    };
  }, [libraryId, supabase, isAuthenticated]);

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
  const handleSaveAssetFromTable = async (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => {
    await createAsset(supabase, libraryId, assetName, propertyValues, options);
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
    // Notify other components (including other browser tabs/users) to refresh
    window.dispatchEvent(new CustomEvent('assetUpdated', { detail: { assetId, libraryId } }));
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
      {/* Library Header with members and share functionality */}
      {userProfile && (
        <LibraryHeader
          libraryId={libraryId}
          libraryName={library.name}
          libraryDescription={library.description}
          projectId={projectId}
          currentUserId={userProfile.id}
          currentUserName={userProfile.full_name || userProfile.username || 'You'}
          currentUserEmail={userProfile.email || ''}
          currentUserAvatarColor={userAvatarColor}
          userRole={userRole}
          presenceUsers={presenceUsers}
        />
      )}

      {/* Phase 2: Library assets table preview (placeholder data).
          Later phases will replace placeholder service logic with real Supabase-backed data
          and upgrade the table to a two-level header that mirrors predefine + Figma. */}
      <YjsProvider libraryId={libraryId}>
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
          currentUser={
            userProfile
              ? {
                  id: userProfile.id,
                  name: userProfile.full_name || userProfile.username || 'Anonymous',
                  email: userProfile.email,
                  avatarColor: userAvatarColor,
                }
              : null
          }
          enableRealtime={isAuthenticated}
          presenceTracking={{
            updateActiveCell,
            getUsersEditingCell,
          }}
        />
      </YjsProvider>

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

      {!authLoading && !isAuthenticated && <div className={styles.authWarning}>Please sign in to edit.</div>}

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

