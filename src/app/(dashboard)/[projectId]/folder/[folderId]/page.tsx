'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { getFolder, Folder } from '@/lib/services/folderService';
import { listLibraries, Library, getLibrariesAssetCounts } from '@/lib/services/libraryService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { LibraryCard } from '@/components/folders/LibraryCard';
import { LibraryListView } from '@/components/folders/LibraryListView';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { NewLibraryModal } from '@/components/libraries/NewLibraryModal';
import { EditLibraryModal } from '@/components/libraries/EditLibraryModal';
import { ContextMenuAction } from '@/components/layout/ContextMenu';
import { deleteLibrary } from '@/lib/services/libraryService';
import libraryEmptyIcon from '@/app/assets/images/libraryEmptyIcon.svg';
import plusHorizontal from '@/app/assets/images/plusHorizontal.svg';
import plusVertical from '@/app/assets/images/plusVertical.svg';
import Image from 'next/image';
import styles from './FolderPage.module.css';

export default function FolderPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useSupabase();
  const projectId = params.projectId as string;
  const folderId = params.folderId as string;
  
  const [folder, setFolder] = useState<Folder | null>(null);
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('grid');
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showEditLibraryModal, setShowEditLibraryModal] = useState(false);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [assetCounts, setAssetCounts] = useState<Record<string, number>>({});
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);

  const fetchData = useCallback(async () => {
    if (!projectId || !folderId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const [folderData, librariesData] = await Promise.all([
        getFolder(supabase, folderId),
        listLibraries(supabase, projectId, folderId),
      ]);
      
      if (!folderData) {
        setError('Folder not found');
        return;
      }
      
      setFolder(folderData);
      setLibraries(librariesData);
    } catch (e: any) {
      setError(e?.message || 'Failed to load folder');
    } finally {
      setLoading(false);
    }
  }, [projectId, folderId, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch user role in current project
  useEffect(() => {
    const fetchUserRole = async () => {
      if (!projectId) {
        setUserRole(null);
        return;
      }
      
      try {
        const role = await getUserProjectRole(supabase, projectId);
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

  // Listen for library creation/deletion events and folder updates to refresh the list
  useEffect(() => {
    const handleLibraryCreated = (event: CustomEvent) => {
      const createdFolderId = event.detail?.folderId;
      // Only refresh if the library was created in the current folder
      if (createdFolderId === folderId) {
        fetchData();
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      const deletedFolderId = event.detail?.folderId;
      // Only refresh if the library was deleted from the current folder
      if (deletedFolderId === folderId) {
        fetchData();
      }
    };

    const handleLibraryUpdated = (event: CustomEvent) => {
      // Refresh data when any library is updated
      // We need to check if the updated library belongs to the current folder
      // Since we don't have folderId in the event detail, we'll refresh all libraries
      // The fetchData will only fetch libraries for the current folder
      fetchData();
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      const updatedFolderId = event.detail?.folderId;
      // Refresh if the current folder was updated
      if (updatedFolderId === folderId) {
        fetchData();
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    
    return () => {
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    };
  }, [folderId, fetchData]);

  const handleLibraryClick = (libraryId: string) => {
    router.push(`/${projectId}/${libraryId}`);
  };

  const handleLibrarySettingsClick = (libraryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/${projectId}/${libraryId}/predefine`);
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
        if (window.confirm('Delete this library?')) {
          try {
            await deleteLibrary(supabase, libraryId);
            fetchData(); // Refresh data
            
            // Dispatch event to notify Sidebar
            window.dispatchEvent(new CustomEvent('libraryDeleted', {
              detail: { folderId, libraryId, projectId }
            }));
            
            // If viewing this library, navigate back to folder
            if (pathname.includes(libraryId)) {
              router.push(`/${projectId}/folder/${folderId}`);
            }
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
    fetchData();
    // Dispatch event to notify Sidebar
    window.dispatchEvent(new CustomEvent('libraryCreated', {
      detail: { folderId, libraryId }
    }));
  };

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
      <LibraryToolbar
        mode="folder"
        title={folder?.name}
        onCreateLibrary={handleCreateLibrary}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        userRole={userRole}
      />
      {libraries.length === 0 ? (
        <div className={styles.emptyStateWrapper}>
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyIcon}>
              <Image
                src={libraryEmptyIcon}
                alt="Library icon"
                width={72}
                height={72}
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
              onSettingsClick={handleLibrarySettingsClick}
              onAction={handleLibraryAction}
            />
          ))}
        </div>
      ) : (
        <LibraryListView
          libraries={libraries.map(lib => ({
            ...lib,
            assetCount: assetCounts[lib.id] || 0
          }))}
          projectId={projectId}
          userRole={userRole}
          onLibraryClick={handleLibraryClick}
          onSettingsClick={handleLibrarySettingsClick}
          onLibraryAction={handleLibraryAction}
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
            fetchData(); // Refresh data
            // Dispatch event to notify Sidebar
            window.dispatchEvent(new CustomEvent('libraryUpdated', {
              detail: { libraryId: editingLibraryId, projectId }
            }));
          }}
        />
      )}
    </div>
  );
}

