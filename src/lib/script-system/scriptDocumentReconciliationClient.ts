import type { DocumentStateToken } from '@/lib/documents/documentStateTypes';

export type ScriptDocumentReconciliationResult =
  | { status: 'synced'; updatedLibraries: number; updatedLibraryIds: string[] }
  | { status: 'not-linked' }
  | { status: 'regenerate-required' }
  | { status: 'conflict' };

export async function requestScriptDocumentReconciliation(input: {
  accessToken: string;
  projectId: string;
  documentId: string;
  expected: DocumentStateToken;
  previousMarkdown: string;
  markdown: string;
}): Promise<ScriptDocumentReconciliationResult> {
  const response = await fetch('/api/script-document-reconcile', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      projectId: input.projectId,
      documentId: input.documentId,
      expected: input.expected,
      previousMarkdown: input.previousMarkdown,
      markdown: input.markdown,
    }),
  });
  if (response.status === 204) return { status: 'not-linked' };
  if (response.ok) {
    const payload = (await response.json()) as {
      updatedLibraries?: unknown;
      updatedLibraryIds?: unknown;
    };
    return {
      status: 'synced',
      updatedLibraries: typeof payload.updatedLibraries === 'number'
        ? payload.updatedLibraries
        : 0,
      updatedLibraryIds: Array.isArray(payload.updatedLibraryIds)
        ? payload.updatedLibraryIds.filter((id): id is string => typeof id === 'string')
        : [],
    };
  }
  if (response.status === 409) {
    let code = '';
    try {
      const payload = (await response.json()) as { code?: unknown };
      code = typeof payload.code === 'string' ? payload.code : '';
    } catch {
      // Older deployments may return an empty conflict response.
    }
    return code === 'MAPPING_AMBIGUOUS'
      ? { status: 'regenerate-required' }
      : { status: 'conflict' };
  }
  throw new Error(`Script document reconciliation failed with HTTP ${response.status}`);
}
