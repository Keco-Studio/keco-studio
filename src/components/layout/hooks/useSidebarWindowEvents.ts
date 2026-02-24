'use client';

import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';

/**
 * Subscribes to window events for Sidebar: projectCreated, projectUpdated,
 * authStateChanged, library/folder created/updated/deleted (with debounce), sidebar-toggle.
 */
export function useSidebarWindowEvents(
  queryClient: QueryClient,
  currentProjectId: string | null,
  onSidebarToggle?: () => void
) {
  const invalidateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleProjectCreated = () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    };

    const handleProjectUpdated = (event: CustomEvent) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      if (event.detail?.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project', event.detail.projectId] });
      }
    };

    window.addEventListener('projectCreated' as any, handleProjectCreated as EventListener);
    window.addEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);

    return () => {
      window.removeEventListener('projectCreated' as any, handleProjectCreated as EventListener);
      window.removeEventListener('projectUpdated' as any, handleProjectUpdated as EventListener);
    };
  }, [queryClient]);

  useEffect(() => {
    const handleAuthStateChanged = () => {
      queryClient.clear();
    };

    window.addEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);

    return () => {
      window.removeEventListener('authStateChanged' as any, handleAuthStateChanged as EventListener);
    };
  }, [queryClient]);

  useEffect(() => {
    const invalidateFoldersAndLibraries = (projectId: string | null) => {
      if (!projectId) return;
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
      invalidateTimeoutRef.current = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['folders-libraries', projectId] });
      }, 100);
    };

    const handleLibraryCreated = (event: CustomEvent) => {
      const eventProjectId = event.detail?.projectId || currentProjectId;
      if (eventProjectId === currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    const handleFolderCreated = (event: CustomEvent) => {
      const eventProjectId = event.detail?.projectId || currentProjectId;
      if (eventProjectId === currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    const handleLibraryDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      if (currentProjectId && deletedProjectId === currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    const handleLibraryUpdated = (event: CustomEvent) => {
      if (currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    const handleFolderDeleted = (event: CustomEvent) => {
      const deletedProjectId = event.detail?.projectId;
      if (currentProjectId && deletedProjectId === currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    const handleFolderUpdated = (event: CustomEvent) => {
      if (currentProjectId) {
        invalidateFoldersAndLibraries(currentProjectId);
      }
    };

    window.addEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
    window.addEventListener('folderCreated' as any, handleFolderCreated as EventListener);
    window.addEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
    window.addEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
    window.addEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
    window.addEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);

    return () => {
      if (invalidateTimeoutRef.current) {
        clearTimeout(invalidateTimeoutRef.current);
      }
      window.removeEventListener('libraryCreated' as any, handleLibraryCreated as EventListener);
      window.removeEventListener('folderCreated' as any, handleFolderCreated as EventListener);
      window.removeEventListener('libraryDeleted' as any, handleLibraryDeleted as EventListener);
      window.removeEventListener('libraryUpdated' as any, handleLibraryUpdated as EventListener);
      window.removeEventListener('folderDeleted' as any, handleFolderDeleted as EventListener);
      window.removeEventListener('folderUpdated' as any, handleFolderUpdated as EventListener);
    };
  }, [currentProjectId, queryClient]);

  useEffect(() => {
    if (!onSidebarToggle) return;
    const handleSidebarToggle = () => onSidebarToggle();
    window.addEventListener('sidebar-toggle', handleSidebarToggle);
    return () => window.removeEventListener('sidebar-toggle', handleSidebarToggle);
  }, [onSidebarToggle]);
}
