'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { listFolders } from '@/lib/services/folderService';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import type { Project } from '@/lib/services/projectService';
import { readSimulationProjectPreference } from './projectPreference';
import type { StudioLibrarySource } from './importAdapter';
import { loadSimulationLibraryFields, loadSimulationProjectSources } from './studioData';
import type { LibraryRole, StudioColumnDefinition } from './types';

type LibrarySelection = Readonly<Record<LibraryRole, string>>;

type SimulationProjectContextValue = {
  projects: Project[];
  selectedProject: Project | null;
  selectedProjectId: string | null;
  libraries: Library[];
  /** folder id → name for the selected project (used to disambiguate duplicate library names) */
  folderNameById: ReadonlyMap<string, string>;
  isLoading: boolean;
  error: Error | null;
  unavailableLibraryIds: readonly string[];
  selectProject: (projectId: string) => void;
  retry: () => Promise<unknown>;
  loadFields: (libraryId: string) => Promise<ReadonlyArray<StudioColumnDefinition & { key: string; name: string }>>;
  loadSources: (libraryIds: LibrarySelection) => Promise<Readonly<Record<LibraryRole, StudioLibrarySource>>>;
};

const SimulationProjectContext = createContext<SimulationProjectContextValue | null>(null);

export function SimulationProjectProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const { projects, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useSidebarProjects(userProfile?.id);
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const [initialProjectId] = useState(() => readSimulationProjectPreference()?.projectId ?? null);
  const requestGenerationRef = useRef(0);
  const selectedProjectId = useMemo(() => {
    if (requestedProjectId && projects.some(({ id }) => id === requestedProjectId)) return requestedProjectId;
    if (initialProjectId && projects.some(({ id }) => id === initialProjectId)) return initialProjectId;
    return projects[0]?.id ?? null;
  }, [initialProjectId, projects, requestedProjectId]);
  const selectedProjectIdRef = useRef(selectedProjectId);
  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  const librariesQuery = useQuery({
    queryKey: ['simulation-libraries', selectedProjectId],
    queryFn: () => listLibraries(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
    staleTime: 60_000,
  });
  const foldersQuery = useQuery({
    queryKey: ['simulation-folders', selectedProjectId],
    queryFn: () => listFolders(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
    staleTime: 60_000,
  });
  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of foldersQuery.data ?? []) {
      map.set(folder.id, folder.name);
    }
    return map;
  }, [foldersQuery.data]);
  const selectedProject = useMemo(() => projects.find(({ id }) => id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  const selectProject = useCallback((projectId: string) => {
    if (!projects.some(({ id }) => id === projectId)) return;
    requestGenerationRef.current += 1;
    setRequestedProjectId(projectId);
  }, [projects]);

  const loadSources = useCallback(async (libraryIds: LibrarySelection) => {
    if (!selectedProjectId) throw new Error('Select a Studio project before importing libraries.');
    const projectAtStart = selectedProjectId;
    const generation = requestGenerationRef.current;
    const sources = await loadSimulationProjectSources(supabase, projectAtStart, libraryIds);
    if (generation !== requestGenerationRef.current || projectAtStart !== selectedProjectIdRef.current) {
      throw new Error('The selected project changed while simulation data was loading.');
    }
    return sources;
  }, [selectedProjectId, supabase]);

  const loadFields = useCallback(async (libraryId: string) => {
    if (!selectedProjectId) throw new Error('Select a Studio project before loading fields.');
    const projectAtStart = selectedProjectId;
    const generation = requestGenerationRef.current;
    const fields = await loadSimulationLibraryFields(supabase, projectAtStart, libraryId);
    if (generation !== requestGenerationRef.current || projectAtStart !== selectedProjectIdRef.current) {
      throw new Error('The selected project changed while fields were loading.');
    }
    return fields;
  }, [selectedProjectId, supabase]);

  const retry = useCallback(async () => {
    await refetchProjects();
    if (!selectedProjectId) return undefined;
    return Promise.all([librariesQuery.refetch(), foldersQuery.refetch()]);
  }, [foldersQuery, librariesQuery, refetchProjects, selectedProjectId]);

  const value = useMemo<SimulationProjectContextValue>(() => ({
    projects,
    selectedProject,
    selectedProjectId,
    libraries: librariesQuery.data ?? [],
    folderNameById,
    isLoading:
      projectsLoading
      || (Boolean(selectedProjectId) && (librariesQuery.isLoading || foldersQuery.isLoading)),
    error: (projectsError ?? librariesQuery.error ?? foldersQuery.error) as Error | null,
    unavailableLibraryIds: [],
    selectProject,
    retry,
    loadFields,
    loadSources,
  }), [
    folderNameById,
    foldersQuery.error,
    foldersQuery.isLoading,
    librariesQuery.data,
    librariesQuery.error,
    librariesQuery.isLoading,
    loadFields,
    loadSources,
    projects,
    projectsError,
    projectsLoading,
    retry,
    selectProject,
    selectedProject,
    selectedProjectId,
  ]);

  return <SimulationProjectContext.Provider value={value}>{children}</SimulationProjectContext.Provider>;
}

export function useSimulationProject() {
  const value = useContext(SimulationProjectContext);
  if (!value) throw new Error('useSimulationProject must be used within SimulationProjectProvider.');
  return value;
}
