'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { showSuccessToast, showInfoToast } from '@/lib/utils/toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getProject, Project } from '@/lib/services/projectService';
import { getLibrary, Library } from '@/lib/services/libraryService';
import { LibraryAssetsTableAdapter } from '@/components/libraries/LibraryAssetsTableAdapter';
import { LibraryHeader } from '@/components/libraries/LibraryHeader';
import {
  AssetRow,
  LibrarySummary,
  PropertyConfig,
} from '@/lib/types/libraryAssets';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
  getLibrarySummary,
  updateAsset,
  deleteAsset,
  deleteAssets,
  addLibraryField,
  ensureDefaultLibraryField,
} from '@/lib/services/libraryAssetsService';
import type { AddColumnFormPayload } from '@/components/libraries/components/AddColumnModal';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useLibraryData } from '@/lib/contexts/LibraryDataContext';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import type { PresenceState, CollaboratorRole } from '@/lib/types/collaboration';
import { VersionControlSidebar } from '@/components/version-control/VersionControlSidebar';
import { getVersionsByLibrary } from '@/lib/services/versionService';
import type { LibraryVersion } from '@/lib/types/version';
import { RowStoreProvider } from '@/lib/contexts/RowStoreContext';
import {
  invalidateLibraryAssetsData,
  invalidateLibraryData,
  invalidateLibrarySchemaData,
} from '@/lib/queryInvalidation';
import styles from './page.module.css';
import addColumIcon from "@/assets/images/addColumIcon.svg";
import { getStudioLibraryRedirectPath } from '@/lib/studioLibraryIsolation';
import { useProjectRoleQuery } from '@/lib/hooks/useProjectRoleQuery';

