'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Legacy collaborators route — redirect into Admin > Collaborator. */
export default function CollaboratorsRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  useEffect(() => {
    if (!UUID_REGEX.test(projectId)) {
      router.replace('/projects');
      return;
    }
    router.replace(`/${projectId}/admin/collaborators`);
  }, [projectId, router]);

  return null;
}
