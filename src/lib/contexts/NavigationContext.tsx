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
import { isScriptSystemPath } from '@/lib/script-system/isScriptSystemPath';
import { buildFolderBreadcrumbPath, type FolderBreadcrumb } from '@/lib/navigation/folderBreadcrumbs';

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
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([]);
  const [documentFolderId, setDocumentFolderId] = useState<string | null>(null);
  const [libraryFolderId, setLibraryFolderId] = useState<string | null>(null);
  const [scriptParentDocumentId, setScriptParentDocumentId] = useState<string | null>(null);
  const [scriptParentDocumentName, setScriptParentDocumentName] = useState<string | null>(null);
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

  // Current folder: from URL, library.folder_id, or document.folder_id.
  // Script workspace breadcrumbs follow the Script sidebar tree (project / doc /
  // script), not Studio folder paths — ignore library.folder_id there.
  const onScriptSystem = isScriptSystemPath(pathname);
  const currentFolderId = useMemo(() => {
    if (onScriptSystem) return currentFolderIdFromUrl;
    return currentFolderIdFromUrl || libraryFolderId || documentFolderId;
  }, [currentFolderIdFromUrl, documentFolderId, libraryFolderId, onScriptSystem]);

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
      setFolderPath([]);
      setDocumentFolderId(null);
      setLibraryFolderId(null);
      setScriptParentDocumentId(null);
      setScriptParentDocumentName(null);
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
          setFolderPath([]);
          setDocumentFolderId(null);
          setLibraryFolderId(null);
          setScriptParentDocumentId(null);
          setScriptParentDocumentName(null);
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
              setFolderPath([]);
              setDocumentFolderId(null);
              setLibraryFolderId(null);
              setScriptParentDocumentId(null);
              setScriptParentDocumentName(null);
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
            const onScript = isScriptSystemPath(pathname);
            
            const data = await queryClient.fetchQuery({
              // Keep breadcrumb lookups off queryKeys.library — that key stores full
              // Library rows (incl. document_export_type) used by Script/Studio pages.
              queryKey: ['library-breadcrumb', currentLibraryId] as const,
              queryFn: async () => {
              const { data, error } = await supabase
                .from('libraries')
                .select('name, folder_id, source_document_id')
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
                setScriptParentDocumentId(null);
                setScriptParentDocumentName(null);
                // Only redirect if this is not the initial fetch
                if (!isInitialFetch) {
                  if (currentProjectId) {
                    router.push(onScript ? `/script-system/${currentProjectId}` : `/${currentProjectId}`);
                  } else {
                    router.push('/projects');
                  }
                }
              } else {
                setLibraryName(data.name ?? null);
                setLibraryFolderId(onScript ? null : (data.folder_id ?? null));

                const parentDocId =
                  onScript && typeof data.source_document_id === 'string'
                    ? data.source_document_id
                    : null;
                setScriptParentDocumentId(parentDocId);
                if (parentDocId) {
                  const parentDoc = await queryClient.fetchQuery({
                    queryKey: ['document-name', parentDocId] as const,
                    queryFn: async () => {
                      const { data: doc, error } = await supabase
                        .from('documents')
                        .select('name')
                        .eq('id', parentDocId)
                        .single();
                      if (error || !doc) return null;
                      return doc;
                    },
                  });
                  if (mounted) {
                    setScriptParentDocumentName(parentDoc?.name ?? null);
                  }
                } else {
                  setScriptParentDocumentName(null);
                }
              }
            }
          } catch (authError: any) {
            if (authError instanceof AuthorizationError && mounted) {
              // User doesn't have access - clear state
              setLibraryName(null);
              setLibraryFolderId(null);
              setScriptParentDocumentId(null);
              setScriptParentDocumentName(null);
              setAssetName(null);
              setDocumentName(null);
              // Only redirect if this is not the initial fetch
              if (!isInitialFetch) {
                if (currentProjectId) {
                  router.push(
                    isScriptSystemPath(pathname)
                      ? `/script-system/${currentProjectId}`
                      : `/${currentProjectId}`
                  );
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
              setScriptParentDocumentId(null);
              setScriptParentDocumentName(null);
            }
          }
        } else {
          setLibraryName(null);
          setLibraryFolderId(null);
          setScriptParentDocumentId(null);
          setScriptParentDocumentName(null);
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
                  setFolderPath([]);
                } else {
                  const projectFolders = await queryClient.fetchQuery({
                    queryKey: queryKeys.projectFolders(currentProjectId),
                    queryFn: async () => {
                      const { data: folders, error } = await supabase
                        .from('folders')
                        .select('id, name, parent_folder_id')
                        .eq('project_id', currentProjectId);
                      if (error) throw error;
                      return folders ?? [];
                    },
                  });
                  setFolderName(data.name ?? null);
                  setFolderPath(buildFolderBreadcrumbPath(projectFolders, currentFolderId));
                }
              }
            } catch (authError: any) {
              if (authError instanceof AuthorizationError && mounted) {
                // User doesn't have access - clear
                setFolderName(null);
                setFolderPath([]);
              }
            }
          } else {
            // Invalid UUID format, skip query
            if (mounted) {
              setFolderName(null);
              setFolderPath([]);
            }
          }
        } else {
          setFolderName(null);
          setFolderPath([]);
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
              // This query only contains breadcrumb metadata. Keep it separate
              // from the full DocumentRecord cache consumed by DocumentEditor.
              queryKey: ['document-name', currentDocumentId] as const,
              queryFn: async () => {
                const { data, error } = await supabase
                  .from('documents')
                  .select('name, folder_id')
                  .eq('id', currentDocumentId)
                  .single();
                if (error || !data) return null;
                return data;
              },
            });
            if (mounted) {
              setDocumentName(data?.name ?? null);
              setDocumentFolderId(data?.folder_id ?? null);
            }
          } catch {
            if (mounted) {
              setDocumentName(null);
              setDocumentFolderId(null);
            }
          }
        } else {
          setDocumentName(null);
          setDocumentFolderId(null);
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
          setFolderPath([]);
          setDocumentFolderId(null);
          setLibraryFolderId(null);
          setScriptParentDocumentId(null);
          setScriptParentDocumentName(null);
        }
      }
    };
    fetchNames();
    return () => {
      mounted = false;
    };
  }, [currentProjectId, currentLibraryId, currentAssetId, currentDocumentId, currentFolderId, pathname, supabase, isAuthenticated, userId, router, queryClient]);

  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const nextBreadcrumbs: BreadcrumbItem[] = [];
    const onScript = onScriptSystem;

    if (pathname === '/mcp') {
      return [
        { label: 'Account', path: '/mcp' },
        { label: 'MCP', path: '/mcp' },
      ];
    }

    // Script sidebar tree: Project → Document → Script conversation
    if (onScript) {
      if (currentProjectId) {
        nextBreadcrumbs.push({
          label: projectName || 'Project',
          path: `/script-system/${currentProjectId}`,
        });
      }

      if (currentDocumentId) {
        nextBreadcrumbs.push({
          label: documentName || 'Document',
          path: `/script-system/${currentProjectId}/doc/${currentDocumentId}`,
        });
      } else if (currentLibraryId) {
        if (scriptParentDocumentId) {
          nextBreadcrumbs.push({
            label: scriptParentDocumentName || 'Document',
            path: `/script-system/${currentProjectId}/doc/${scriptParentDocumentId}`,
          });
        }
        nextBreadcrumbs.push({
          label: libraryName || 'Script',
          path: `/script-system/${currentProjectId}/script/${currentLibraryId}`,
        });
      }

      return nextBreadcrumbs;
    }
    
    if (currentProjectId) {
      nextBreadcrumbs.push({
        label: projectName || 'Project',
        path: `/${currentProjectId}`,
      });
    }

    // Add the complete folder ancestry to breadcrumbs when available.
    if (currentFolderId && currentProjectId) {
      const path = folderPath.length > 0
        ? folderPath
        : [{ id: currentFolderId, name: folderName || 'Folder' }];
      path.forEach((folder) => {
        nextBreadcrumbs.push({
          label: folder.name || 'Folder',
          path: `/${currentProjectId}/folder/${folder.id}`,
        });
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
    folderPath,
    currentLibraryId,
    currentProjectId,
    folderName,
    libraryName,
    onScriptSystem,
    projectName,
    pathname,
    scriptParentDocumentId,
    scriptParentDocumentName,
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
