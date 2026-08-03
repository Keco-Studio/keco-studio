# Sidebar DnD Optimistic Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make valid sidebar drops update the visible folder, document, or library placement immediately while Supabase persistence runs, with conditional rollback on failure.

**Architecture:** Add one focused module that derives placement-only changes, applies them to the existing React Query caches, and runs persistence without awaiting reconciliation. `Sidebar.handleTreeDrop` remains the operation coordinator and uses the existing service functions, toasts, broadcasts, expansion state, and DnD resolver. A pending-key ref prevents out-of-order writes for the same node while leaving unrelated drags available.

**Tech Stack:** React 19, TypeScript, TanStack React Query 5, Ant Design Tree, Jest 30, Supabase.

---

## File Map

- Create `src/components/layout/sidebarOptimisticPlacement.ts`: placement derivation, cache patching, conditional rollback, and persistence/reconciliation ordering.
- Create `tests/unit/layout/sidebar-optimistic-placement.test.ts`: behavior tests using a real `QueryClient`.
- Modify `src/components/layout/Sidebar.tsx`: coordinate optimistic drops through existing Supabase services and track pending keys.
- Modify `src/components/layout/components/SidebarTreeView.tsx`: reject drag start for pending node keys.
- Modify `src/components/layout/components/SidebarLibrariesSection.tsx`: pass the pending predicate to the tree.
- Modify `tests/unit/layout/sidebar-folder-dnd-wiring.test.ts`: assert optimistic and pending-drag wiring remains present.

### Task 1: Optimistic Placement Engine

**Files:**
- Create: `tests/unit/layout/sidebar-optimistic-placement.test.ts`
- Create: `src/components/layout/sidebarOptimisticPlacement.ts`

- [ ] **Step 1: Write failing placement derivation and cache tests**

Create `tests/unit/layout/sidebar-optimistic-placement.test.ts` with fixtures for one folder, one nested folder, two documents, one independent library, and one derived library. Use a real query cache:

```ts
import { QueryClient } from '@tanstack/react-query';
import type { Folder } from '@/lib/services/folderService';
import type { Library } from '@/lib/services/libraryService';
import type { DocumentSummary } from '@/lib/services/documentService';
import { queryKeys } from '@/lib/utils/queryKeys';
import {
  createSidebarOptimisticMove,
  applySidebarOptimisticMove,
  runOptimisticSidebarMutation,
} from '@/components/layout/sidebarOptimisticPlacement';

const projectId = 'project-1';
const folders = [
  { id: 'f1', project_id: projectId, parent_folder_id: null, name: 'One' },
  { id: 'f2', project_id: projectId, parent_folder_id: 'f1', name: 'Two' },
] as Folder[];
const documents = [
  { id: 'd1', project_id: projectId, folder_id: 'f1', parent_document_id: null, name: 'Doc 1' },
  { id: 'd2', project_id: projectId, folder_id: null, parent_document_id: null, name: 'Doc 2' },
] as DocumentSummary[];
const libraries = [
  { id: 'l1', project_id: projectId, folder_id: null, source_document_id: null, document_export_type: null, name: 'Table 1' },
  { id: 'l2', project_id: projectId, folder_id: 'f1', source_document_id: 'd1', document_export_type: 'table', name: 'Table 2' },
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
    ['document-d2', { kind: 'folder', folderId: 'f1' } as const, { folder_id: 'f1', parent_document_id: null }],
    ['document-d2', { kind: 'document', documentId: 'd1' } as const, { folder_id: 'f1', parent_document_id: 'd1' }],
    ['library-l1', { kind: 'folder', folderId: 'f1' } as const, { folder_id: 'f1', source_document_id: null, document_export_type: null }],
    ['library-l1', { kind: 'document', documentId: 'd1' } as const, { folder_id: 'f1', source_document_id: 'd1', document_export_type: 'table' }],
    ['library-l2', { kind: 'root' } as const, { folder_id: null, source_document_id: null, document_export_type: null }],
  ])('derives and applies %s placement', (dragKey, target, expected) => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({ dragKey, target, folders, libraries, documents });
    expect(move).not.toBeNull();
    applySidebarOptimisticMove(client, projectId, move!, 'forward');

    const cache = client.getQueryData<{ folders: Folder[]; libraries: Library[] }>(['folders-libraries', projectId]);
    const documentCache = client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId));
    const record = dragKey.startsWith('folder-')
      ? cache!.folders.find((item) => item.id === dragKey.slice(7))
      : dragKey.startsWith('library-')
        ? cache!.libraries.find((item) => item.id === dragKey.slice(8))
        : documentCache!.find((item) => item.id === dragKey.slice(9));
    expect(record).toMatchObject(expected);
  });

  it('preserves unrelated records and server-owned fields', () => {
    const client = clientWithSidebarData();
    const move = createSidebarOptimisticMove({
      dragKey: 'library-l1', target: { kind: 'folder', folderId: 'f1' }, folders, libraries, documents,
    })!;
    applySidebarOptimisticMove(client, projectId, move, 'forward');
    const cache = client.getQueryData<{ folders: Folder[]; libraries: Library[] }>(['folders-libraries', projectId])!;
    expect(cache.libraries[1]).toBe(libraries[1]);
    expect(cache.libraries[0].name).toBe('Table 1');
  });

  it('returns null for a placement no-op', () => {
    expect(createSidebarOptimisticMove({
      dragKey: 'folder-f1', target: { kind: 'root' }, folders, libraries, documents,
    })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests and verify the missing-module failure**

Run:

```bash
npx jest tests/unit/layout/sidebar-optimistic-placement.test.ts --runInBand
```

Expected: FAIL because `sidebarOptimisticPlacement` does not exist.

- [ ] **Step 3: Implement placement derivation and cache patching**

Create `src/components/layout/sidebarOptimisticPlacement.ts`. Define a discriminated `SidebarOptimisticMove` with `before` and `after` placement fields for folder, document, and library records. Implement:

```ts
export type SidebarOptimisticMove =
  | { kind: 'folder'; id: string; before: { parent_folder_id: string | null }; after: { parent_folder_id: string | null } }
  | { kind: 'document'; id: string; before: { folder_id: string | null; parent_document_id: string | null }; after: { folder_id: string | null; parent_document_id: string | null } }
  | { kind: 'library'; id: string; before: LibraryPlacement; after: LibraryPlacement };

