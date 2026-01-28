'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Tooltip, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
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
  deleteAssets,
} from '@/lib/services/libraryAssetsService';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePresenceTracking } from '@/lib/hooks/usePresenceTracking';
import { PresenceIndicators } from '@/components/collaboration/PresenceIndicators';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import type { PresenceState, CollaboratorRole } from '@/lib/types/collaboration';
import { YjsProvider } from '@/contexts/YjsContext';
import { VersionControlSidebar } from '@/components/version-control/VersionControlSidebar';
import { getVersionsByLibrary } from '@/lib/services/versionService';
import type { LibraryVersion } from '@/lib/types/version';
import { createPortal } from 'react-dom';
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
  const queryClient = useQueryClient();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [assetName, setAssetName] = useState('');
  const [values, setValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [fieldValidationErrors, setFieldValidationErrors] = useState<Record<string, string>>({});
  const [userRole, setUserRole] = useState<CollaboratorRole>('viewer');
  const [isVersionControlOpen, setIsVersionControlOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [restoreToastMessage, setRestoreToastMessage] = useState<string | null>(null);
  const [versions, setVersions] = useState<LibraryVersion[]>([]);
  const [highlightedVersionId, setHighlightedVersionId] = useState<string | null>(null);
  const hasInitializedBlankRowsRef = useRef(false);

  // Use React Query for data fetching
  const { data: project, isLoading: projectLoading, error: projectError } = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => getProject(supabase, projectId),
    enabled: !!projectId,
  });

  const { data: library, isLoading: libraryLoading, error: libraryError } = useQuery({
    queryKey: queryKeys.library(libraryId),
    queryFn: () => getLibrary(supabase, libraryId, projectId),
    enabled: !!libraryId && !!projectId,
  });

  const { data: librarySummary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.librarySummary(libraryId),
    queryFn: () => getLibrarySummary(supabase, libraryId),
    enabled: !!libraryId,
  });

  const { data: librarySchema, isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.librarySchema(libraryId),
    queryFn: () => getLibrarySchema(supabase, libraryId),
    enabled: !!libraryId,
  });

  const { data: currentAssetRows = [], isLoading: assetsLoading } = useQuery({
    queryKey: queryKeys.libraryAssets(libraryId),
    queryFn: () => getLibraryAssetsWithProperties(supabase, libraryId),
    enabled: !!libraryId && (!selectedVersionId || selectedVersionId === '__current__'),
  });

  // State to hold version-specific asset rows (overrides currentAssetRows when viewing history)
  const [versionAssetRows, setVersionAssetRows] = useState<AssetRow[] | null>(null);
  const assetRows = versionAssetRows !== null ? versionAssetRows : currentAssetRows;

  const tableSections = librarySchema?.sections || [];
  const tableProperties = librarySchema?.properties || [];
  const loading = projectLoading || libraryLoading || summaryLoading || schemaLoading || assetsLoading;
  const error = projectError ? (projectError as any)?.message || 'Project not found' :
                libraryError ? (libraryError as any)?.message || 'Library not found' : null;

  // 当库已经有 schema 但还没有任何资产时，自动创建 3 行空白数据
  useEffect(() => {
    // 只处理当前版本视图，并且避免重复初始化
    if (!libraryId) return;
    if (selectedVersionId && selectedVersionId !== '__current__') return;
    if (assetsLoading) return;
    if (assetRows.length > 0) return;
    if (hasInitializedBlankRowsRef.current) return;
    // 没有字段定义时不需要创建空行
    if (!librarySchema || !tableProperties || tableProperties.length === 0) return;
    // 仅管理员 / 编辑者可以创建
    if (userRole === 'viewer') return;

    const initBlankRows = async () => {
      try {
        hasInitializedBlankRowsRef.current = true;
        const now = Date.now();

        // 创建三条空资产记录，name 为空字符串，propertyValues 为空对象
        for (let i = 0; i < 3; i++) {
          await createAsset(
            supabase,
            libraryId,
            '',
            {},
            { createdAt: new Date(now + i) }
          );
        }

        // 触发现有资产监听逻辑进行缓存失效和刷新
        window.dispatchEvent(new CustomEvent('assetCreated', { detail: { libraryId } }));
      } catch (e) {
        // 初始化失败时允许之后再次尝试
        console.error('Failed to initialize blank asset rows', e);
        hasInitializedBlankRowsRef.current = false;
      }
    };

    void initBlankRows();
  }, [
    assetRows.length,
    assetsLoading,
    createAsset,
    libraryId,
    librarySchema,
    selectedVersionId,
    supabase,
    tableProperties,
    userRole,
  ]);

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
    userName: userProfile?.username || userProfile?.full_name || userProfile?.email || 'Anonymous',
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

  // Load field definitions (for legacy form)
  useEffect(() => {
    if (libraryId) {
      fetchDefinitions();
    }
  }, [libraryId, fetchDefinitions]);

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

  // Optimized: Listen for library updates and use targeted cache invalidation
  useEffect(() => {
    const handleLibraryUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      // Only invalidate if the event is for this library
      if (customEvent.detail?.libraryId === libraryId) {
        // Targeted cache invalidation - only refetch what changed
        queryClient.invalidateQueries({ queryKey: queryKeys.library(libraryId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      }
    };

    window.addEventListener('libraryUpdated', handleLibraryUpdated as EventListener);

    return () => {
      window.removeEventListener('libraryUpdated', handleLibraryUpdated as EventListener);
    };
  }, [libraryId, queryClient]);

  // Optimized: Listen for asset changes and use targeted cache invalidation
  useEffect(() => {
    const handleAssetChange = (event: Event) => {
      // Don't refresh if viewing a historical version
      if (selectedVersionId && selectedVersionId !== '__current__') {
        return;
      }
      
      const customEvent = event as CustomEvent<{ libraryId: string; assetId?: string }>;
      // Only invalidate if the event is for this library
      if (customEvent.detail?.libraryId === libraryId) {
        // Targeted cache invalidation - React Query will handle the refetch
        queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      }
    };

    const handleSchemaChange = (event: Event) => {
      // Don't refresh if viewing a historical version
      if (selectedVersionId && selectedVersionId !== '__current__') {
        return;
      }
      
      const customEvent = event as CustomEvent<{ libraryId: string }>;
      // Only invalidate if the event is for this library
      if (customEvent.detail?.libraryId === libraryId) {
        // Schema changed - need to refresh schema, assets, and summary
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(libraryId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(libraryId) });
      }
    };

    window.addEventListener('assetCreated', handleAssetChange as EventListener);
    window.addEventListener('assetUpdated', handleAssetChange as EventListener);
    window.addEventListener('assetDeleted', handleAssetChange as EventListener);
    window.addEventListener('schemaUpdated', handleSchemaChange as EventListener);

    return () => {
      window.removeEventListener('assetCreated', handleAssetChange as EventListener);
      window.removeEventListener('assetUpdated', handleAssetChange as EventListener);
      window.removeEventListener('assetDeleted', handleAssetChange as EventListener);
      window.removeEventListener('schemaUpdated', handleSchemaChange as EventListener);
    };
  }, [libraryId, selectedVersionId, queryClient]);

  // Load versions when version control is opened
  useEffect(() => {
    if (!isVersionControlOpen || !libraryId) return;

    const loadVersions = async () => {
      try {
        const loadedVersions = await getVersionsByLibrary(supabase, libraryId);
        setVersions(loadedVersions);
      } catch (e: any) {
        console.error('Failed to load versions:', e);
      }
    };

    loadVersions();
  }, [isVersionControlOpen, libraryId, supabase]);

  // Handle version selection - load data from snapshot or use current React Query data
  useEffect(() => {
    if (!libraryId) return;

    const loadVersionData = async () => {
      try {
        // If no version selected or current version selected, use React Query data
        if (!selectedVersionId || selectedVersionId === '__current__') {
          setVersionAssetRows(null); // Clear version-specific data to use current data
          return;
        }

        // If versions haven't been loaded yet, wait for them
        if (versions.length === 0) {
          try {
            const loadedVersions = await getVersionsByLibrary(supabase, libraryId);
            setVersions(loadedVersions);
            const selectedVersion = loadedVersions.find(v => v.id === selectedVersionId);
            if (!selectedVersion || !selectedVersion.snapshotData) {
              console.warn('Selected version not found or has no snapshot data');
              setVersionAssetRows(null);
              return;
            }

            // Extract assets from snapshot data
            const snapshotAssets = selectedVersion.snapshotData?.assets;
            if (snapshotAssets && Array.isArray(snapshotAssets)) {
              setVersionAssetRows(snapshotAssets);
            } else {
              console.warn('Snapshot data does not contain valid assets array');
              setVersionAssetRows(null);
            }
          } catch (loadError) {
            console.error('Failed to load versions:', loadError);
            setVersionAssetRows(null);
          }
          return;
        }

        // Find the selected version
        const selectedVersion = versions.find(v => v.id === selectedVersionId);
        if (!selectedVersion || !selectedVersion.snapshotData) {
          console.warn('Selected version not found or has no snapshot data');
          setVersionAssetRows(null);
          return;
        }

        // Extract assets from snapshot data
        const snapshotAssets = selectedVersion.snapshotData?.assets;
        if (snapshotAssets && Array.isArray(snapshotAssets)) {
          setVersionAssetRows(snapshotAssets);
        } else {
          console.warn('Snapshot data does not contain valid assets array');
          setVersionAssetRows(null);
        }
      } catch (e: any) {
        console.error('Failed to load version data:', e);
        setVersionAssetRows(null);
      }
    };

    loadVersionData();
  }, [selectedVersionId, versions, libraryId, supabase]);

  // Listen to database changes for real-time sync across users
  useEffect(() => {
    if (!libraryId || !isAuthenticated) return;

    // Skip real-time updates if viewing a historical version
    if (selectedVersionId && selectedVersionId !== '__current__') {
      return;
    }

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
        (payload) => {
          console.log('[Library Page] Asset change detected:', payload);
          // Use cache invalidation instead of manual refetch
          queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
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
        (payload) => {
          console.log('[Library Page] Asset value change detected:', payload);
          // Use cache invalidation instead of manual refetch
          queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(libraryId) });
        }
      )
      .subscribe();

    // Cleanup on unmount
    return () => {
      console.log(`[Library Page] Cleaning up database subscription for library: ${libraryId}`);
      supabase.removeChannel(assetsChannel);
      supabase.removeChannel(valuesChannel);
    };
  }, [libraryId, supabase, isAuthenticated, selectedVersionId, queryClient]);

  const handleValueChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleCreateAsset = async () => {
    setSaveError(null);
    setSaveSuccess(null);
    setFieldValidationErrors({});
    
    if (!assetName.trim()) {
      setSaveError('Asset name is required');
      return;
    }
    
    // Validate field types before saving
    const validationErrors: Record<string, string> = {};
    fieldDefs.forEach((f) => {
      const raw = values[f.id];
      if (raw === '' || raw === undefined || raw === null) {
        return; // Empty values are allowed
      }
      
      if (f.data_type === 'int') {
        // Int type: must be a valid integer (no decimal point)
        const trimmed = String(raw).trim();
        if (trimmed.includes('.')) {
          validationErrors[f.id] = 'type mismatch';
        } else {
          const intValue = parseInt(trimmed, 10);
          if (isNaN(intValue) || String(intValue) !== trimmed.replace(/^-/, '')) {
            validationErrors[f.id] = 'type mismatch';
          }
        }
      } else if (f.data_type === 'float') {
        // Float type: must contain a decimal point (cannot be pure integer)
        const trimmed = String(raw).trim();
        if (!trimmed.includes('.')) {
          validationErrors[f.id] = 'type mismatch';
        } else {
          const floatValue = parseFloat(trimmed);
          if (isNaN(floatValue)) {
            validationErrors[f.id] = 'type mismatch';
          }
        }
      }
    });
    
    if (Object.keys(validationErrors).length > 0) {
      setFieldValidationErrors(validationErrors);
      setSaveError('请修正类型错误后再保存');
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
    // Notify components to refresh - event handler will invalidate cache
    window.dispatchEvent(new CustomEvent('assetCreated', { detail: { libraryId } }));
  };

  // Single update (each completion dispatches → N invalidates)
  const handleUpdateAssetFromTable = async (assetId: string, assetName: string, propertyValues: Record<string, any>) => {
    await updateAsset(supabase, assetId, assetName, propertyValues);
    window.dispatchEvent(new CustomEvent('assetUpdated', { detail: { assetId, libraryId } }));
  };

  // Batch update: all updates then one dispatch → one invalidate, avoids 先消失后恢复再消失 + 其他列恢复
  const handleUpdateAssetsFromTable = async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    await Promise.all(updates.map((u) => updateAsset(supabase, u.assetId, u.assetName, u.propertyValues)));
    window.dispatchEvent(new CustomEvent('assetUpdated', { detail: { libraryId } }));
  };

  // Single delete
  const handleDeleteAssetFromTable = async (assetId: string) => {
    await deleteAsset(supabase, assetId);
    window.dispatchEvent(new CustomEvent('assetDeleted', { detail: { libraryId } }));
  };

  // Batch delete: Supabase .delete().in(), one round-trip
  const handleDeleteAssetsFromTable = async (assetIds: string[]) => {
    await deleteAssets(supabase, assetIds);
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
          currentUserName={userProfile.username || userProfile.full_name || userProfile.email || 'You'}
          currentUserEmail={userProfile.email || ''}
          currentUserAvatarColor={userAvatarColor}
          userRole={userRole}
          presenceUsers={presenceUsers}
          isVersionControlOpen={isVersionControlOpen}
          onVersionControlToggle={() => setIsVersionControlOpen(!isVersionControlOpen)}
        />
      )}

      {/* Main content area: Table and Version Control Sidebar side by side */}
      <div className={styles.mainContent}>
        {/* Phase 2: Library assets table preview (placeholder data).
            Later phases will replace placeholder service logic with real Supabase-backed data
            and upgrade the table to a two-level header that mirrors predefine + Figma. */}
        <div className={styles.tableContainer}>
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
              onUpdateAssets={handleUpdateAssetsFromTable}
              onDeleteAsset={handleDeleteAssetFromTable}
              onDeleteAssets={handleDeleteAssetsFromTable}
              currentUser={
                userProfile
                  ? {
                      id: userProfile.id,
                      name: userProfile.username || userProfile.full_name || userProfile.email || 'Anonymous',
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
        </div>

        {/* Version Control Sidebar */}
        {isVersionControlOpen && (
          <VersionControlSidebar
            libraryId={libraryId}
            isOpen={isVersionControlOpen}
            onClose={() => {
              setIsVersionControlOpen(false);
              // Clear selection to use current React Query data
              setSelectedVersionId(null);
              setVersionAssetRows(null);
            }}
            selectedVersionId={selectedVersionId}
            highlightedVersionId={highlightedVersionId}
            onVersionSelect={async (versionId) => {
              setSelectedVersionId(versionId);
              // Reload versions to ensure we have the latest snapshot data
              if (versionId && versionId !== '__current__') {
                try {
                  const loadedVersions = await getVersionsByLibrary(supabase, libraryId);
                  setVersions(loadedVersions);
                } catch (e: any) {
                  console.error('Failed to reload versions:', e);
                }
              }
            }}
            onRestoreSuccess={async (restoredVersionId: string) => {
              setRestoreToastMessage('Library restored');
              setTimeout(() => {
                setRestoreToastMessage(null);
              }, 2000);
              
              // Reload versions and invalidate cache to refetch latest data
              try {
                const loadedVersions = await getVersionsByLibrary(supabase, libraryId);
                setVersions(loadedVersions);
                
                // Notify components to refresh - event handler will invalidate cache
                window.dispatchEvent(new CustomEvent('assetUpdated', { detail: { libraryId } }));
                
                // Highlight the restored version for 1.5 seconds
                setHighlightedVersionId(restoredVersionId);
                
                // After highlight animation, clear version selection to show current data
                setTimeout(() => {
                  setHighlightedVersionId(null);
                  setSelectedVersionId(null);
                  setVersionAssetRows(null);
                }, 1500); // 1.5 seconds for highlight animation
              } catch (e: any) {
                console.error('Failed to reload data after restore:', e);
              }
            }}
          />
        )}
      </div>

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

      {/* Restore Toast Message */}
      {restoreToastMessage && typeof document !== 'undefined' && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10000,
            backgroundColor: '#111827',
            color: '#ffffff',
            padding: '12px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
            fontSize: '14px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {restoreToastMessage}
        </div>,
        document.body
      )}

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
                    const step = f.data_type === 'int' ? '1' : f.data_type === 'float' ? 'any' : undefined;
                    return (
                      <label key={f.id} className={styles.fieldLabel}>
                        <span>{label}</span>
                        <div style={{ position: 'relative', width: '100%' }}>
                          <input
                            type={inputType}
                            step={step}
                            value={value ?? ''}
                            onChange={(e) => {
                            let inputValue = e.target.value;
                            
                            // Validate int type: only allow integers
                            if (f.data_type === 'int' && inputValue !== '') {
                              // Check if contains decimal point - show error immediately
                              if (inputValue.includes('.')) {
                                setFieldValidationErrors(prev => ({
                                  ...prev,
                                  [f.id]: 'type mismatch'
                                }));
                                // Remove decimal point and everything after it
                                inputValue = inputValue.split('.')[0];
                              } else {
                                // Clear error if no decimal point
                                setFieldValidationErrors(prev => {
                                  const newErrors = { ...prev };
                                  delete newErrors[f.id];
                                  return newErrors;
                                });
                              }
                              
                              // Remove any non-digit characters except minus sign at the start
                              const cleaned = inputValue.replace(/[^\d-]/g, '');
                              const intValue = cleaned.startsWith('-') 
                                ? '-' + cleaned.slice(1).replace(/-/g, '')
                                : cleaned.replace(/-/g, '');
                              
                              // Only update if valid integer format
                              if (!/^-?\d*$/.test(intValue)) {
                                return; // Don't update if invalid
                              }
                              inputValue = intValue;
                            }
                            // Validate float type: must contain decimal point
                            else if (f.data_type === 'float' && inputValue !== '') {
                              // Clear error initially
                              setFieldValidationErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[f.id];
                                return newErrors;
                              });
                              
                              // Remove invalid characters but keep valid float format
                              const cleaned = inputValue.replace(/[^\d.-]/g, '');
                              const floatValue = cleaned.startsWith('-') 
                                ? '-' + cleaned.slice(1).replace(/-/g, '')
                                : cleaned.replace(/-/g, '');
                              // Ensure only one decimal point
                              const parts = floatValue.split('.');
                              const finalValue = parts.length > 2 
                                ? parts[0] + '.' + parts.slice(1).join('')
                                : floatValue;
                              
                              if (!/^-?\d*\.?\d*$/.test(finalValue)) {
                                return; // Don't update if invalid
                              }
                              inputValue = finalValue;
                            } else {
                              // Clear error for other types
                              setFieldValidationErrors(prev => {
                                const newErrors = { ...prev };
                                delete newErrors[f.id];
                                return newErrors;
                              });
                            }
                            
                            handleValueChange(f.id, inputValue);
                          }}
                          onBlur={() => {
                            // Validate on blur for float type: check if integer was entered
                            if (f.data_type === 'float' && values[f.id] !== '' && values[f.id] !== undefined && values[f.id] !== null) {
                              const trimmed = String(values[f.id]).trim();
                              if (!trimmed.includes('.')) {
                                setFieldValidationErrors(prev => ({
                                  ...prev,
                                  [f.id]: 'type mismatch'
                                }));
                                // Clear the invalid value
                                handleValueChange(f.id, '');
                              }
                            }
                          }}
                          className={styles.fieldInput}
                          placeholder={f.label}
                        />
                        {fieldValidationErrors[f.id] && (
                          <Tooltip 
                            title={fieldValidationErrors[f.id]}
                            open={true}
                            placement="bottom"
                            overlayStyle={{ fontSize: '12px' }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                top: '4px',
                                right: '4px',
                                width: '8px',
                                height: '8px',
                                backgroundColor: '#ff4d4f',
                                borderRadius: '50%',
                                zIndex: 1001,
                                pointerEvents: 'none'
                              }}
                            />
                          </Tooltip>
                        )}
                        </div>
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

