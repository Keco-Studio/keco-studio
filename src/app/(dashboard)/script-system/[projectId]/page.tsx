'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import { ImportDocumentationView } from '@/components/script-system/ImportDocumentationView';

export default function ScriptProjectImportPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { userProfile } = useAuth();
  const { projects } = useSidebarProjects(userProfile?.id);
  const projectName = useMemo(
    () => projects.find((project) => project.id === projectId)?.name ?? 'Project',
    [projects, projectId]
  );

  return (
    <ImportDocumentationView
      projectId={projectId}
      projectName={projectName}
    />
  );
}
