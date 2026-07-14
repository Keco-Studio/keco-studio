# In-App Documents Phase 1 Completion Design

**Date:** 2026-07-14
**Status:** Approved for implementation
**Scope:** Complete the remaining Phase 1 authoring gate on `using-MDXEditor`.

## Goal

Let users create and edit rich-text documents (notes, design docs, world-building lore,
and script drafts) directly inside a Keco Studio project, alongside libraries and folders,
using MDXEditor. Phase 1 stores Markdown in `documents.content`, gives viewers a read-only
experience, autosaves editor/admin changes, keeps project sidebars current through broadcast,
and proves project isolation and the complete authoring flow with automated tests.

## Current Baseline

The branch already contains the Phase 1 database table and RLS, isomorphic document CRUD,
the document route, MDXEditor integration, sidebar nodes and actions, Markdown autosave,
image upload integration, project-scoped broadcast payloads, and initial tests.

The following Phase 1 gaps remain:

- autosave, flush, permissions, query, upload, broadcast, and layout are coupled in
  `DocumentEditor`;
- remote saves invalidate queries but do not produce a stale-copy decision for an open editor;
- broadcast sends create a new temporary channel for each mutation instead of reusing the
  subscribed project sidebar channel;
- the autosave delay is 500 ms instead of the required 1-2 second idle window;
- the role UI does not use the project-role API contract;
- `NewDocumentModal.folderId` exists but no folder-scoped create entry reaches it;
- the viewer Playwright acceptance test is skipped and the image path lacks end-to-end proof;
- the full validation command fails because the image-upload test client does not implement
  the current authentication client surface;
- lazy loading is implemented but has no automated route-level bundle assertion.

## Non-Goals

- Do not enable, remove, or modify the existing Phase 2A Yjs migration, provider, plugin,
  cursor utility, or tests.
- Do not add full MDX/JSX, version history, Word/PDF import or export, design-upload document
  creation, or agent document tools.
- Do not replace the current global flush registry in this phase. Its interface remains the
  navigation boundary used by the existing sidebar. Broader router/back-button interception
  requires a separate navigation architecture decision.
- Do not add a second documents API. Document CRUD remains direct Supabase access through the
  isomorphic service and RLS.
- Do not change document storage authority: `documents.content` is the sole Phase 1 body.

## Design Principles

1. Keep one data authority and one content writer.
2. Keep React components focused on composition and rendering.
3. Put state transitions in framework-light units that can be tested deterministically.
4. Reuse the existing project sidebar Realtime channel rather than opening mutation channels.
5. Treat RLS as the security boundary and UI role gating as fast feedback.
6. Preserve unsaved local work whenever remote state is newer.
7. Keep Phase 2A dormant and isolated from Phase 1 runtime behavior.

## Architecture

### 1. Document persistence service

`src/lib/services/documentService.ts` remains the only database-facing document module.

Existing public interfaces remain stable:

```ts
listDocuments(client, projectId): Promise<DocumentSummary[]>
getDocument(client, documentId): Promise<DocumentRecord>
createDocument(client, input): Promise<DocumentRecord>
updateDocumentName(client, documentId, name): Promise<void>
updateDocumentContent(client, documentId, content, userId?): Promise<{ updatedAt: string }>
moveDocument(client, documentId, input): Promise<void>
deleteDocument(client, documentId): Promise<void>
```

`updateDocumentContent` performs one `UPDATE` for a persisted body. The editor resolves its
user once and supplies `userId`; no new authentication lookup is added to each keystroke.

### 2. Autosave controller hook

Create `src/components/documents/useDocumentAutosave.ts`.

```ts
type PersistReason = 'debounce' | 'navigate' | 'unmount' | 'visibility';
type PersistState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type UseDocumentAutosaveOptions = {
  initialContent: string;
  initialUpdatedAt: string;
  readOnly: boolean;
  delayMs?: number; // default 1500
  getSnapshot: () => string;
  save: (content: string) => Promise<{ updatedAt: string }>;
  onSaved?: (content: string, updatedAt: string) => void;
};

type DocumentAutosave = {
  state: PersistState;
  lastSavedAt: string;
  error: string | null;
  isDirty: boolean;
  lastSavedContent: string;
  handleChange: (markdown: string) => void;
  flush: (reason?: PersistReason) => Promise<void>;
  acceptRemote: (content: string, updatedAt: string) => void;
  keepLocalAfterRemote: (remoteUpdatedAt: string) => void;
};
```

Behavior:

