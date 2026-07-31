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
  const { isMember, isLoading, isFetching, isFetched, isError } =
    useScriptWorkspaceMembership(projectId);
  const handledRef = useRef(false);

  // First-load ready: keep rendering during background refetch once we have data.
  const membershipReady = isFetched && !isLoading;
  // Settled: only treat non-membership as final after refetch completes.
  const membershipSettled = membershipReady && !isFetching;
  const canRender = membershipReady && !isError && isMember(documentId);

  useEffect(() => {
    if (!membershipSettled || handledRef.current) return;

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
    membershipSettled,
    isError,
    isMember,
    documentId,
    projectId,
    router,
  ]);

  if (!canRender) {
    return null;
  }

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      documentId={documentId}
      flushLayout
    />
  );
}
