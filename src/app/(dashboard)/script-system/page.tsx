'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useSidebarProjects } from '@/components/layout/hooks/useSidebarProjects';
import {
  readScriptProjectPreference,
  writeScriptProjectPreference,
} from '@/lib/script-system/projectPreference';

export default function ScriptSystemLandingPage() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const { projects, isLoading, error, refetch } = useSidebarProjects(
    userProfile?.id
  );

  const targetProject = useMemo(() => {
    if (projects.length === 0) return null;
    const preferred = readScriptProjectPreference();
    if (preferred?.projectId) {
      const match = projects.find((project) => project.id === preferred.projectId);
      if (match) return match;
    }
    return projects[0] ?? null;
  }, [projects]);

  useEffect(() => {
    if (isLoading || !targetProject) return;
    writeScriptProjectPreference({
      projectId: targetProject.id,
      projectName: targetProject.name,
    });
    router.replace(`/script-system/${targetProject.id}`);
  }, [isLoading, targetProject, router]);

  if (error) {
    return (
      <div style={{ padding: 48 }}>
        <p style={{ color: '#b91c1c' }}>{error.message}</p>
        <button type="button" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (!isLoading && projects.length === 0) {
    return (
      <div style={{ padding: 48 }}>
        <h1 style={{ marginTop: 0 }}>No Studio projects</h1>
        <p style={{ color: '#64748b' }}>
          Create or join a project in Studio before using Keco Script.
        </p>
        <Link href="/projects">Go to projects</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: 48, color: '#64748b' }}>
      Loading Keco Script…
    </div>
  );
}
