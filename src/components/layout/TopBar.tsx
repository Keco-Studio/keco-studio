'use client';

import { useRouter } from 'next/navigation';
import { useNavigation } from '@/lib/contexts/NavigationContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSupabase } from '@/lib/SupabaseContext';
import Image from 'next/image';
import { useRef, useState, useEffect, useMemo } from 'react';
import { Avatar } from 'antd';
import { getUserAvatarColor } from '@/lib/utils/avatarColors';
import styles from './TopBar.module.css';
import homeMorehorizontalIcon from '@/assets/images/homeMorehorizontalIcon.svg';
import homeQuestionIcon from '@/assets/images/homeQuestionIcon.svg';
import homeMessageIcon from '@/assets/images/loginMessageIcon.svg';
import homeDefaultUserIcon from '@/assets/images/homeDefaultUserIcon.svg';
import topbarPredefinePublishIcon from '@/assets/images/topbarPredefinePublishIcon.svg';
import assetViewIcon from '@/assets/images/assetViewIcon.svg';
import assetEditIcon from '@/assets/images/assetEditIcon.svg';
import assetShareIcon from '@/assets/images/assetShareIcon.svg';
import topBarBreadCrumbIcon from '@/assets/images/topBarBreadCrumbIcon.svg';
import menuIcon from '@/assets/images/menuIcon36.svg';
import { LibraryToolbar } from '@/components/folders/LibraryToolbar';
import { LibraryHeader } from '@/components/libraries/LibraryHeader';
import type { PresenceState, CollaboratorRole } from '@/lib/types/collaboration';
import searchIcon from "@/assets/images/searchIcon.svg";

type TopBarProps = {
  breadcrumb?: string[];
  showCreateProjectBreadcrumb?: boolean;
};

type AssetMode = 'view' | 'edit';

