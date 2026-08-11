'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { RecentPage } from '@/components/admin/RecentPage';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectRecentRoutePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const isValid = UUID_REGEX.test(projectId);

  useEffect(() => {
    if (!isValid) router.replace('/projects');
  }, [isValid, router]);

  if (!isValid) return null;
  return <RecentPage projectId={projectId} />;
}
