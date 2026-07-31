'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DocumentEditor } from '@/components/documents/DocumentEditor';
import { useScriptWorkspaceMembership } from '@/components/script-system/useScriptWorkspaceMembership';
import { showErrorToast } from '@/lib/utils/toast';

export default function ScriptDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const documentId = params.documentId as string;
  const { isMember, isLoading, isFetched, isError } =
    useScriptWorkspaceMembership(projectId);
  const handledRef = useRef(false);

  const allowed =
    isFetched && !isLoading && !isError && isMember(documentId);

  useEffect(() => {
    if (!isFetched || isLoading || handledRef.current) return;

    if (isError) {
      handledRef.current = true;
      showErrorToast('Failed to verify Script workspace membership');
      router.replace(`/script-system/${projectId}`);
      return;
    }

    if (!isMember(documentId)) {
      handledRef.current = true;
      showErrorToast('This document is not in the Script workspace');
      router.replace(`/script-system/${projectId}`);
    }
  }, [
    isFetched,
    isLoading,
    isError,
    isMember,
    documentId,
    projectId,
    router,
  ]);

  if (!allowed) {
    return null;
  }

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      documentId={documentId}
    />
  );
}
