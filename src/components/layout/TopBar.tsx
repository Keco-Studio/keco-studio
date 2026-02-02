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
    isPredefinePage,
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

  const renderRightContent = () => {
    if (isPredefine) {
      return (
        <>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefineCancelOrDelete}
          >
            <span className={styles.topbarPillIcon}>
              <Image src={topbarPredefinePublishIcon} alt="Cancel or Delete" width={16} height={16} className="icon-16" />
            </span>
            <span>{isPredefineCreatingNewSection ? 'Cancel' : 'Delete Section'}</span>
          </button>
          <button
            className={styles.topbarPillButton}
            onClick={handlePredefinePublish}
          >
            <span className={styles.topbarPillIcon}>
              <Image src={topbarPredefinePublishIcon} alt="Publish" width={16} height={16} className="icon-16" />
            </span>
            <span>Publish</span>
          </button>
        </>
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
            {displayBreadcrumbs.map((item, index) => (
              <span key={index}>
                <button
                  className={`${styles.breadcrumbItem} ${
                    index === displayBreadcrumbs.length - 1
                      ? styles.breadcrumbItemActive
                      : styles.breadcrumbItemClickable
                  }`}
                  onClick={() => handleBreadcrumbClick(item.path, index)}
                  disabled={index === displayBreadcrumbs.length - 1}
                >
                  {item.label}
                </button>
                {index < displayBreadcrumbs.length - 1 && (
                  <span className={styles.breadcrumbSeparator}> / </span>
                )}
              </span>
            ))}
          </div>
        )}
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


