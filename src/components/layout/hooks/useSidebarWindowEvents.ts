'use client';

import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export function useSidebarWindowEvents(
  _queryClient: QueryClient,
  currentProjectId: string | null,
  onSidebarToggle?: () => void
) {
  useEffect(() => {
    void currentProjectId;
    if (!onSidebarToggle) return;
    const handleSidebarToggle = () => onSidebarToggle();
    window.addEventListener('sidebar-toggle', handleSidebarToggle);
    return () => window.removeEventListener('sidebar-toggle', handleSidebarToggle);
  }, [currentProjectId, onSidebarToggle]);
}
