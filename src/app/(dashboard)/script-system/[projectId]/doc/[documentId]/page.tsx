'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DocumentEditor } from '@/components/documents/DocumentEditor';
import { useScriptWorkspaceDocumentMembership } from '@/components/script-system/useScriptWorkspaceDocumentMembership';
import { showErrorToast } from '@/lib/utils/toast';

export default function ScriptDocumentPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const documentId = params.documentId as string;
  const { isMember, isLoading, isFetching, isFetched, isError } =
    useScriptWorkspaceDocumentMembership(projectId, documentId);
  const handledRef = useRef(false);

  // First-load ready: keep rendering during background refetch once we have data.
  const membershipReady = isFetched && !isLoading;
  // Settled: only treat non-membership as final after refetch completes.
  const membershipSettled = membershipReady && !isFetching;
  const canRender = membershipReady && !isError && isMember;

  useEffect(() => {
    if (!membershipSettled || handledRef.current) return;

    if (isError) {
      handledRef.current = true;
      showErrorToast('Failed to verify Script workspace membership');
      router.replace(`/script-system/${projectId}`);
      return;
    }

    if (!isMember) {
      handledRef.current = true;
      showErrorToast('This document is not in the Script workspace');
      router.replace(`/script-system/${projectId}`);
    }
  }, [
    membershipSettled,
    isError,
    isMember,
    projectId,
    router,
  ]);

  if (membershipSettled && !canRender) {
    return null;
  }

  return (
    <DocumentEditor
      key={documentId}
      projectId={projectId}
      documentId={documentId}
      flushLayout
      scriptWorkspaceMembershipReady={canRender}
    />
  );
}