export function TopBar({ breadcrumb = [], showCreateProjectBreadcrumb: propShowCreateProjectBreadcrumb }: TopBarProps) {
  const router = useRouter();
  const {
    breadcrumbs,
    currentAssetId,
    currentProjectId,
    currentLibraryId,
    currentFolderId,
    isPredefinePage,
    isLibraryPage,
    showCreateProjectBreadcrumb: contextShowCreateProjectBreadcrumb,
  } = useNavigation();
  const showCreateProjectBreadcrumb = propShowCreateProjectBreadcrumb ?? contextShowCreateProjectBreadcrumb;
  const { userProfile, signOut } = useAuth();
  const supabase = useSupabase();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [assetMode, setAssetMode] = useState<AssetMode>('edit');
  const [isCreatingNewAsset, setIsCreatingNewAsset] = useState(false);
  const [isPredefineCreatingNewSection, setIsPredefineCreatingNewSection] = useState(false);
  const [predefineActiveSectionId, setPredefineActiveSectionId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'admin' | 'editor' | 'viewer' | null>(null);
  const [libraryViewMode, setLibraryViewMode] = useState<'list' | 'grid'>('grid');
  const [libraryVersionControlOpen, setLibraryVersionControlOpen] = useState(false);

  // Resolve display name: prefer username, then full_name, then email
  const displayName =
    userProfile?.username || userProfile?.full_name || userProfile?.email || 'Guest';
  const avatarInitial = displayName.charAt(0).toUpperCase();

  // Get user avatar color (consistent color based on user ID)
  const userAvatarColor = useMemo(() => {
    return userProfile?.id ? getUserAvatarColor(userProfile.id) : '#999999';
  }, [userProfile?.id]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Reset asset mode when navigating to a different asset
  useEffect(() => {
    setAssetMode('edit');
    setIsCreatingNewAsset(false);
  }, [currentAssetId]);

  // Fetch user role for current project
  useEffect(() => {
    const fetchUserRole = async () => {
      const projectId = currentProjectId;
      const isValidUUID = projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

      if (!isValidUUID || !userProfile) {
        setUserRole(null);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setUserRole(null);
          return;
        }

        const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
          },
        });

        if (roleResponse.ok) {
          const roleResult = await roleResponse.json();
          setUserRole(roleResult.role ?? null);
        } else {
          setUserRole(null);
        }
      } catch (error) {
        console.error('[TopBar] Error fetching user role:', error);
        setUserRole(null);
      }
    };

    fetchUserRole();
  }, [currentProjectId, userProfile, supabase]);

  // Real-time collaboration: Subscribe to collaborators table for permission updates
  useEffect(() => {
    const projectId = currentProjectId;
    const isValidUUID = projectId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);

    if (!isValidUUID || !userProfile) {
      console.log('[TopBar] Skipping collaborators subscription - missing projectId or userProfile');
      return;
    }

    console.log('[TopBar] Setting up collaborators subscription for project:', projectId);
    
    // Subscribe to project_collaborators table for real-time permission updates
    const collaboratorsChannel = supabase
      .channel(`topbar-collaborators:project:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'project_collaborators',
          filter: `project_id=eq.${projectId}`,
        },
        async (payload) => {
          console.log('[TopBar] ✅ Collaborators change detected:', payload);
          console.log('[TopBar] Event type:', payload.eventType);
          console.log('[TopBar] Affected user (new):', payload.new);
          console.log('[TopBar] Affected user (old):', payload.old);
          console.log('[TopBar] Current user:', userProfile.id);
          
          // Handle DELETE event - user access was removed or project was deleted
          if (payload.eventType === 'DELETE' && payload.old && 'user_id' in payload.old) {
            if (payload.old.user_id === userProfile.id) {
              console.log('[TopBar] 🚨 Current user\'s collaborator record deleted');
              // User access removed or project deleted - role becomes null
              setUserRole(null);
            }
          }
          
          // Handle INSERT/UPDATE events - check if the change affects current user
          if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && 
              payload.new && 'user_id' in payload.new && payload.new.user_id === userProfile.id) {
            console.log('[TopBar] 🔄 Current user\'s permission changed, refetching role...');
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) return;
              
              const roleResponse = await fetch(`/api/projects/${projectId}/role`, {
                headers: {
                  'Authorization': `Bearer ${session.access_token}`,
                },
              });
              
              if (roleResponse.ok) {
                const roleResult = await roleResponse.json();
                console.log('[TopBar] ✅ Role updated to:', roleResult.role);
                setUserRole(roleResult.role || null);
              }
            } catch (error) {
              console.error('[TopBar] Error refetching user role:', error);
            }
          }
        }
      )
      .subscribe((status, err) => {
        console.log('[TopBar] Collaborators channel subscription status:', status);
        if (err) {
          console.error('[TopBar] Collaborators channel subscription error:', err);
        }
      });

    return () => {
      console.log('[TopBar] Cleaning up collaborators subscription');
      supabase.removeChannel(collaboratorsChannel);
    };
  }, [currentProjectId, userProfile, supabase]);

  // Listen to asset page mode updates (for create/view/edit detection)
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ mode?: string; isNewAsset?: boolean }>;
      if (custom.detail?.isNewAsset === true) {
        setIsCreatingNewAsset(true);
      } else {
        setIsCreatingNewAsset(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('asset-page-mode', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('asset-page-mode', handler as EventListener);
      }
    };
  }, []);

  // Listen to Predefine page state updates (e.g. creating new section)
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ isCreatingNewSection?: boolean; activeSectionId?: string | null }>;
      if (typeof custom.detail?.isCreatingNewSection === 'boolean') {
        setIsPredefineCreatingNewSection(custom.detail.isCreatingNewSection);
      }
      if (custom.detail?.activeSectionId !== undefined) {
        setPredefineActiveSectionId(custom.detail.activeSectionId);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('predefine-state', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('predefine-state', handler as EventListener);
      }
    };
  }, []);

  // Prefer breadcrumbs from NavigationContext; fall back to the prop-based list
  const displayBreadcrumbs =
    breadcrumbs.length > 0 ? breadcrumbs : breadcrumb.map((label) => ({ label, path: '' }));

  const handleBreadcrumbClick = (path: string, index: number) => {
    // Navigate to the breadcrumb path when it is not the last item
    if (path && index < displayBreadcrumbs.length - 1) {
      router.push(path);
    }
  };

  const handleLogout = async () => {
    setShowUserMenu(false);
    await signOut();
    // Navigate to /projects after logout
    router.push('/projects');
  };

  const isPredefine = isPredefinePage;
  const isAssetDetail = !!currentAssetId;
  const isLibraryTopLevelPage = isLibraryPage && !!currentLibraryId && !currentAssetId && !isPredefine;
  const isProjectRootPage =
    !!currentProjectId && !currentFolderId && !currentLibraryId && !currentAssetId && !isPredefine;
  const isFolderPage =
    !!currentProjectId && !!currentFolderId && !currentLibraryId && !currentAssetId && !isPredefine;

  // Sync view mode from page-level LibraryToolbar to TopBar
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        mode?: 'list' | 'grid';
        projectId?: string;
        folderId?: string | null;
      }>;

      const { mode, projectId, folderId } = custom.detail || {};
      if (!mode) return;
      if (!currentProjectId || projectId !== currentProjectId) return;

      const currentFolderOrNull = currentFolderId ?? null;
      const detailFolderOrNull = folderId ?? null;

      if (currentFolderOrNull !== detailFolderOrNull) return;

      setLibraryViewMode(mode);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-page-view-mode-change', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-page-view-mode-change', handler as EventListener);
      }
    };
  }, [currentProjectId, currentFolderId]);

  // Sync version control open state from LibraryPage to TopBar
  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        projectId?: string;
        libraryId?: string;
        isOpen?: boolean;
      }>;

      const { projectId, libraryId, isOpen } = custom.detail || {};
      if (projectId !== currentProjectId || libraryId !== currentLibraryId) return;
      if (typeof isOpen !== 'boolean') return;

      setLibraryVersionControlOpen(isOpen);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('library-version-control-state', handler as EventListener);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('library-version-control-state', handler as EventListener);
      }
    };
  }, [currentProjectId, currentLibraryId]);

  const handlePredefineCancelOrDelete = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('predefine-cancel-or-delete'));
    }
  };

  const handlePredefinePublish = () => {
    // Placeholder for future publish behavior
    // eslint-disable-next-line no-console
    console.log('Predefine publish clicked');
  };

  const changeAssetMode = (mode: AssetMode) => {
    setAssetMode(mode);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('asset-mode-change', {
          detail: { mode },
        })
      );
    }
  };

  const handleShareClick = () => {
    // Placeholder share behavior
    // eslint-disable-next-line no-console
    console.log('Share asset');
  };

  const handleSidebarToggle = () => {
    // Dispatch event to toggle sidebar
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('sidebar-toggle'));
    }
  };

  const handleCreateAsset = () => {
    // Trigger asset save from the asset page
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('asset-create-save'));
    }
  };

  const handleTopbarViewModeChange = (mode: 'list' | 'grid') => {
    setLibraryViewMode(mode);
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-view-mode-change', {
          detail: {
            mode,
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarCreateFolder = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-create-folder', {
          detail: {
            projectId: currentProjectId,
          },
        })
      );
    }
  };

  const handleTopbarCreateLibrary = () => {
    if (typeof window !== 'undefined' && currentProjectId) {
      window.dispatchEvent(
        new CustomEvent('library-toolbar-create-library', {
          detail: {
            projectId: currentProjectId,
            folderId: isFolderPage ? currentFolderId ?? null : null,
          },
        })
      );
    }
  };

  const handleTopbarVersionControlToggle = () => {
    if (typeof window !== 'undefined' && currentProjectId && currentLibraryId) {
      window.dispatchEvent(
        new CustomEvent('library-version-control-toggle', {
          detail: {
            projectId: currentProjectId,
            libraryId: currentLibraryId,
          },
        })
      );
    }
  };

  const renderRightContent = () => {
    if (isPredefine) {
      return (
        <>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefineCancelOrDelete}
          >
            <span className={styles.topbarPillIcon}>
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                <g clipPath="url(#clip0_1420_346)">
                  <path d="M8 8.6665L5.66666 10.9998M8 14.6665V8.6665V14.6665ZM8 8.6665L10.3333 10.9998L8 8.6665Z" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13.3333 11.7384C14.3291 11.3482 15.3333 10.4594 15.3333 8.66683C15.3333 6.00016 13.1111 5.3335 12 5.3335C12 4.00016 12 1.3335 8 1.3335C4 1.3335 4 4.00016 4 5.3335C2.88888 5.3335 0.666664 6.00016 0.666664 8.66683C0.666664 10.4594 1.67085 11.3482 2.66666 11.7384" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </g>
                <defs>
                  <clipPath id="clip0_1420_346">
                    <rect width="16" height="16" fill="white"/>
                  </clipPath>
                </defs>
              </svg>
            </span>
            <span>{isPredefineCreatingNewSection ? 'Cancel' : 'Delete Section'}</span>
          </button>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefinePublish}
          >
            <span className={styles.topbarPillIcon}>
              <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="icon-16">
                <g clipPath="url(#clip0_1420_347)">
                  <path d="M8 8.6665L5.66666 10.9998M8 14.6665V8.6665V14.6665ZM8 8.6665L10.3333 10.9998L8 8.6665Z" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M13.3333 11.7384C14.3291 11.3482 15.3333 10.4594 15.3333 8.66683C15.3333 6.00016 13.1111 5.3335 12 5.3335C12 4.00016 12 1.3335 8 1.3335C4 1.3335 4 4.00016 4 5.3335C2.88888 5.3335 0.666664 6.00016 0.666664 8.66683C0.666664 10.4594 1.67085 11.3482 2.66666 11.7384" stroke="#0B99FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </g>
                <defs>
                  <clipPath id="clip0_1420_347">
                    <rect width="16" height="16" fill="white"/>
                  </clipPath>
                </defs>
              </svg>
            </span>
            <span>Publish</span>
          </button>
        </>
      );
    }

    if (isLibraryTopLevelPage && currentLibraryId && currentProjectId && userProfile) {
      const lastBreadcrumb = displayBreadcrumbs[displayBreadcrumbs.length - 1];
      const libraryName = lastBreadcrumb?.label || 'Library';

      const presenceUsers: PresenceState[] = [
        {
          userId: userProfile.id,
          userName: displayName,
          userEmail: userProfile.email || '',
          avatarColor: userAvatarColor,
          activeCell: null,
          cursorPosition: null,
          lastActivity: new Date().toISOString(),
          connectionStatus: 'online',
        },
      ];

      return (
        <LibraryHeader
          libraryId={currentLibraryId}
          libraryName={libraryName}
          libraryDescription={null}
          projectId={currentProjectId}
          currentUserId={userProfile.id}
          currentUserName={displayName}
          currentUserEmail={userProfile.email || ''}
          currentUserAvatarColor={userAvatarColor}
          userRole={(userRole || 'viewer') as CollaboratorRole}
          presenceUsers={presenceUsers}
          isVersionControlOpen={libraryVersionControlOpen}
          onVersionControlToggle={handleTopbarVersionControlToggle}
        />
      );
    }

    if ((isProjectRootPage || isFolderPage) && currentProjectId) {
      const lastBreadcrumb = displayBreadcrumbs[displayBreadcrumbs.length - 1];
      const title = lastBreadcrumb?.label;

      return (
        <LibraryToolbar
          mode={isFolderPage ? 'folder' : 'project'}
          title={title}
          onCreateFolder={isProjectRootPage ? handleTopbarCreateFolder : undefined}
          onCreateLibrary={handleTopbarCreateLibrary}
          viewMode={libraryViewMode}
          onViewModeChange={handleTopbarViewModeChange}
          userRole={userRole as CollaboratorRole | null}
          projectId={currentProjectId}
        />
      );
    }

    if (isAssetDetail) {
      if (isCreatingNewAsset) {
        // Create mode - show Create Asset button
        return (
          <>
            <button
              className={`${styles.topbarPillButton} ${styles.topbarPillPrimary}`}
              onClick={handleCreateAsset}
            >
              <span className={styles.topbarPillIcon}>
                <Image src={topbarPredefinePublishIcon} alt="Create" width={16} height={16} className="icon-16" />
              </span>
              <span>Create Asset</span>
            </button>
            <button className={`${styles.button} ${styles.buttonText}`}>
              <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} className="icon-20" />
            </button>
            <button className={styles.button}>
              <Image src={homeQuestionIcon} alt="Question" width={20} height={20} className="icon-20" />
            </button>
            <button className={styles.button}>
              <Image src={homeMessageIcon} alt="Message" width={20} height={20} className="icon-20" />
            </button>
          </>
        );
      } else {
  
      }
    }

    // Default icon group
    return (
      <>
        <button className={`${styles.button} ${styles.buttonText}`}>
          <Image src={homeMorehorizontalIcon} alt="More" width={20} height={20} className="icon-20" />
        </button>
        <button className={styles.button}>
          <Image src={homeQuestionIcon} alt="Question" width={20} height={20} className="icon-20" />
        </button>
        <button className={styles.button}>
          <Image src={homeMessageIcon} alt="Message" width={20} height={20} className="icon-20" />
        </button>
      </>
    );
  };

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        {showCreateProjectBreadcrumb ? (
          <div className={styles.createProjectBreadcrumb}>
            <Image src={menuIcon} alt="Menu" width={36} height={48} className={`icon-menu ${styles.menuIcon}`} />
            <span className={styles.createProjectText}>Create Project</span>
          </div>
        ) : (
          <div className={styles.breadcrumb}>
            <Image src={topBarBreadCrumbIcon} 
              alt="Breadcrumb" 
              width={24} height={24} className="icon-24" 
              style={{ marginRight: '5px', cursor: 'pointer' }} 
              onClick={handleSidebarToggle}
            />
            {displayBreadcrumbs.map((item, index) => {
              const isLast = index === displayBreadcrumbs.length - 1;
              const label = isLast && isAssetDetail ? 'asset' : item.label;

              return (
                <span key={index}>
                  <button
                    className={`${styles.breadcrumbItem} ${
                      isLast ? styles.breadcrumbItemActive : styles.breadcrumbItemClickable
                    }`}
                    onClick={() => handleBreadcrumbClick(item.path, index)}
                    disabled={isLast}
                  >
                    {label}
                  </button>
                  {index < displayBreadcrumbs.length - 1 && (
                    <span className={styles.breadcrumbSeparator}> / </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
      <div className={styles.searchContainer}>
        <label className={styles.searchLabel}>
          <Image
            src={searchIcon}
            alt="Search"
            width={24}
            height={24}
            className={`icon-24 ${styles.searchIcon}`}
          />
          <input
            placeholder="Search for..."
            className={styles.searchInput}
          />
        </label>
      </div>

      <div className={styles.right}>
        {renderRightContent()}
        <div className={styles.userContainer} ref={menuRef}>
          <button
            className={styles.userAvatar}
            onClick={() => setShowUserMenu(!showUserMenu)}
            aria-label="User menu"
            data-testid="user-menu"
            type="button"
          >
            {userProfile ? (
              <Avatar
                size={30}
                style={{
                  backgroundColor: userAvatarColor,
                  borderRadius: '16px',
                  cursor: 'pointer',
                  fontSize: '21px',
                  fontWeight: 600,
                }}
              >
                {avatarInitial}
              </Avatar>
            ) : (
              /* Fallback avatar icon for guests */
              <Image src={homeDefaultUserIcon} alt="User" width={20} height={20} className="icon-20" />
            )}
          </button>
          {showUserMenu && (
            <div className={styles.userMenu}>
              <button
                type="button"
                className={styles.userMenuItem}
                onClick={handleLogout}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