- `handleChange` records the exact Markdown emitted by MDXEditor and resets a 1500 ms timer.
- only one save runs at once;
- an edit during a save marks another pass pending; `saved` is not shown until the latest
  Markdown is persisted;
- an explicit `handleChange('')` is valid and persists an empty document;
- teardown snapshots that are unexpectedly empty cannot overwrite known non-empty content;
- a rejected save preserves dirty state, shows an error, and propagates through `flush`;
- a successful save calls `onSaved` for cache write-through and broadcast;
- `acceptRemote` resets the local baseline after the user explicitly reloads a remote copy;
- `keepLocalAfterRemote` preserves local Markdown and advances only the remote-comparison
  watermark so the same event is not shown repeatedly.

### 3. Stale-copy hook

Create `src/components/documents/useDocumentStaleCopy.ts`.

```ts
type RemoteDocumentUpdate = {
  documentId: string;
  updatedAt?: string;
  action: 'save' | 'rename' | 'move' | 'create' | 'delete';
};

type UseDocumentStaleCopyOptions = {
  documentId: string;
  localUpdatedAt: string;
  isDirty: boolean;
  onCleanRemoteSave: () => Promise<void>;
};

type DocumentStaleCopy = {
  isStale: boolean;
  remoteUpdatedAt: string | null;
  receive: (update: RemoteDocumentUpdate) => void;
  reloadRemote: () => Promise<void>;
  keepLocal: () => void;
};
```

Only a newer `save` for the currently open document participates. Rename/move/create events
refresh metadata through React Query but do not create a body conflict.

- clean local editor: refetch immediately and update the editor through
  `MDXEditorMethods.setMarkdown`, then reset the autosave baseline;
- dirty local editor: show a banner and perform no automatic body replacement;
- Reload remote: discard local dirty text only after a successful refetch;
- Keep local: hide the banner, retain the local body, and let its next save become the LWW
  winner.

### 4. Reusable project document broadcast

`src/lib/documents/documentBroadcast.ts` owns only topic, event, payload types, and a pure send
helper that accepts an already subscribed `RealtimeChannel`:

```ts
sendDocumentUpdated(
  channel: RealtimeChannel,
  payload: DocumentUpdatedPayload
): Promise<void>
```

It must not call `supabase.channel()`, `subscribe()`, or `removeChannel()`.

`useSidebarRealtime` owns the lifecycle of `folders:project:{projectId}` and registers that
channel in a small project-channel registry while it is subscribed. Document mutations call:

```ts
broadcastProjectDocumentUpdate(projectId, payload): Promise<boolean>
```

The registry returns `false` when no subscribed project channel exists. Broadcast is still
best-effort; durable writes and query invalidation remain authoritative. The registry is keyed
by project ID, supports unregister-by-identity, and is separately unit tested.

The receiver exposes document update payloads to the open editor through a browser event with
one typed detail contract. React Query invalidation and stale-copy notification therefore use
the same received event without creating another Realtime subscription.

### 5. Permission contract

Create `src/components/documents/useDocumentPermissions.ts`.

```ts
type DocumentPermissionState = {
  role: 'admin' | 'editor' | 'viewer' | null;
  isLoading: boolean;
  error: string | null;
  readOnly: boolean;
  userId: string | null;
  accessToken: string | null;
};
```

The hook fetches `/api/projects/{projectId}/role` and obtains the current Supabase session for
`userId` and the unload token. It validates the loaded document's `project_id` against the URL
project before enabling editing. Owner responses are normalized to `admin` by the existing API
contract. Failed or unknown role resolution remains read-only and renders an explicit error.

### 6. DocumentEditor composition

`DocumentEditor` will:

1. query the document with `queryKeys.document(documentId)`;
2. resolve permissions through `useDocumentPermissions`;
3. create the autosave and stale-copy controllers;
4. register autosave `flush` with the existing flush registry;
5. provide a keepalive unload request using the autosave snapshot;
6. render header, stale banner, save status, and dynamically loaded MDXEditor;
7. use `setMarkdown` when a clean remote copy is accepted.

The component does not implement save-loop state transitions or Realtime channel lifecycle.

### 7. Folder-scoped create

Add a New document action to folder context menus for admin/editor roles. It sets the selected
folder ID before opening `NewDocumentModal`. The project-root add menu continues to clear the
folder ID. The existing database and service cross-project checks remain authoritative.

### 8. Images

