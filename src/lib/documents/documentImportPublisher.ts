import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentRecord } from '@/lib/services/documentService';

export type DocumentImportPublicationState = 'not-published' | 'unknown';

export class DocumentImportPublishError extends Error {
  readonly publicationState: DocumentImportPublicationState;

  constructor(
    message: string,
    publicationState: DocumentImportPublicationState,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'DocumentImportPublishError';
    this.publicationState = publicationState;
  }
}

export function isDocumentImportDefinitelyUnpublished(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { publicationState?: unknown }).publicationState === 'not-published'
  );
}

function resultError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const error = (result as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}

function resultDocument(result: unknown, documentId: string): DocumentRecord | null {
  if (!result || typeof result !== 'object') return null;
  const document = (result as { document?: unknown }).document;
  if (!document || typeof document !== 'object') return null;
  return (document as { id?: unknown }).id === documentId
    ? document as DocumentRecord
    : null;
}

export async function publishImportedDocument(
  client: SupabaseClient,
  input: {
    documentId: string;
    versionId: string;
    projectId: string;
    folderId: string | null;
    name: string;
    markdown: string;
  }
): Promise<DocumentRecord> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new DocumentImportPublishError('Authentication required', 'not-published', {
      cause: error ?? undefined,
    });
  }
  const request: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  };
  let priorOutcomeWasUncertain = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch('/api/documents/import', request);
    } catch (cause) {
      priorOutcomeWasUncertain = true;
      if (attempt === 0) continue;
      throw new DocumentImportPublishError(
        cause instanceof Error ? cause.message : 'Document import failed',
        'unknown',
        { cause }
      );
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch (cause) {
      const definitivelyRejected = response.status >= 400 && response.status < 500;
      if (definitivelyRejected && !priorOutcomeWasUncertain) {
        throw new DocumentImportPublishError(
          'Document import failed',
          'not-published',
          { cause }
        );
      }
      priorOutcomeWasUncertain = true;
      if (attempt === 0) continue;
      throw new DocumentImportPublishError('Document import failed', 'unknown', { cause });
    }

    const document = response.ok ? resultDocument(result, input.documentId) : null;
    if (document) return document;

    const message = resultError(result) ?? 'Document import failed';
    const definitivelyRejected = response.status >= 400 && response.status < 500;
    if (definitivelyRejected && !priorOutcomeWasUncertain) {
      throw new DocumentImportPublishError(message, 'not-published');
    }

    priorOutcomeWasUncertain = true;
    if (attempt === 0) continue;
    throw new DocumentImportPublishError(message, 'unknown');
  }

  throw new DocumentImportPublishError('Document import failed', 'unknown');
}
