'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { Modal } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { queryKeys } from '@/lib/utils/queryKeys';
import { getFolder, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { listDocuments, type DocumentSummary } from '@/lib/services/documentService';
import { filterStudioLibraries } from '@/lib/studioLibraryIsolation';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { DocumentRecentCard } from '@/components/admin/DocumentRecentCard';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
import { EditLibraryModal } from '@/components/libraries/EditLibraryModal';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import { invalidateFolderData, invalidateLibraryData } from '@/lib/queryInvalidation';
import libraryEmptyIcon from '@/assets/images/projectEmptyIcon_2.png';
import plusHorizontal from '@/assets/images/plusHorizontal.svg';
import plusVertical from '@/assets/images/plusVertical.svg';
import Image from 'next/image';
import styles from './FolderPage.module.css';

export default function FolderPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const confirmDeletion = useCallback((content: string) => {
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: 'Confirm deletion',
        content,
        okText: 'Delete',
        cancelText: 'Cancel',
        zIndex: 11000,
        okButtonProps: { danger: true },
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, []);
  const projectId = params.projectId as string;
  const folderId = params.folderId as string;
  
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showEditLibraryModal, setShowEditLibraryModal] = useState(false);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({});
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);

  // Use React Query for data fetching
  const { data: folder, isLoading: folderLoading, error: folderError } = useQuery({
    queryKey: queryKeys.folder(folderId),
    queryFn: () => getFolder(supabase, folderId),
    enabled: !!folderId,
  });

  const { data: libraries = [], isLoading: librariesLoading } = useQuery({
    queryKey: queryKeys.folderLibraries(folderId),
    queryFn: async () => filterStudioLibraries(await listLibraries(supabase, projectId, folderId)),
    enabled: !!projectId && !!folderId,
  });

  const { data: documents = [], isLoading: documentsLoading } = useQuery<DocumentSummary[]>({
    queryKey: [...queryKeys.documents(projectId), 'folder', folderId],
    queryFn: async () => {
      const projectDocuments = await listDocuments(supabase, projectId);
      return projectDocuments.filter((document) => document.folder_id === folderId);
    },
    enabled: !!projectId && !!folderId,
  });

  const loading = folderLoading || librariesLoading || documentsLoading;
  const error = folderError ? (folderError as any)?.message || 'Failed to load folder' : null;

  // Fetch user role in current project
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!projectId) {
        setUserRole(null);
        return;
      }
      
      try {
        const { role } = await getUserProjectRole(supabase, projectId);
        setUserRole(role);
      } catch (error) {
        console.error('[FolderPage] Error fetching user role:', error);
        setUserRole(null);
      }
    };
    
    fetchUserRole();
  }, [projectId, supabase]);

  // Fetch asset counts when libraries change
  useEffect(() => {
    async function fetchAssetCounts() {
      if (libraries.length > 0) {
        const libraryIds = libraries.map(lib => lib.id);
        const counts = await getLibrariesAssetCounts(supabase, libraryIds);
        setAssetCounts(counts);
      }
    }
    fetchAssetCounts();
  }, [libraries, supabase]);

  const handleLibraryClick = (libraryId: string) => {
    router.push(`/${projectId}/${libraryId}`);
  };

  const handleDocumentClick = (documentId: string) => {
    router.push(`/${projectId}/doc/${documentId}`);
  };

  const handleLibraryMoreClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Feature not implemented yet
  };

  const handleExport = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Export library:', libraryId);
  };

  const handleVersionHistory = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Version history:', libraryId);
  };

  const handleCreateBranch = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Create branch:', libraryId);
  };

  const handleRename = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Rename:', libraryId);
  };

  const handleDuplicate = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Duplicate:', libraryId);
  };

  const handleMoveTo = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Move to:', libraryId);
  };

  const handleDelete = (libraryId: string) => {
    // Feature not implemented yet
    console.log('Delete:', libraryId);
  };

  const handleLibraryAction = async (libraryId: string, action: ContextMenuAction) => {
    switch (action) {
      case 'rename':
        setEditingLibraryId(libraryId);
        setShowEditLibraryModal(true);
        break;
      case 'delete':
        if (await confirmDeletion('Delete this library?')) {
          try {
            await deleteLibrary(supabase, libraryId);
            if (pathname.includes(libraryId)) {
              router.push(`/${projectId}/folder/${folderId}`);
            }
            void invalidateLibraryData(queryClient, {
              projectId,
              folderId,
              libraryId,
              refetchActiveFoldersLibraries: true,
            }).catch((err) => {
              console.error('Failed to refresh after library delete', err);
            });
          } catch (err: any) {
            console.error('Failed to delete library:', err);
            alert(err?.message || 'Failed to delete library');
          }
        }
        break;
      default:
        console.log('Library action not implemented:', action);
    }
  };

  const handleCreateLibrary = () => {
    setShowLibraryModal(true);
  };

  const handleLibraryCreated = (libraryId: string) => {
    setShowLibraryModal(false);
    void invalidateLibraryData(queryClient, {
      projectId,
      folderId,
      libraryId,
      refetchActiveFoldersLibraries: true,
    });
  };

  // Sync the page LibraryToolbar view mode to TopBar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('library-page-view-mode-change', {
        detail: {
          mode: viewMode,
          projectId,
          folderId,
        },
      })
    );
  }, [viewMode, projectId, folderId]);

  // Let the TopBar LibraryToolbar control view switching on this page.
  // Create/import actions are handled by Sidebar (same flows as Libraries "+").
  useEffect(() => {
    const handleTopbarViewModeChange = (event: Event) => {
      const custom = event as CustomEvent<{
        mode?: 'list' | 'grid';
        projectId?: string;
        folderId?: string | null;
      }>;
      const { mode, projectId: evtProjectId, folderId: evtFolderId } = custom.detail || {};
      if (!mode) return;
      if (evtProjectId !== projectId) return;
      if (evtFolderId !== folderId) return;
      setViewMode(mode);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-toolbar-view-mode-change', handleTopbarViewModeChange as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-toolbar-view-mode-change', handleTopbarViewModeChange as EventListener);
      }
    };
  }, [projectId, folderId, setViewMode]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading folder...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!folder) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>Folder not found</div>
      </div>
    );
  }

  // Only admin can create folders and libraries
  const canCreate = userRole === 'admin';


  return (
    <div className={styles.container}>
      {/* <LibraryToolbar
        mode="folder"
        title={folder?.name}
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        userRole={userRole}
        projectId={projectId}
      /> */}
      {libraries.length === 0 && documents.length === 0 ? (
        <div className={styles.emptyStateWrapper}>
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyIcon}>
              <Image
                src={libraryEmptyIcon}
                alt="Library icon"
                width={237}
                height={219}
              />
            </div>
            <div className={styles.emptyText}>
              There is no any library here. you need to create a library firstly
            </div>
            {canCreate && (
              <button
                className={styles.createLibraryButton}
                onClick={handleCreateLibrary}
              >
                <span className={styles.plusIcon}>
                  <Image
                    src={plusHorizontal}
                    alt=""
                    width={17}
                    height={2}
                    className={styles.plusHorizontal}
                  />
                  <Image
                    src={plusVertical}
                    alt=""
                    width={2}
                    height={17}
                    className={styles.plusVertical}
                  />
                </span>
                <span className={styles.buttonText}>Create Library</span>
              </button>
            )}
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className={styles.grid}>
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              projectId={projectId}
              assetCount={assetCounts[library.id] || 0}
              userRole={userRole}
              onClick={handleLibraryClick}
              onAction={handleLibraryAction}
            />
          ))}
          {documents.map((document) => (
            <DocumentRecentCard
              key={document.id}
              documentId={document.id}
              name={document.name}
              description={document.description}
              onClick={() => handleDocumentClick(document.id)}
            />
          ))}
        </div>
      ) : (
        <LibraryListView
          libraries={libraries.map(lib => ({
            ...lib,
            assetCount: assetCounts[lib.id] || 0
          }))}
          documents={documents}
          projectId={projectId}
          userRole={userRole}
          onLibraryClick={handleLibraryClick}
          onLibraryAction={handleLibraryAction}
          onDocumentClick={handleDocumentClick}
        />
      )}
      <NewLibraryModal
        open={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        projectId={projectId}
        folderId={folderId}
        onCreated={handleLibraryCreated}
      />
      {editingLibraryId && (
        <EditLibraryModal
          open={showEditLibraryModal}
          libraryId={editingLibraryId}
          onClose={() => {
            setShowEditLibraryModal(false);
            setEditingLibraryId(null);
          }}
          onUpdated={() => {
            void invalidateLibraryData(queryClient, {
              projectId,
              folderId,
              libraryId: editingLibraryId,
              refetchActiveFoldersLibraries: true,
            });
          }}
        />
      )}
    </div>
  );
}
