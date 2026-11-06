type AddDocumentToScriptWorkspaceInput = {
  projectId: string;
  documentId: string;
  request?: typeof fetch;
};

export async function addDocumentToScriptWorkspace({
  projectId,
  documentId,
  request = fetch,
}: AddDocumentToScriptWorkspaceInput): Promise<void> {
  const response = await request(`/api/script-workspace/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId }),
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  throw new Error(body?.error || 'Failed to add document to Script workspace');
}

type FinishScriptDocumentCreationInput = AddDocumentToScriptWorkspaceInput & {
  refreshWorkspace: () => Promise<unknown> | unknown;
  navigate: (href: string) => void;
};

export async function finishScriptDocumentCreation({
  projectId,
  documentId,
  request,
  refreshWorkspace,
  navigate,
}: FinishScriptDocumentCreationInput): Promise<void> {
  await addDocumentToScriptWorkspace({ projectId, documentId, request });
  await refreshWorkspace();
  navigate(`/script-system/${projectId}/doc/${documentId}`);
}