export function createSidebarOptimisticMove(input: {
  dragKey: string;
  target: Exclude<SidebarDropTarget, { kind: 'invalid' }>;
  folders: Folder[];
  libraries: Library[];
  documents: DocumentSummary[];
}): SidebarOptimisticMove | null;

export function applySidebarOptimisticMove(
  queryClient: QueryClient,
  projectId: string,
  move: SidebarOptimisticMove,
  direction: 'forward' | 'rollback'
): void;
```

`createSidebarOptimisticMove` must mirror the placement table in the design. For rollback, `applySidebarOptimisticMove` must patch only when the cached record still matches `move.after`; forward application has no such precondition. Update arrays with `map`, return untouched records by identity, and do not update timestamps.

- [ ] **Step 4: Run placement tests and verify green**

Run:

```bash
npx jest tests/unit/layout/sidebar-optimistic-placement.test.ts --runInBand
```

Expected: PASS for all placement, identity-preservation, and no-op cases.

- [ ] **Step 5: Write failing async ordering and rollback tests**

Append these behaviors to the same test file:

```ts
it('updates cache before persistence resolves and does not await reconciliation', async () => {
  const client = clientWithSidebarData();
  const move = createSidebarOptimisticMove({
    dragKey: 'folder-f2', target: { kind: 'root' }, folders, libraries, documents,
  })!;
  let resolvePersist!: () => void;
  const persist = jest.fn(() => new Promise<void>((resolve) => { resolvePersist = resolve; }));
  let resolveReconcile!: () => void;
  const reconcile = jest.fn(() => new Promise<void>((resolve) => { resolveReconcile = resolve; }));

  const operation = runOptimisticSidebarMutation({ client, projectId, move, persist, reconcile });
  expect(client.getQueryData<{ folders: Folder[] }>(['folders-libraries', projectId])!.folders[1].parent_folder_id).toBeNull();
  resolvePersist();
  await operation;
  expect(reconcile).toHaveBeenCalledTimes(1);
  resolveReconcile();
});

it('rolls back a failed optimistic placement', async () => {
  const client = clientWithSidebarData();
  const move = createSidebarOptimisticMove({
    dragKey: 'document-d2', target: { kind: 'folder', folderId: 'f1' }, folders, libraries, documents,
  })!;
  await expect(runOptimisticSidebarMutation({
    client, projectId, move,
    persist: async () => { throw new Error('offline'); },
    reconcile: async () => undefined,
  })).rejects.toThrow('offline');
  expect(client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId))![1]).toMatchObject({
    folder_id: null, parent_document_id: null,
  });
});

