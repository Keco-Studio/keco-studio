'use client';

import { useEffect, useMemo, useState } from 'react';
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
  const [initialPreference] = useState(() => readScriptProjectPreference());

  const preferredProject = useMemo(() => {
    if (!initialPreference?.projectId) return null;
    return (
      projects.find((project) => project.id === initialPreference.projectId) ??
      null
    );
  }, [initialPreference, projects]);

  useEffect(() => {
    if (isLoading) return;
    if (!preferredProject) return;
    router.replace(`/script-system/${preferredProject.id}`);
  }, [isLoading, preferredProject, router]);

  const pickProject = (projectId: string, projectName: string) => {
    writeScriptProjectPreference({ projectId, projectName });
    router.push(`/script-system/${projectId}`);
  };

  if (isLoading || preferredProject) {
    return (
      <div style={{ padding: 48, color: '#64748b' }}>
        Loading Keco Script…
      </div>
    );
  }

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

  if (projects.length === 0) {
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
    <div style={{ padding: 48, maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Choose a project</h1>
      <p style={{ color: '#64748b' }}>
        Select a Studio project to open in Keco Script.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '24px 0 0' }}>
        {projects.map((project) => (
          <li key={project.id} style={{ marginBottom: 8 }}>
            <button
              type="button"
              onClick={() => pickProject(project.id, project.name)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px 14px',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                background: '#fff',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              {project.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
