'use client';

import { createContext, useContext, ReactNode, useEffect, useMemo, useState, useRef } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from './AuthContext';
import { parseRouteParams } from '@/lib/utils/routeParams';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  verifyProjectAccess,
  verifyLibraryAccess,
  verifyFolderAccess,
  verifyAssetAccess,
  AuthorizationError,
} from '@/lib/services/authorizationService';
import { writeSimulationProjectPreference } from '@/lib/simulation/projectPreference';

type BreadcrumbItem = {
  label: string;
  path: string;
};

type NavigationContextType = {
  breadcrumbs: BreadcrumbItem[];
  currentProjectId: string | null;
  currentProjectName: string | null;
  currentLibraryId: string | null;
  currentLibraryName: string | null;
  currentAssetId: string | null;
  currentDocumentId: string | null;
  currentFolderId: string | null;
  currentFolderName: string | null;
  isPredefinePage: boolean;
  isLibraryPage: boolean;
  showCreateProjectBreadcrumb: boolean;
  setShowCreateProjectBreadcrumb: (show: boolean) => void;
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const { isAuthenticated, userProfile } = useAuth();
  const userId = userProfile?.id;
  const [projectName, setProjectName] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [libraryFolderId, setLibraryFolderId] = useState<string | null>(null);
  const [showCreateProjectBreadcrumb, setShowCreateProjectBreadcrumb] = useState(false);
  
  // Track current user ID to detect user switches
  const currentUserIdRef = useRef<string | null>(null);
  // Track if this is the initial fetch to avoid redirects during initial load
  const isInitialFetchRef = useRef<boolean>(true);

  const routeParams = useMemo(
    () =>
      parseRouteParams(pathname, params as Record<string, string | string[] | undefined>),
    [pathname, params]
  );

  const currentProjectId = routeParams.projectId;
  const currentLibraryId = routeParams.libraryId;
  const currentAssetId = routeParams.assetId;
  const currentDocumentId = routeParams.documentId;
  const currentFolderIdFromUrl = routeParams.folderId;

  // Current folder: from URL (routeParams) or from library's folder_id
  const currentFolderId = useMemo(() => {
    return currentFolderIdFromUrl || libraryFolderId;
  }, [currentFolderIdFromUrl, libraryFolderId]);

  useEffect(() => {
    if (!currentProjectId || !projectName?.trim()) return;
    writeSimulationProjectPreference({
      projectId: currentProjectId,
      projectName: projectName.trim(),
    });
  }, [currentProjectId, projectName]);

  // Detect user switch and redirect if needed
  useEffect(() => {
    console.log('[NavigationContext] User check:', {
      isAuthenticated,
      hasUserProfile: !!userId,
      userProfileId: userId,
      previousUserId: currentUserIdRef.current,
      currentProjectId,
    });
    
    if (!isAuthenticated || !userId) {
      currentUserIdRef.current = null;
      return;
    }

    const newUserId = userId;
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
      setDocumentName(null);
      setFolderName(null);
      setLibraryFolderId(null);
      isInitialFetchRef.current = true; // Reset for new user
      
      // If we're on a resource page (not /projects), redirect
      if (currentProjectId || currentLibraryId || currentAssetId) {
        router.push('/projects');
      }
    }

    currentUserIdRef.current = newUserId;
  }, [isAuthenticated, userId, currentProjectId, currentLibraryId, currentAssetId, router]);

  useEffect(() => {
    let mounted = true;
    const fetchNames = async () => {
      // Don't fetch if user is not authenticated or userProfile is not loaded
      // Wait for userProfile to be available to ensure authentication state is fully established
      if (!isAuthenticated || !userId) {
        if (mounted) {
          setProjectName(null);
          setLibraryName(null);
          setAssetName(null);
          setDocumentName(null);
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
            
            const data = await queryClient.fetchQuery({
              queryKey: queryKeys.project(currentProjectId),
              queryFn: async () => {
              const { data, error } = await supabase
                .from('projects')
                .select('name')
                .eq('id', currentProjectId)
                .single();
              
              if (error || !data) {
                return null;
              }
              return data;
              },
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
              setDocumentName(null);
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
            
            const data = await queryClient.fetchQuery({
              queryKey: queryKeys.library(currentLibraryId),
              queryFn: async () => {
              const { data, error } = await supabase
                .from('libraries')
                .select('name, folder_id')
                .eq('id', currentLibraryId)
                .single();
              
              if (error || !data) {
                return null;
              }
              return data;
              },
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
              setDocumentName(null);
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
              const data = await queryClient.fetchQuery({
                queryKey: queryKeys.folder(currentFolderId),
                queryFn: async () => {
                  const { data, error } = await supabase
                    .from('folders')
                    .select('name')
                    .eq('id', currentFolderId)
                    .single();
                  if (error || !data) return null;
                  return data;
                },
              });
              
              if (mounted) {
                if (!data) {
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
              const data = await queryClient.fetchQuery({
                queryKey: queryKeys.asset(currentAssetId),
                queryFn: async () => {
                  const { data, error } = await supabase
                    .from('library_assets')
                    .select('name')
                    .eq('id', currentAssetId)
                    .single();
                  if (error || !data) return null;
                  return data;
                },
              });
              
              if (mounted) {
                if (!data) {
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

        // Resolve current document name
        if (currentDocumentId) {
          try {
            const data = await queryClient.fetchQuery({
              queryKey: queryKeys.document(currentDocumentId),
              queryFn: async () => {
                const { data, error } = await supabase
                  .from('documents')
                  .select('name')
                  .eq('id', currentDocumentId)
                  .single();
                if (error || !data) return null;
                return data;
              },
            });
            if (mounted) {
              setDocumentName(data?.name ?? null);
            }
          } catch {
            if (mounted) {
              setDocumentName(null);
            }
          }
        } else {
          setDocumentName(null);
        }
      } catch (error) {
        console.error('Error fetching navigation names:', error);
        if (mounted) {
          // On any unexpected error, clear all names
          setProjectName(null);
          setLibraryName(null);
          setAssetName(null);
          setDocumentName(null);
          setFolderName(null);
          setLibraryFolderId(null);
        }
      }
    };
    fetchNames();
    return () => {
      mounted = false;
    };
  }, [currentProjectId, currentLibraryId, currentAssetId, currentDocumentId, currentFolderId, supabase, isAuthenticated, userId, router, queryClient]);

  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const nextBreadcrumbs: BreadcrumbItem[] = [];

    if (pathname === '/mcp') {
      return [
        { label: 'Account', path: '/mcp' },
        { label: 'MCP', path: '/mcp' },
      ];
    }
    
    if (currentProjectId) {
      nextBreadcrumbs.push({
        label: projectName || 'Project',
        path: `/${currentProjectId}`,
      });
    }

    // Add folder to breadcrumbs if it exists
    if (currentFolderId && currentProjectId) {
      nextBreadcrumbs.push({
        label: folderName || 'Folder',
        path: `/${currentProjectId}/folder/${currentFolderId}`,
      });
    }

    if (currentLibraryId) {
      nextBreadcrumbs.push({
        label: libraryName || 'Library',
        path: `/${currentProjectId}/${currentLibraryId}`,
      });
    }

    if (currentAssetId) {
      nextBreadcrumbs.push({
        label: assetName || 'Asset',
        path: `/${currentProjectId}/${currentLibraryId}?asset=${currentAssetId}`,
      });
    }

    if (currentDocumentId) {
      nextBreadcrumbs.push({
        label: documentName || 'Document',
        path: `/${currentProjectId}/doc/${currentDocumentId}`,
      });
    }

    return nextBreadcrumbs;
  }, [
    assetName,
    documentName,
    currentAssetId,
    currentDocumentId,
    currentFolderId,
    currentLibraryId,
    currentProjectId,
    folderName,
    libraryName,
    projectName,
    pathname,
  ]);

  const value = useMemo<NavigationContextType>(() => ({
    breadcrumbs,
    currentProjectId,
    currentProjectName: projectName,
    currentLibraryId,
    currentLibraryName: libraryName,
    currentAssetId,
    currentDocumentId,
    currentFolderId,
    currentFolderName: folderName,
    isPredefinePage: routeParams.isPredefinePage,
    isLibraryPage: routeParams.isLibraryPage,
    showCreateProjectBreadcrumb,
    setShowCreateProjectBreadcrumb,
  }), [
    breadcrumbs,
    currentAssetId,
    currentDocumentId,
    currentFolderId,
    currentLibraryId,
    currentProjectId,
    folderName,
    libraryName,
    projectName,
    routeParams.isLibraryPage,
    routeParams.isPredefinePage,
    showCreateProjectBreadcrumb,
  ]);

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
