'use client';

import { createContext, useContext, ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname, useParams } from 'next/navigation';
import { useSupabase } from '@/lib/SupabaseContext';

type BreadcrumbItem = {
  label: string;
  path: string;
};

type NavigationContextType = {
  breadcrumbs: BreadcrumbItem[];
  currentProjectId: string | null;
  currentLibraryId: string | null;
};

const NavigationContext = createContext<NavigationContextType | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const supabase = useSupabase();
  const [projectName, setProjectName] = useState<string | null>(null);
  const [libraryName, setLibraryName] = useState<string | null>(null);

  const currentProjectId = useMemo(() => (params.projectId as string) || null, [params.projectId]);
  const currentLibraryId = useMemo(() => (params.libraryId as string) || null, [params.libraryId]);

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

      // Resolve current library name
      if (currentLibraryId) {
        const { data, error } = await supabase
          .from('libraries')
          .select('name')
          .eq('id', currentLibraryId)
          .single();
        if (mounted) {
          setLibraryName(error ? null : data?.name ?? null);
        }
      } else {
        setLibraryName(null);
      }
    };
    fetchNames();
    return () => {
      mounted = false;
    };
  }, [currentProjectId, currentLibraryId, supabase]);

  // Build breadcrumbs from current route params
  const buildBreadcrumbs = (): BreadcrumbItem[] => {
    const breadcrumbs: BreadcrumbItem[] = [];
    
    if (currentProjectId) {
      breadcrumbs.push({
        label: projectName || 'Project',
        path: `/${currentProjectId}`,
      });
    }

    if (currentLibraryId) {
      breadcrumbs.push({
        label: libraryName || 'Library',
        path: `/${currentProjectId}/${currentLibraryId}`,
      });
    }

    return breadcrumbs;
  };

  const value: NavigationContextType = {
    breadcrumbs: buildBreadcrumbs(),
    currentProjectId,
    currentLibraryId,
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

