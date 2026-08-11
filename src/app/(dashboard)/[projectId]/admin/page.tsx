'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AdminSettingsPage } from '@/components/admin/AdminSettingsPage';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProjectAdminSettingsRoutePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const isValid = UUID_REGEX.test(projectId);

  useEffect(() => {
    if (!isValid) router.replace('/projects');
  }, [isValid, router]);

  if (!isValid) return null;
  return <AdminSettingsPage projectId={projectId} />;
}
