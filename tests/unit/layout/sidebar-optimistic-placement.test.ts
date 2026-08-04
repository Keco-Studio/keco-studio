import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import type { DocumentSummary } from '@/lib/services/documentService';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  applySidebarOptimisticMove,
  createSidebarOptimisticMove,
  runOptimisticSidebarMutation,
} from '@/components/layout/sidebarOptimisticPlacement';

const projectId = 'project-1';
const folders = [
  { id: 'f1', project_id: projectId, parent_folder_id: null, name: 'One' },
  { id: 'f2', project_id: projectId, parent_folder_id: 'f1', name: 'Two' },
] as Folder[];
const documents = [
  {
    id: 'd1',
    project_id: projectId,
    folder_id: 'f1',
    parent_document_id: null,
    name: 'Doc 1',
  },
  {
    id: 'd2',
    project_id: projectId,
    folder_id: null,
    parent_document_id: null,
    name: 'Doc 2',
  },
] as DocumentSummary[];
const libraries = [
  {
    id: 'l1',
    project_id: projectId,
    folder_id: null,
    source_document_id: null,
    document_export_type: null,
    name: 'Table 1',
  },
  {
    id: 'l2',
    project_id: projectId,
    folder_id: 'f1',
    source_document_id: 'd1',
    document_export_type: 'table',
    name: 'Table 2',
  },
] as Library[];

function clientWithSidebarData() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['folders-libraries', projectId], { folders, libraries });
  client.setQueryData(queryKeys.documents(projectId), documents);
  return client;
}

describe('sidebar optimistic placement', () => {
  it.each([
    ['folder-f2', { kind: 'root' } as const, { parent_folder_id: null }],
    [
      'document-d2',
      { kind: 'folder', folderId: 'f1' } as const,
      { folder_id: 'f1', parent_document_id: null },
    ],
    [
      'library-l1',
      { kind: 'folder', folderId: 'f1' } as const,
      { folder_id: 'f1', source_document_id: null, document_export_type: null },
    ],
    [
      'library-l2',
      { kind: 'root' } as const,
      { folder_id: null, source_document_id: null, document_export_type: null },
    ],
  ])('derives and applies %s placement', (dragKey, target, expected) => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey,
      target,
      folders,
      libraries,
      documents,
    });
    expect(move).not.toBeNull();

    applySidebarOptimisticMove(client, projectId, move!, 'forward');

    const cache = client.getQueryData<{ folders: Folder[]; libraries: Library[] }>([
      'folders-libraries',
      projectId,
    ]);
    const documentCache = client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId));
    const record = dragKey.startsWith('folder-')
      ? cache!.folders.find((item) => item.id === dragKey.slice('folder-'.length))
      : dragKey.startsWith('library-')
        ? cache!.libraries.find((item) => item.id === dragKey.slice('library-'.length))
        : documentCache!.find((item) => item.id === dragKey.slice('document-'.length));
    expect(record).toMatchObject(expected);
  });

  it('preserves unrelated records and server-owned fields', () => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey: 'library-l1',
      target: { kind: 'folder', folderId: 'f1' },
      folders,
      libraries,
      documents,
    })!;

    applySidebarOptimisticMove(client, projectId, move, 'forward');

    const cache = client.getQueryData<{ folders: Folder[]; libraries: Library[] }>([
      'folders-libraries',
      projectId,
    ])!;
    expect(cache.libraries[1]).toBe(libraries[1]);
    expect(cache.libraries[0].name).toBe('Table 1');
  });

  it('returns null for a placement no-op', () => {
    expect(
      createSidebarOptimisticMove({
        dragKey: 'folder-f1',
        target: { kind: 'root' },
        folders,
        libraries,
        documents,
      })
    ).toBeNull();
  });

  it('updates cache before persistence resolves and does not await reconciliation', async () => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey: 'folder-f2',
      target: { kind: 'root' },
      folders,
      libraries,
      documents,
    })!;
    let resolvePersist!: () => void;
    const persist = jest.fn(() =>
      new Promise<void>((resolve) => {
        resolvePersist = resolve;
      })
    );
    let resolveReconcile!: () => void;
    const reconcile = jest.fn(() =>
      new Promise<void>((resolve) => {
        resolveReconcile = resolve;
      })
    );

    const operation = runOptimisticSidebarMutation({
      client,
      projectId,
      move,
      persist,
      reconcile,
    });
    expect(
      client.getQueryData<{ folders: Folder[] }>(['folders-libraries', projectId])!.folders[1]
        .parent_folder_id
    ).toBeNull();
    resolvePersist();
    await operation;
    expect(reconcile).toHaveBeenCalledTimes(1);
    resolveReconcile();
  });

  it('rolls back a failed optimistic placement', async () => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey: 'document-d2',
      target: { kind: 'folder', folderId: 'f1' },
      folders,
      libraries,
      documents,
    })!;

    await expect(
      runOptimisticSidebarMutation({
        client,
        projectId,
        move,
        persist: async () => {
          throw new Error('offline');
        },
        reconcile: async () => undefined,
      })
    ).rejects.toThrow('offline');
    expect(client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId))![1]).toMatchObject(
      {
        folder_id: null,
        parent_document_id: null,
      }
    );
  });

  it('does not let a late rollback overwrite a newer placement', async () => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey: 'document-d2',
      target: { kind: 'folder', folderId: 'f1' },
      folders,
      libraries,
      documents,
    })!;
    let rejectPersist!: (error: Error) => void;
    const operation = runOptimisticSidebarMutation({
      client,
      projectId,
      move,
      persist: () =>
        new Promise<void>((_resolve, reject) => {
          rejectPersist = reject;
        }),
      reconcile: async () => undefined,
    });
    client.setQueryData<DocumentSummary[]>(queryKeys.documents(projectId), (old) =>
      old!.map((document) =>
        document.id === 'd2' ? { ...document, folder_id: 'f2' } : document
      )
    );

    rejectPersist(new Error('late failure'));

    await expect(operation).rejects.toThrow('late failure');
    expect(
      client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId))![1].folder_id
    ).toBe('f2');
  });
});
