'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { GameAssetsPage } from '@/components/admin/GameAssetsPage';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectGameAssetsRoutePage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.projectId as string;
  const isValid = UUID_REGEX.test(projectId);

  useEffect(() => {
    if (!isValid) router.replace('/projects');
  }, [isValid, router]);

  useEffect(() => {
    if (!isValid) return;
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/game-assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'activate-workspace' }),
        });
        if (response.ok) {
          await queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
      } catch {
        // The Assets page remains usable even if workspace activation is offline.
      }
    })();
  }, [isValid, projectId, queryClient]);

  if (!isValid) return null;
  return <GameAssetsPage projectId={projectId} />;
}
