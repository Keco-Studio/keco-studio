export const DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT =
  'document-derived-library:created';

export type DocumentDerivedLibraryCreatedDetail = {
  projectId: string;
  documentId: string;
  libraryId: string;
};

export function notifyDocumentDerivedLibraryCreated(
  detail: DocumentDerivedLibraryCreatedDetail
): void {
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT, { detail })
  );
}
