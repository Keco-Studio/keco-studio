'use client';

import { createContext, useContext, ReactNode, useEffect, useMemo, useState, useRef } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from './AuthContext';
import {
  verifyProjectAccess,
  verifyLibraryAccess,
  verifyFolderAccess,
  verifyAssetAccess,
  AuthorizationError,
} from '@/lib/services/authorizationService';

type BreadcrumbItem = {
  label: string;
  path: string;
};

type NavigationContextType = {
  breadcrumbs: BreadcrumbItem[];
  currentProjectId: string | null;
  currentLibraryId: string | null;
  currentAssetId: string | null;
  currentFolderId: string | null;
  showCreateProjectBreadcrumb: boolean;
  setShowCreateProjectBreadcrumb: (show: boolean) => void;
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useSupabase();
  const { isAuthenticated, userProfile } = useAuth();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [libraryFolderId, setLibraryFolderId] = useState<string | null>(null);
  const [showCreateProjectBreadcrumb, setShowCreateProjectBreadcrumb] = useState(false);
  
  // Track current user ID to detect user switches
  const currentUserIdRef = useRef<string | null>(null);
  // Track if this is the initial fetch to avoid redirects during initial load
  const isInitialFetchRef = useRef<boolean>(true);

  const currentProjectId = useMemo(() => (params.projectId as string) || null, [params.projectId]);
  const currentLibraryId = useMemo(() => (params.libraryId as string) || null, [params.libraryId]);
  const currentAssetId = useMemo(() => (params.assetId as string) || null, [params.assetId]);
  // Check if we're on a folder page
  const currentFolderIdFromUrl = useMemo(() => {
    // Check if URL path contains /folder/[folderId]
    const folderMatch = pathname.match(/\/([^\/]+)\/folder\/([^\/]+)/);
    return folderMatch ? folderMatch[2] : null;
  }, [pathname]);

  // Determine current folder ID: from URL or from library's folder_id
  const currentFolderId = useMemo(() => {
    return currentFolderIdFromUrl || libraryFolderId;
  }, [currentFolderIdFromUrl, libraryFolderId]);

  // Detect user switch and redirect if needed
  useEffect(() => {
    console.log('[NavigationContext] User check:', {
      isAuthenticated,
      hasUserProfile: !!userProfile,
      userProfileId: userProfile?.id,
      previousUserId: currentUserIdRef.current,
      currentProjectId,
    });
    
    if (!isAuthenticated || !userProfile) {
      currentUserIdRef.current = null;
      return;
    }

    const newUserId = userProfile.id;
    const previousUserId = currentUserIdRef.current;

    // If user switched and we're on a resource page, redirect to projects
    if (previousUserId !== null && previousUserId !== newUserId) {
      console.log('[NavigationContext] User switch detected!', {
        previousUserId,
        newUserId,
        currentProjectId,
        willRedirect: !!(currentProjectId || currentLibraryId || currentAssetId),
      });
      
      // User has switched - clear all names and reset initial fetch flag
      setProjectName(null);
      setLibraryName(null);
      setAssetName(null);
      setFolderName(null);
      setLibraryFolderId(null);
      isInitialFetchRef.current = true; // Reset for new user
      
      // If we're on a resource page (not /projects), redirect
      if (currentProjectId || currentLibraryId || currentAssetId) {
        router.push('/projects');
      }
    }

    currentUserIdRef.current = newUserId;
  }, [isAuthenticated, userProfile, currentProjectId, currentLibraryId, currentAssetId, router]);

  useEffect(() => {
    let mounted = true;
    const fetchNames = async () => {
      // Don't fetch if user is not authenticated or userProfile is not loaded
      // Wait for userProfile to be available to ensure authentication state is fully established
      if (!isAuthenticated || !userProfile) {
        if (mounted) {
          setProjectName(null);
          setLibraryName(null);
          setAssetName(null);
          setFolderName(null);
          setLibraryFolderId(null);
        }
        return;
      }

      // Removed unnecessary 500ms delay - cache will handle deduplication

      const isInitialFetch = isInitialFetchRef.current;
      if (isInitialFetch) {
        isInitialFetchRef.current = false;
      }

      try {
        // Resolve current project name with permission check
        if (currentProjectId) {
          try {
            // First verify user has access to this project (owner or collaborator)
            await verifyProjectAccess(supabase, currentProjectId);
            
            // Use cache to fetch project name and avoid duplicate requests
            const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
            const cacheKey = `project:name:${currentProjectId}`;
            
            const data = await globalRequestCache.fetch(cacheKey, async () => {
              const { data, error } = await supabase
                .from('projects')
                .select('name')
                .eq('id', currentProjectId)
                .single();
              
              if (error || !data) {
                return null;
              }
              return data;
            });
            
            if (mounted) {
              if (!data) {
                setProjectName(null);
                // Only redirect if this is not the initial fetch
                if (!isInitialFetch) {
                  router.push('/projects');
                }
              } else {
                setProjectName(data.name ?? null);
              }
            }
          } catch (authError: any) {
            if (authError instanceof AuthorizationError && mounted) {
              // User doesn't have access - clear state
              setProjectName(null);
              setLibraryName(null);
              setAssetName(null);
              setFolderName(null);
              setLibraryFolderId(null);
              // Only redirect if this is not the initial fetch
              if (!isInitialFetch) {
                router.push('/projects');
              }
              return;
            }
            // For other errors, just log and continue
            console.error('Error verifying project ownership:', authError);
            if (mounted) {
              setProjectName(null);
            }
          }
        } else {
          setProjectName(null);
        }

        // Resolve current library name and folder_id with permission check
        if (currentLibraryId) {
          try {
            // First verify user has access to this library
            await verifyLibraryAccess(supabase, currentLibraryId);
            
            // Use cache to fetch library info and avoid duplicate requests
            const { globalRequestCache } = await import('@/lib/hooks/useRequestCache');
            const cacheKey = `library:info:${currentLibraryId}`;
            
            const data = await globalRequestCache.fetch(cacheKey, async () => {
              const { data, error } = await supabase
                .from('libraries')
                .select('name, folder_id')
                .eq('id', currentLibraryId)
                .single();
              
              if (error || !data) {
                return null;
              }
              return data;
            });
            
            if (mounted) {
              if (!data) {
                setLibraryName(null);
                setLibraryFolderId(null);
                // Only redirect if this is not the initial fetch
                if (!isInitialFetch) {
                  if (currentProjectId) {
                    router.push(`/${currentProjectId}`);
                  } else {
                    router.push('/projects');
                  }
                }
              } else {
                setLibraryName(data.name ?? null);
                setLibraryFolderId(data.folder_id ?? null);
              }
            }
          } catch (authError: any) {
            if (authError instanceof AuthorizationError && mounted) {
              // User doesn't have access - clear state
              setLibraryName(null);
              setLibraryFolderId(null);
              setAssetName(null);
              // Only redirect if this is not the initial fetch
              if (!isInitialFetch) {
                if (currentProjectId) {
                  router.push(`/${currentProjectId}`);
                } else {
                  router.push('/projects');
                }
              }
              return;
            }
            // For other errors, just log and continue
            console.error('Error verifying library access:', authError);
            if (mounted) {
              setLibraryName(null);
              setLibraryFolderId(null);
            }
          }
        } else {
          setLibraryName(null);
          setLibraryFolderId(null);
        }

        // Resolve current folder name with permission check
        if (currentFolderId) {
          // Check if it's a valid UUID format
          const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(currentFolderId);
          if (isValidUuid) {
            try {
              // First verify user has access to this folder
              await verifyFolderAccess(supabase, currentFolderId);
              
              // If verified, fetch the name
              const { data, error } = await supabase
                .from('folders')
                .select('name')
                .eq('id', currentFolderId)
                .single();
              
              if (mounted) {
                if (error || !data) {
                  setFolderName(null);
                } else {
                  setFolderName(data.name ?? null);
                }
              }
            } catch (authError: any) {
              if (authError instanceof AuthorizationError && mounted) {
                // User doesn't have access - clear
                setFolderName(null);
              }
            }
          } else {
            // Invalid UUID format, skip query
            if (mounted) {
              setFolderName(null);
            }
          }
        } else {
          setFolderName(null);
        }

        // Resolve current asset name with permission check
        if (currentAssetId) {
          // Special handling for new asset creation
          if (currentAssetId === 'new') {
            if (mounted) {
              setAssetName('New Asset');
            }
          } else {
            try {
              // First verify user has access to this asset
              await verifyAssetAccess(supabase, currentAssetId);
              
              // If verified, fetch the name
              const { data, error } = await supabase
                .from('library_assets')
                .select('name')
                .eq('id', currentAssetId)
                .single();
              
              if (mounted) {
                if (error || !data) {
                  setAssetName(null);
                  // Only redirect if this is not the initial fetch
                  if (!isInitialFetch) {
                    if (currentLibraryId && currentProjectId) {
                      router.push(`/${currentProjectId}/${currentLibraryId}`);
                    } else if (currentProjectId) {
                      router.push(`/${currentProjectId}`);
                    } else {
                      router.push('/projects');
                    }
                  }
                } else {
                  setAssetName(data.name ?? null);
                }
              }
            } catch (authError: any) {
              if (authError instanceof AuthorizationError && mounted) {
                // User doesn't have access - clear state
                setAssetName(null);
                // Only redirect if this is not the initial fetch
                if (!isInitialFetch) {
                  if (currentLibraryId && currentProjectId) {
                    router.push(`/${currentProjectId}/${currentLibraryId}`);
                  } else if (currentProjectId) {
                    router.push(`/${currentProjectId}`);
                  } else {
                    router.push('/projects');
                  }
                }
              } else {
                // For other errors, just log and continue
                console.error('Error verifying asset access:', authError);
                if (mounted) {
                  setAssetName(null);
                }
              }
            }
          }
        } else {
          setAssetName(null);
        }
      } catch (error) {
        console.error('Error fetching navigation names:', error);
        if (mounted) {
          // On any unexpected error, clear all names
          setProjectName(null);
          setLibraryName(null);
          setAssetName(null);
          setFolderName(null);
          setLibraryFolderId(null);
        }
      }
    };
    fetchNames();
    return () => {
      mounted = false;
    };
  }, [currentProjectId, currentLibraryId, currentAssetId, currentFolderId, supabase, isAuthenticated, userProfile, router]);

  // Build breadcrumbs from current route params
  const buildBreadcrumbs = (): BreadcrumbItem[] => {
    const breadcrumbs: BreadcrumbItem[] = [];
    
    if (currentProjectId) {
      breadcrumbs.push({
        label: projectName || 'Project',
        path: `/${currentProjectId}`,
      });
    }

    // Add folder to breadcrumbs if it exists
    if (currentFolderId && currentProjectId) {
      breadcrumbs.push({
        label: folderName || 'Folder',
        path: `/${currentProjectId}/folder/${currentFolderId}`,
      });
    }

    if (currentLibraryId) {
      breadcrumbs.push({
        label: libraryName || 'Library',
        path: `/${currentProjectId}/${currentLibraryId}`,
      });
    }

    if (currentAssetId) {
      breadcrumbs.push({
        label: assetName || 'Asset',
        path: `/${currentProjectId}/${currentLibraryId}/${currentAssetId}`,
      });
    }

    return breadcrumbs;
  };

  const value: NavigationContextType = {
    breadcrumbs: buildBreadcrumbs(),
    currentProjectId,
    currentLibraryId,
    currentAssetId,
    currentFolderId,
    showCreateProjectBreadcrumb,
    setShowCreateProjectBreadcrumb,
  };

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

