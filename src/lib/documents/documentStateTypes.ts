export type DocumentStateToken = {
  epoch: number;
  revision: number;
};

export type DurableYjsUpdate = {
  id: string;
  updateBase64: string;
  createdAt?: string;
};

export type ReplaceDocumentStateInput = {
  documentId: string;
  expected: DocumentStateToken;
  expectedUpdateIds?: readonly string[];
  replacement:
    | { kind: 'version'; versionId: string }
    | { kind: 'markdown'; markdown: string };
  reason: 'restore' | 'agent';
};

export type AuthoritativeDocumentState = {
  documentId: string;
  projectId: string;
  mode: 'legacy' | 'collaborative';
  markdown: string;
  yjsStateBase64: string | null;
  updateTail: DurableYjsUpdate[];
  token: DocumentStateToken;
  updatedAt: string;
};

export type CollaborationStatus =
  | 'idle'
  | 'authorizing'
  | 'connecting'
  | 'hydrating'
  | 'syncing'
  | 'ready'
  | 'legacy-view'
  | 'degraded'
  | 'error'
  | 'closed';

export class DocumentAccessError extends Error {
  constructor(message = 'Document not found or not accessible') {
    super(message);
    this.name = 'DocumentAccessError';
  }
}

export class DocumentReadOnlyError extends Error {
  constructor(message = 'This document is read-only') {
    super(message);
    this.name = 'DocumentReadOnlyError';
  }
}

export class DocumentStateConflictError extends Error {
  readonly token?: DocumentStateToken;

  constructor(message = 'Document state changed', token?: DocumentStateToken) {
    super(message);
    this.name = 'DocumentStateConflictError';
    this.token = token;
  }
}

export class DocumentCollaborationUnavailableError extends Error {
  constructor(message = 'Document collaboration is unavailable') {
    super(message);
    this.name = 'DocumentCollaborationUnavailableError';
  }
}

export class DocumentContentValidationError extends Error {
  constructor(message = 'Document content is invalid') {
    super(message);
    this.name = 'DocumentContentValidationError';
  }
}