it('does not let a late rollback overwrite a newer placement', async () => {
  const client = clientWithSidebarData();
  const move = createSidebarOptimisticMove({
    dragKey: 'document-d2', target: { kind: 'folder', folderId: 'f1' }, folders, libraries, documents,
  })!;
  let rejectPersist!: (error: Error) => void;
  const operation = runOptimisticSidebarMutation({
    client, projectId, move,
    persist: () => new Promise<void>((_resolve, reject) => { rejectPersist = reject; }),
    reconcile: async () => undefined,
  });
  client.setQueryData<DocumentSummary[]>(queryKeys.documents(projectId), (old) =>
    old!.map((doc) => doc.id === 'd2' ? { ...doc, folder_id: 'f2' } : doc)
  );
  rejectPersist(new Error('late failure'));
  await expect(operation).rejects.toThrow('late failure');
  expect(client.getQueryData<DocumentSummary[]>(queryKeys.documents(projectId))![1].folder_id).toBe('f2');
});
```

- [ ] **Step 6: Implement the async mutation runner**

Add:

```ts
export async function runOptimisticSidebarMutation(input: {
  client: QueryClient;
  projectId: string;
  move: SidebarOptimisticMove;
  persist: () => Promise<void>;
  reconcile: () => Promise<unknown>;
  onReconcileError?: (error: unknown) => void;
}): Promise<void> {
  const queryKey = input.move.kind === 'document'
    ? queryKeys.documents(input.projectId)
    : ['folders-libraries', input.projectId] as const;
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
```

- [ ] **Step 7: Run the complete helper test and commit**

Run:

```bash
npx jest tests/unit/layout/sidebar-optimistic-placement.test.ts --runInBand
```

Expected: PASS with no unhandled promise rejection.

Commit only these files:

```bash
git add src/components/layout/sidebarOptimisticPlacement.ts tests/unit/layout/sidebar-optimistic-placement.test.ts
git commit -m "feat(sidebar): add optimistic drag placement engine"
```

### Task 2: Pending-Node Drag Guard

**Files:**
- Modify: `tests/unit/layout/sidebar-folder-dnd-wiring.test.ts`
- Modify: `src/components/layout/components/SidebarTreeView.tsx`
- Modify: `src/components/layout/components/SidebarLibrariesSection.tsx`

- [ ] **Step 1: Add the failing wiring assertion**

Extend the Ant Tree wiring test:

```ts
expect(source).toContain('isDragPending');
expect(source).toContain('isDragPending(key)');
```

Add a section-prop assertion:

```ts
const section = read('src/components/layout/components/SidebarLibrariesSection.tsx');
expect(section).toContain('isDragPending={isDragPending}');
```

- [ ] **Step 2: Run the wiring test and verify red**

Run:

```bash
npx jest tests/unit/layout/sidebar-folder-dnd-wiring.test.ts --runInBand
```

Expected: FAIL because no pending-drag predicate is wired.

- [ ] **Step 3: Wire the predicate through both components**

Add this optional prop to both component prop types:

```ts
isDragPending?: (dragKey: string) => boolean;
```

Pass it unchanged from `SidebarLibrariesSection` to `SidebarTreeView`. In `SidebarTreeView.nodeDraggable`, after calculating `key`, add:

```ts
if (isDragPending?.(key)) return false;
```

Include `isDragPending` in the callback dependency list. Do not add loading text or alter row opacity.

- [ ] **Step 4: Run the wiring test and commit**

Run:

```bash
npx jest tests/unit/layout/sidebar-folder-dnd-wiring.test.ts --runInBand
```

Expected: PASS.

Commit:

```bash
git add src/components/layout/components/SidebarTreeView.tsx src/components/layout/components/SidebarLibrariesSection.tsx tests/unit/layout/sidebar-folder-dnd-wiring.test.ts
git commit -m "fix(sidebar): guard pending drag mutations"
```

### Task 3: Sidebar Drop Coordination

**Files:**
- Modify: `tests/unit/layout/sidebar-folder-dnd-wiring.test.ts`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add failing optimistic-coordination wiring assertions**

Extend the existing Sidebar wiring test:

```ts
expect(source).toContain('createSidebarOptimisticMove');
expect(source).toContain('runOptimisticSidebarMutation');
expect(source).toContain('pendingTreeDropKeysRef');
expect(source).toContain('isDragPending={isTreeDragPending}');
expect(source).toContain('moveDocument');
```

- [ ] **Step 2: Run the wiring test and verify red**

Run:

```bash
npx jest tests/unit/layout/sidebar-folder-dnd-wiring.test.ts --runInBand
```

Expected: FAIL because `Sidebar` still waits for service and refetch work before changing cache placement.

- [ ] **Step 3: Add pending-key coordination and optimistic imports**

Import `moveDocument` from `documentService` and import the new helper functions. Inside `Sidebar`, add:

```ts
const pendingTreeDropKeysRef = useRef(new Set<string>());
const isTreeDragPending = useCallback(
  (dragKey: string) => pendingTreeDropKeysRef.current.has(dragKey),
  []
);
```

Pass `isDragPending={isTreeDragPending}` to `SidebarLibrariesSection`.

- [ ] **Step 4: Replace the network-first drop handler**

Keep `resolveSidebarDrop` and permissions as the first gate. After resolving a valid target and checking `currentIds.projectId`, derive a move:

```ts
const optimisticMove = createSidebarOptimisticMove({
  dragKey,
  target,
  folders,
  libraries,
  documents,
});
if (!optimisticMove || pendingTreeDropKeysRef.current.has(dragKey)) return;
pendingTreeDropKeysRef.current.add(dragKey);
```

Before awaiting persistence, expand the target folder. For a document target, expand its containing folder and add `document-${target.documentId}` to `expandedKeys`.

Call `runOptimisticSidebarMutation` once. Its `persist` callback must select exactly one existing service call:

```ts
persist: async () => {
  if (optimisticMove.kind === 'folder') {
    await moveFolderToParent(supabase, optimisticMove.id, optimisticMove.after.parent_folder_id);
    return;
  }
  if (optimisticMove.kind === 'document') {
    if (optimisticMove.after.parent_document_id) {
      await nestDocumentUnderDocument(supabase, optimisticMove.id, optimisticMove.after.parent_document_id);
    } else {
      await moveDocument(supabase, optimisticMove.id, { folderId: optimisticMove.after.folder_id });
    }
    return;
  }
  if (optimisticMove.after.source_document_id) {
    await attachLibraryToDocument(
      supabase,
      optimisticMove.id,
      optimisticMove.after.source_document_id,
      optimisticMove.after.document_export_type ?? 'table'
    );
  } else if (optimisticMove.before.source_document_id) {
    await detachLibraryFromDocument(supabase, optimisticMove.id, {
      folderId: optimisticMove.after.folder_id,
    });
  } else {
    await moveLibraryToFolder(supabase, optimisticMove.id, {
      folderId: optimisticMove.after.folder_id,
    });
  }
}
```

The `reconcile` callback must invalidate document moves through `queryKeys.documents(projectId)` plus `invalidateLibraryData`, folder moves through `invalidateFolderData`, and library moves through `invalidateLibraryData`. `runOptimisticSidebarMutation` deliberately does not await this callback.

After persistence succeeds, preserve existing document broadcasts and operation-specific success messages. In `catch`, preserve the existing error-to-toast conversion. In `finally`, always run:

```ts
pendingTreeDropKeysRef.current.delete(dragKey);
```

Remove the tree-handler call to `moveSidebarDocument`; keep that helper imported and used by the separate Move Document modal.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npx jest tests/unit/layout/sidebar-optimistic-placement.test.ts tests/unit/layout/sidebar-tree-dnd.test.ts tests/unit/layout/sidebar-folder-dnd-wiring.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Run static verification**

Run:

```bash
npm run typecheck
npx eslint src/components/layout/Sidebar.tsx src/components/layout/sidebarOptimisticPlacement.ts src/components/layout/components/SidebarTreeView.tsx src/components/layout/components/SidebarLibrariesSection.tsx tests/unit/layout/sidebar-optimistic-placement.test.ts tests/unit/layout/sidebar-folder-dnd-wiring.test.ts
git diff --check
```

Expected: all commands exit 0 with no new warnings or whitespace errors.

- [ ] **Step 7: Commit coordination changes**

```bash
git add src/components/layout/Sidebar.tsx tests/unit/layout/sidebar-folder-dnd-wiring.test.ts
git commit -m "fix(sidebar): render drag moves before persistence"
```

### Task 4: Final Regression Verification

**Files:**
- No production changes expected.

- [ ] **Step 1: Run the complete layout unit-test directory**

```bash
npx jest tests/unit/layout --runInBand
```

Expected: PASS.

- [ ] **Step 2: Re-run type and diff checks from a clean command invocation**

```bash
npm run typecheck
git diff --check
git status --short
```

Expected: typecheck and diff check exit 0. `git status` may still show the user's pre-existing unrelated worktree changes; no unrelated file should be staged or committed.

- [ ] **Step 3: Manual latency acceptance check when an authenticated environment is available**

Throttle the Supabase request or use a production-latency connection, then drag each node type once. Verify the node changes hierarchy on drop before the request completes, the target expands immediately, a successful response keeps the placement, and a forced service failure returns only that node to its previous location with an error toast.