export default function LibraryPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const projectId = params.projectId as string;
  const libraryId = params.libraryId as string;
  
  const { userProfile, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: projectRole } = useProjectRoleQuery(projectId, userProfile?.id);
  const userRole: CollaboratorRole = projectRole?.role ?? 'viewer';
  const [isVersionControlOpen, setIsVersionControlOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [versions, setVersions] = useState<LibraryVersion[]>([]);
  const [highlightedVersionId, setHighlightedVersionId] = useState<string | null>(null);
  const hasInitializedBlankRowsRef = useRef(false);

  // Sync version-control open state to TopBar LibraryHeader.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('library-version-control-state', {
        detail: {
          projectId,
          libraryId,
          isOpen: isVersionControlOpen,
        },
      })
    );
  }, [isVersionControlOpen, projectId, libraryId]);

  // Respond to version-control toggle requests from TopBar.
  useEffect(() => {
    const handleToggleFromTopbar = (event: Event) => {
      const custom = event as CustomEvent<{
        projectId?: string;
        libraryId?: string;
        open?: boolean;
      }>;
      if (custom.detail?.projectId !== projectId || custom.detail?.libraryId !== libraryId) return;
      if (typeof custom.detail?.open === 'boolean') {
        setIsVersionControlOpen(custom.detail.open);
        return;
      }
      setIsVersionControlOpen((prev) => !prev);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-version-control-toggle', handleToggleFromTopbar as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-version-control-toggle', handleToggleFromTopbar as EventListener);
      }
    };
  }, [projectId, libraryId]);

  // Open version history when navigated here from sidebar "Version history".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem('keco-open-library-version-control');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { projectId?: string; libraryId?: string };
      if (parsed.projectId !== projectId || parsed.libraryId !== libraryId) return;
      window.sessionStorage.removeItem('keco-open-library-version-control');
      setIsVersionControlOpen(true);
    } catch {
      window.sessionStorage.removeItem('keco-open-library-version-control');
    }
  }, [projectId, libraryId]);

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
  const studioRedirectPath = getStudioLibraryRedirectPath(projectId, library);

  useEffect(() => {
    if (studioRedirectPath) router.replace(studioRedirectPath);
  }, [router, studioRedirectPath]);

  const { data: librarySummary, isLoading: summaryLoading } = useQuery({
    queryKey: queryKeys.librarySummary(libraryId),
    queryFn: () => getLibrarySummary(supabase, libraryId),
    enabled: !!libraryId,
  });

  const { data: librarySchema, isLoading: schemaLoading } = useQuery({
    queryKey: queryKeys.librarySchema(libraryId),
    queryFn: () => getLibrarySchema(supabase, libraryId),
    enabled: !!libraryId,
    refetchOnMount: 'always',
  });

  // LibraryDataContext is now the single source of truth for current assets
  // Only use React Query for version history
  const { data: currentAssetRows = [], isLoading: assetsLoading } = useQuery({
    queryKey: queryKeys.libraryAssets(libraryId),
    queryFn: () => getLibraryAssetsWithProperties(supabase, libraryId),
    enabled: false, // ← DISABLED: LibraryDataContext handles current assets
  });

  // State to hold version-specific asset rows (only for version history viewing)
  const [versionAssetRows, setVersionAssetRows] = useState<AssetRow[] | null>(null);
  const assetRows = versionAssetRows !== null ? versionAssetRows : [];

  const tableProperties = librarySchema?.properties || [];
  // Note: Asset loading is handled by LibraryDataContext (no need for assetsLoading here)
  const loading = projectLoading || libraryLoading || summaryLoading || schemaLoading;
  const error = projectError ? (projectError as any)?.message || 'Project not found' :
                libraryError ? (libraryError as any)?.message || 'Library not found' : null;

  // Get presence and asset operations from LibraryDataContext (single source of truth)
  const {
    presenceUsers,
    createAsset: contextCreateAsset,
    refreshAssetsFromServer,
    applySnapshot,
    invalidateFormulaFieldMeta,
  } = useLibraryData();

  // Broadcast presence to TopBar so it can render LibraryHeader in the global top row
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!projectId || !libraryId) return;

    window.dispatchEvent(
      new CustomEvent('library-presence-update', {
        detail: {
          projectId,
          libraryId,
          presenceUsers,
        },
      }),
    );
  }, [projectId, libraryId, presenceUsers]);

  useEffect(() => {
    if (!libraryId) return;
    if (selectedVersionId && selectedVersionId !== '__current__') return;
    if (hasInitializedBlankRowsRef.current) return;
    if (userRole === 'viewer') return;
    if (schemaLoading) return;

    const initDefaultData = async () => {
      try {
        //If there are already assets in the Treasury, nothing will be done
        const { count, error } = await supabase
          .from('library_assets')
          .select('id', { count: 'exact', head: true })
          .eq('library_id', libraryId);

        if (error) {
          console.error('Failed to check existing assets before initializing default data', error);
          return;
        }
        if ((count ?? 0) > 0) {
          hasInitializedBlankRowsRef.current = true;
          return;
        }

        const props = librarySchema?.properties ?? [];

        if (!librarySchema || props.length === 0) {
          // 2) no schema and no assets: create the default ID field
          const { fieldId, created } = await ensureDefaultLibraryField(supabase, libraryId);

          // Update the table with the latest schema (including the ID field)
          await invalidateLibrarySchemaData(queryClient, { libraryId, refetchActiveSchema: true });
          invalidateFormulaFieldMeta();

          if (!created) {
            hasInitializedBlankRowsRef.current = true;
            return;
          }

          // Business requirement:
          // When a brand new library is created (no schema & no assets),
          // initialize the main table with 3 completely blank input rows
          // instead of 2 pre-filled rows like "00001" / "00002".
          const now = Date.now();
          await contextCreateAsset('', { [fieldId]: '' }, { createdAt: new Date(now) });
          await contextCreateAsset('', { [fieldId]: '' }, { createdAt: new Date(now + 1) });
          await contextCreateAsset('', { [fieldId]: '' }, { createdAt: new Date(now + 2) });

          await invalidateLibraryAssetsData(queryClient, { libraryId, refetchActiveAssets: true });
        } else {
          // 3) already has schema but no assets: don't create 3 empty rows, avoid extra empty rows in the table
        }

        hasInitializedBlankRowsRef.current = true;
      } catch (e) {
        console.error('Failed to initialize default library data', e);
        hasInitializedBlankRowsRef.current = false;
      }
    };

    void initDefaultData();
  }, [
    contextCreateAsset,
    libraryId,
    librarySchema,
    schemaLoading,
    queryClient,
    invalidateFormulaFieldMeta,
    selectedVersionId,
    supabase,
    userRole,
  ]);

  // Presence tracking for real-time collaboration
  const userAvatarColor = useMemo(() => {
    return userProfile?.id ? getUserAvatarColor(userProfile.id) : '#999999';
  }, [userProfile?.id]);

  const handleAddProperty = useCallback(
    async (payload: AddColumnFormPayload) => {
      await addLibraryField(supabase, libraryId, {
        label: payload.name,
        dataType: payload.dataType as PropertyConfig['dataType'],
        description: payload.description,
        required: false,
        enumOptions:
          payload.dataType === 'enum'
            ? (payload.enumOptions ?? [])
            : undefined,
        referenceLibraries:
          payload.dataType === 'reference'
            ? (payload.referenceLibraries ?? [])
            : undefined,
        formulaExpression:
          payload.dataType === 'formula'
            ? payload.formulaExpression
            : undefined,
      });
      await invalidateLibrarySchemaData(queryClient, { libraryId, refetchActiveSchema: true });
      invalidateFormulaFieldMeta();
      showSuccessToast('Column added');
    },
    [supabase, libraryId, queryClient, invalidateFormulaFieldMeta]
  );

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

  // Real-time updates are now handled by LibraryDataContext (via useRealtimeSubscription)
  // No need for separate postgres_changes subscription here

  // Callback for saving new asset from table (uses context so table updates immediately)
  const handleSaveAssetFromTable = async (assetName: string, propertyValues: Record<string, any>, options?: { createdAt?: Date }) => {
    const assetId = await contextCreateAsset(assetName, propertyValues, options);
    await invalidateLibraryAssetsData(queryClient, { libraryId, assetId, refetchActiveAssets: true });
  };

  const handleUpdateAssetFromTable = async (assetId: string, assetName: string, propertyValues: Record<string, any>) => {
    await updateAsset(supabase, assetId, assetName, propertyValues);
    await invalidateLibraryAssetsData(queryClient, { libraryId, assetId, refetchActiveAssets: true });
  };

  const handleUpdateAssetsFromTable = async (
    updates: Array<{ assetId: string; assetName: string; propertyValues: Record<string, any> }>
  ) => {
    await Promise.all(updates.map((u) => updateAsset(supabase, u.assetId, u.assetName, u.propertyValues)));
    await invalidateLibraryAssetsData(queryClient, { libraryId, refetchActiveAssets: true });
  };

  // Single delete
  const handleDeleteAssetFromTable = async (assetId: string) => {
    await deleteAsset(supabase, assetId);
    await invalidateLibraryAssetsData(queryClient, { libraryId, assetId, refetchActiveAssets: true });
  };

  // Batch delete: Supabase .delete().in(), one round-trip
  const handleDeleteAssetsFromTable = async (assetIds: string[]) => {
    await deleteAssets(supabase, assetIds);
    await invalidateLibraryAssetsData(queryClient, { libraryId, refetchActiveAssets: true });
  };

  if (loading || studioRedirectPath) {
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
      {/* Main content area: Table and Version Control Sidebar side by side */}
      <div className={styles.mainContent} data-library-main-content>
        {/* Phase 2: Library assets table preview (placeholder data).
            Later phases will replace placeholder service logic with real Supabase-backed data
            and upgrade the table to a two-level header that mirrors predefine + Figma. */}
        <div className={styles.tableContainer}>
          <RowStoreProvider libraryId={libraryId}>
            <LibraryAssetsTableAdapter
              key={library.id}
              library={
                librarySummary
                  ? {
                      id: librarySummary.id,
                      name: librarySummary.name,
                      description: librarySummary.description,
                      documentExportType: library.document_export_type,
                      sourceDocumentId: library.source_document_id,
                    }
                  : {
                      id: library.id,
                      name: library.name,
                      description: library.description,
                      documentExportType: library.document_export_type,
                      sourceDocumentId: library.source_document_id,
                    }
              }
              properties={tableProperties}
              overrideRows={versionAssetRows}
              onAddProperty={handleAddProperty}
            />
          </RowStoreProvider>
        </div>

        {/* Asset detail portal target — same flex level as version history */}
        <div id="library-asset-detail-slot" className={styles.assetDetailSlot} />

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
            onRestoreSuccess={async (restoredVersionId: string, snapshotData?: any) => {
              showSuccessToast('Library restored');
              try {
                const loadedVersions = await getVersionsByLibrary(supabase, libraryId);
                setVersions(loadedVersions);
                if (snapshotData) {
                  applySnapshot(snapshotData);
                } else {
                  await refreshAssetsFromServer();
                }
                await invalidateLibraryData(queryClient, { projectId, libraryId });
                await invalidateLibraryAssetsData(queryClient, { libraryId, refetchActiveAssets: true });
                
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

      {!authLoading && !isAuthenticated && <div className={styles.authWarning}>Please sign in to edit.</div>}
    </div>
  );
}
