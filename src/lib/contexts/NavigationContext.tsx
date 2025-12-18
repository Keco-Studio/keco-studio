'use client';

import { createContext, useContext, ReactNode, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

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
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const supabase = useSupabase();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);
  const [assetName, setAssetName] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [libraryFolderId, setLibraryFolderId] = useState<string | null>(null);

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

  useEffect(() => {
    let mounted = true;
    const fetchNames = async () => {
      // Resolve current project name
      if (currentProjectId) {
        const { data, error } = await supabase
          .from('projects')
          .select('name')
          .eq('id', currentProjectId)
          .single();
        if (mounted) {
          setProjectName(error ? null : data?.name ?? null);
        }
      } else {
        setProjectName(null);
      }

      // Resolve current library name and folder_id
      if (currentLibraryId) {
        const { data, error } = await supabase
          .from('libraries')
          .select('name, folder_id')
          .eq('id', currentLibraryId)
          .single();
        if (mounted) {
          if (error || !data) {
            setLibraryName(null);
            setLibraryFolderId(null);
          } else {
            setLibraryName(data.name ?? null);
            setLibraryFolderId(data.folder_id ?? null);
          }
        }
      } else {
        setLibraryName(null);
        setLibraryFolderId(null);
      }

      // Resolve current folder name (if we have a folder ID)
      if (currentFolderId) {
        const { data, error } = await supabase
          .from('folders')
          .select('name')
          .eq('id', currentFolderId)
          .single();
        if (mounted) {
          setFolderName(error ? null : data?.name ?? null);
        }
      } else {
        setFolderName(null);
      }

      // Resolve current asset name
      if (currentAssetId) {
        const { data, error } = await supabase
          .from('library_assets')
          .select('name')
          .eq('id', currentAssetId)
          .single();
        if (mounted) {
          setAssetName(error ? null : data?.name ?? null);
        }
      } else {
        setAssetName(null);
      }
    };
    fetchNames();
    return () => {
      mounted = false;
    };
  }, [currentProjectId, currentLibraryId, currentAssetId, currentFolderId, supabase]);

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

