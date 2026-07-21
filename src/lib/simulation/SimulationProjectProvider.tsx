'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import { useSupabase } from '@/lib/SupabaseContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { listLibraries, type Library } from '@/lib/services/libraryService';
import type { Project } from '@/lib/services/projectService';
import { readSimulationProjectHandoff } from '@/lib/simulationProjectHandoff';
import type { StudioLibrarySource } from './importAdapter';
import { loadSimulationProjectSources } from './studioData';
import type { LibraryRole } from './types';

type LibrarySelection = Readonly<Record<LibraryRole, string>>;

type SimulationProjectContextValue = {
  projects: Project[];
  selectedProject: Project | null;
  selectedProjectId: string | null;
  libraries: Library[];
  isLoading: boolean;
  error: Error | null;
  unavailableLibraryIds: readonly string[];
  selectProject: (projectId: string) => void;
  retry: () => Promise<unknown>;
  loadSources: (libraryIds: LibrarySelection) => Promise<Readonly<Record<LibraryRole, StudioLibrarySource>>>;
};

const SimulationProjectContext = createContext<SimulationProjectContextValue | null>(null);

export function SimulationProjectProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const { userProfile } = useAuth();
  const { projects, isLoading: projectsLoading, error: projectsError, refetch: refetchProjects } = useSidebarProjects(userProfile?.id);
  const [requestedProjectId, setRequestedProjectId] = useState<string | null>(null);
  const [initialProjectId] = useState(() => readSimulationProjectHandoff()?.projectId ?? null);
  const requestGenerationRef = useRef(0);
  const selectedProjectId = useMemo(() => {
    if (requestedProjectId && projects.some(({ id }) => id === requestedProjectId)) return requestedProjectId;
    if (initialProjectId && projects.some(({ id }) => id === initialProjectId)) return initialProjectId;
    return projects[0]?.id ?? null;
  }, [initialProjectId, projects, requestedProjectId]);

  const librariesQuery = useQuery({
    queryKey: ['simulation-libraries', selectedProjectId],
    queryFn: () => listLibraries(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
    staleTime: 60_000,
  });
  const selectedProject = useMemo(() => projects.find(({ id }) => id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  const selectProject = useCallback((projectId: string) => {
    if (!projects.some(({ id }) => id === projectId)) return;
    requestGenerationRef.current += 1;
    setRequestedProjectId(projectId);
  }, [projects]);

  const loadSources = useCallback(async (libraryIds: LibrarySelection) => {
    if (!selectedProjectId) throw new Error('Select a Studio project before importing libraries.');
    const projectAtStart = selectedProjectId;
    const generation = ++requestGenerationRef.current;
    const sources = await loadSimulationProjectSources(supabase, projectAtStart, libraryIds);
    if (generation !== requestGenerationRef.current || projectAtStart !== selectedProjectId) {
      throw new Error('The selected project changed while simulation data was loading.');
    }
    return sources;
  }, [selectedProjectId, supabase]);

  const retry = useCallback(async () => {
    await refetchProjects();
    if (selectedProjectId) return librariesQuery.refetch();
    return undefined;
  }, [librariesQuery, refetchProjects, selectedProjectId]);

  const value = useMemo<SimulationProjectContextValue>(() => ({
    projects,
    selectedProject,
    selectedProjectId,
    libraries: librariesQuery.data ?? [],
    isLoading: projectsLoading || (Boolean(selectedProjectId) && librariesQuery.isLoading),
    error: (projectsError ?? librariesQuery.error) as Error | null,
    unavailableLibraryIds: [],
    selectProject,
    retry,
    loadSources,
  }), [librariesQuery.data, librariesQuery.error, librariesQuery.isLoading, loadSources, projects, projectsError, projectsLoading, retry, selectProject, selectedProject, selectedProjectId]);

  return <SimulationProjectContext.Provider value={value}>{children}</SimulationProjectContext.Provider>;
}

export function useSimulationProject() {
  const value = useContext(SimulationProjectContext);
  if (!value) throw new Error('useSimulationProject must be used within SimulationProjectProvider.');
  return value;
}