The editor continues to reuse `uploadImageFiles` and the `library-media-files` bucket. The test
Supabase client must implement both `getSession` and `getUser` so it reflects the real service
contract. Editor insertion errors remain visible as `Image upload failed`; batch design-upload
behavior remains best-effort.

## Data Flows

### Local edit

```text
MDXEditor onChange
  -> useDocumentAutosave.handleChange(markdown)
  -> 1500 ms idle
  -> updateDocumentContent(client, documentId, markdown, userId)
  -> cache write-through
  -> shared project channel document-updated(save, updatedAt)
  -> Saved timestamp
```

### Remote save

```text
shared project channel document-updated
  -> invalidate document list + document query
  -> dispatch typed local document event
  -> useDocumentStaleCopy.receive
     -> clean: refetch + setMarkdown + acceptRemote
     -> dirty: stale banner
        -> Reload remote: refetch + setMarkdown + acceptRemote
        -> Keep local: retain Markdown; next autosave wins
```

### Navigation

```text
sidebar navigation
  -> flushOpenDocumentEditor
  -> autosave.flush(navigate)
     -> success: router.push
     -> failure: stay on current document + visible error
```

## Error Handling

- Missing/inaccessible document renders an error state.
- URL project/document mismatch renders an error and never enables editing.
- Role API or session failure renders an access error and remains read-only.
- Save failure retains dirty state and blocks guarded sidebar navigation.
- Image upload failure does not insert a broken Markdown image.
- Broadcast failure does not fail a durable mutation; query invalidation still updates the
  initiating client.
- Remote refetch failure leaves local content untouched and keeps the stale banner visible.

## Testing Strategy

### Unit

- autosave: 1500 ms debounce, coalesced in-flight edits, explicit empty save, teardown empty
  protection, save failure, remote baseline acceptance;
- stale copy: ignores other documents/actions/old timestamps, clean auto-refresh, dirty banner,
  reload and keep-local decisions;
- broadcast registry: reuse, no channel creation, identity-safe unregister, false without a
  channel;
- permissions: viewer read-only, editor writable, mismatch rejected, API failure rejected;
- image upload fake matches the authentication interface;
- existing document service, RLS migration, flush-registry, and Yjs groundwork tests stay green.

### Database behavior

With `RLS_DB_TESTS=1`:

- owner/admin/editor can write;
- viewer can read but cannot insert/update/delete;
- unrelated-project members cannot read the document;
- a document cannot attach to a folder in another project.

### Playwright

The document spec covers:

1. create in project root;
2. edit Markdown through MDXEditor;
3. idle autosave and reload persistence;
4. rename, move into a folder, and delete;
5. insert an image and verify it renders after reload;
6. open as a viewer and verify read-only content, no editing toolbar, and no write path.

Fixtures may create the viewer collaborator through existing test setup utilities. The test
must not remain skipped.

### Bundle and full gate

- add a static test proving `@mdxeditor/editor` is imported only by
  `MdxDocumentEditor.tsx` and that `DocumentEditor.tsx` uses `next/dynamic` with `ssr: false`;
- production build must place the editor in the document route's loadable manifest and not in
  the project root route manifest;
- `npm run validate` must exit 0;
- `npm run test:e2e -- tests/e2e/specs/documents.spec.ts` must pass in the configured E2E
  environment;
- `git diff --check` must be clean.

## Phase 1 Acceptance Gate

Phase 1 is complete only when all of the following are true:

- admin/editor can create at project root or inside a folder, rename, edit, move, and delete;
- viewer UI is read-only and RLS rejects viewer writes;
- Markdown persists after idle autosave and reload;
- slow/in-flight saves do not drop newer edits;
- save failure blocks guarded navigation;
- remote saves never silently overwrite dirty local work;
- remote sidebars refresh without creating a Realtime channel per mutation;
- inserted images upload and render after reload;
- cross-project isolation passes the live RLS harness;
- MDXEditor remains lazy-loaded outside the project root dashboard bundle;
- comments added by this work are English;
- full validation and the document Playwright spec are green.

## Reuse Review Checklist

- `documentService` is the sole document database boundary.
- `queryKeys.document(s)` is used for all document cache access.
- one project sidebar channel carries folder database changes and document broadcasts.
- one typed document-update payload serves sidebar invalidation and stale-copy handling.
- autosave does not know Supabase, React Query, routing, or Realtime.
- stale-copy logic does not know MDXEditor internals.
- permissions do not duplicate document CRUD or RLS logic.
- Phase 2A can replace the `save` callback later without changing editor layout or stale UI.
