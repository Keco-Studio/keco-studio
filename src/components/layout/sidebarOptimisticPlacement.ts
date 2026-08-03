import type { QueryClient } from '@tanstack/react-query';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import type { DocumentSummary } from '@/lib/services/documentService';
import { queryKeys } from '@/lib/utils/queryKeys';
import type { SidebarDropTarget } from './sidebarTreeDnD';

type FolderPlacement = Pick<Folder, 'parent_folder_id'>;
type DocumentPlacement = Pick<DocumentSummary, 'folder_id' | 'parent_document_id'>;
type LibraryPlacement = Pick<
  Library,
  'folder_id' | 'source_document_id' | 'document_export_type'
>;

export type SidebarOptimisticMove =
  | {
      kind: 'folder';
      id: string;
      before: FolderPlacement;
      after: FolderPlacement;
    }
  | {
      kind: 'document';
      id: string;
      before: DocumentPlacement;
      after: DocumentPlacement;
    }
  | {
      kind: 'library';
      id: string;
      before: LibraryPlacement;
      after: LibraryPlacement;
    };

type ValidSidebarDropTarget = Exclude<SidebarDropTarget, { kind: 'invalid' }>;
type SidebarFoldersLibrariesCache = { folders: Folder[]; libraries: Library[] };

function placementsEqual<T extends Record<string, unknown>>(left: T, right: T): boolean {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

export function createSidebarOptimisticMove(input: {
  dragKey: string;
  target: ValidSidebarDropTarget;
  folders: Folder[];
  libraries: Library[];
  documents: DocumentSummary[];
}): SidebarOptimisticMove | null {
  const { dragKey, target, folders, libraries, documents } = input;

  if (dragKey.startsWith('folder-')) {
    if (target.kind === 'document') return null;
    const id = dragKey.slice('folder-'.length);
    const folder = folders.find((item) => item.id === id);
    if (!folder) return null;
    const before: FolderPlacement = { parent_folder_id: folder.parent_folder_id ?? null };
    const after: FolderPlacement = {
      parent_folder_id: target.kind === 'folder' ? target.folderId : null,
    };
    return placementsEqual(before, after) ? null : { kind: 'folder', id, before, after };
  }

  if (dragKey.startsWith('document-')) {
    const id = dragKey.slice('document-'.length);
    const document = documents.find((item) => item.id === id);
    if (!document) return null;
    const before: DocumentPlacement = {
      folder_id: document.folder_id ?? null,
      parent_document_id: document.parent_document_id ?? null,
    };
    let after: DocumentPlacement;
    if (target.kind === 'document') {
      const parent = documents.find((item) => item.id === target.documentId);
      if (!parent) return null;
      after = {
        folder_id: parent.folder_id ?? null,
        parent_document_id: parent.id,
      };
    } else {
      after = {
        folder_id: target.kind === 'folder' ? target.folderId : null,
        parent_document_id: null,
      };
    }
    return placementsEqual(before, after) ? null : { kind: 'document', id, before, after };
  }

  if (!dragKey.startsWith('library-')) return null;
  const id = dragKey.slice('library-'.length);
  const library = libraries.find((item) => item.id === id);
  if (!library) return null;
  const before: LibraryPlacement = {
    folder_id: library.folder_id ?? null,
    source_document_id: library.source_document_id ?? null,
    document_export_type: library.document_export_type ?? null,
  };
  let after: LibraryPlacement;
  if (target.kind === 'document') {
    const parent = documents.find((item) => item.id === target.documentId);
    if (!parent) return null;
    after = {
      folder_id: parent.folder_id ?? null,
      source_document_id: parent.id,
      document_export_type: library.document_export_type ?? 'table',
    };
  } else if (library.source_document_id) {
    after = {
      folder_id: target.kind === 'folder' ? target.folderId : null,
      source_document_id: null,
      document_export_type: null,
    };
  } else {
    after = {
      folder_id: target.kind === 'folder' ? target.folderId : null,
      source_document_id: library.source_document_id ?? null,
      document_export_type: library.document_export_type ?? null,
    };
  }
  return placementsEqual(before, after) ? null : { kind: 'library', id, before, after };
}

function canApplyRollback<T extends Record<string, unknown>>(
  record: T,
  expected: Partial<T>
): boolean {
  return Object.entries(expected).every(([key, value]) => record[key] === value);
}

export function applySidebarOptimisticMove(
  queryClient: QueryClient,
  projectId: string,
  move: SidebarOptimisticMove,
  direction: 'forward' | 'rollback'
): void {
  const placement = direction === 'forward' ? move.after : move.before;
  const expected = direction === 'rollback' ? move.after : null;

  if (move.kind === 'document') {
    queryClient.setQueryData<DocumentSummary[]>(queryKeys.documents(projectId), (old) => {
      if (!old) return old;
      return old.map((document) => {
        if (document.id !== move.id) return document;
        if (expected && !canApplyRollback(document, expected)) return document;
        return { ...document, ...placement };
      });
    });
    return;
  }

  queryClient.setQueryData<SidebarFoldersLibrariesCache>(
    ['folders-libraries', projectId],
    (old) => {
      if (!old) return old;
      if (move.kind === 'folder') {
        return {
          ...old,
          folders: old.folders.map((folder) => {
            if (folder.id !== move.id) return folder;
            if (expected && !canApplyRollback(folder, expected)) return folder;
            return { ...folder, ...placement };
          }),
        };
      }
      return {
        ...old,
        libraries: old.libraries.map((library) => {
          if (library.id !== move.id) return library;
          if (expected && !canApplyRollback(library, expected)) return library;
          return { ...library, ...placement };
        }),
      };
    }
  );
}

export async function runOptimisticSidebarMutation(input: {
  client: QueryClient;
  projectId: string;
  move: SidebarOptimisticMove;
  persist: () => Promise<void>;
  reconcile: () => Promise<unknown>;
  onReconcileError?: (error: unknown) => void;
}): Promise<void> {
  const queryKey =
    input.move.kind === 'document'
      ? queryKeys.documents(input.projectId)
      : (['folders-libraries', input.projectId] as const);
  void input.client.cancelQueries({ queryKey });
  applySidebarOptimisticMove(input.client, input.projectId, input.move, 'forward');
  try {
    await input.persist();
  } catch (error) {
    applySidebarOptimisticMove(input.client, input.projectId, input.move, 'rollback');
    throw error;
  } finally {
    void input.reconcile().catch((error) => input.onReconcileError?.(error));
  }
}
