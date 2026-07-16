# Document Version History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immutable document checkpoints, metadata-only history, read-only preview, and atomic Yjs/Markdown restore across connected editors.

**Architecture:** `document_versions` stores immutable snapshots behind caller-scoped RLS. Manual create and restore use fixed-search-path RPCs with document-row locking, epoch/revision CAS, and exact-tail checks; compaction creates rate-limited automatic checkpoints. An isomorphic document version service owns queries, `DocumentStateGateway.replace` owns restore encoding, and the existing collaboration session broadcasts a post-commit reset.

**Tech Stack:** PostgreSQL/Supabase RLS and PL/pgSQL, TypeScript, Supabase JS, Yjs, React 19, Next.js 16, React Query, Ant Design 5, MDXEditor, Jest, Playwright.

## Global Constraints

- Phase 2A Yjs snapshot plus current-epoch durable tail remains the only current-state authority.
- Every database call uses the caller's `SupabaseClient`; no service-role client appears in application code.
- Version list queries exclude `snapshot_yjs_state` and `snapshot_content`; preview selects `snapshot_content` only.
- Viewers may list and preview but may not create or restore.
- Restore backup, audit, head replacement, epoch/revision advance, and old-tail deletion are one transaction.
- `document_versions` is not added to `supabase_realtime`.
- Code, API names, comments, and user-visible product copy remain English.
- Follow RED -> GREEN -> REFACTOR for every task and commit only after fresh verification.

---

### Task 1: Version Schema and Guarded Database Operations

**Files:**
- Create: `tests/unit/database/document-version-history-migration.test.ts`
- Create: `supabase/migrations/20260716040000_document_version_history.sql`
- Modify: `supabase/migrations/20260716030000_document_realtime_collaboration.sql` only if a test proves a compatibility defect; otherwise leave the landed migration immutable.

**Interfaces:**
- Produces table `public.document_versions` and index `document_versions_document_created_idx`.
- Produces RPC `public.create_document_version(uuid, uuid, bigint, bigint, uuid[], text, text, text)`.
- Produces RPC `public.restore_document_version(uuid, uuid, uuid, uuid, bigint, bigint, uuid[], text, text)`.
- Replaces `public.compact_document_collab_state(uuid, bigint, bigint, uuid[], text, text)` with the same signature and return shape plus automatic checkpoint insertion.

- [ ] **Step 1: Write the failing static migration contract test**

Assert the migration adds the composite document identity constraint, immutable version table, six-value type/source checks, one `(document_id, created_at desc, id desc)` index, select-only table grants, fixed-search-path create/restore RPCs, exact-tail equality, the ten-minute automatic guard, pre-restore/audit inserts, epoch and revision increments, old-tail deletion, and no snapshot indexes or Realtime publication statement.

```ts
expect(migration).toContain('create table public.document_versions');
expect(migration).toMatch(/unique \(id, project_id\)/i);
expect(migration).toMatch(/snapshot_yjs_state text not null/i);
expect(migration).toMatch(/snapshot_content text not null/i);
expect(migration).toMatch(/create index document_versions_document_created_idx[\s\S]+document_id, created_at desc, id desc/i);
expect(migration).not.toMatch(/create index[^;]+snapshot_/is);
expect(migration).toMatch(/create or replace function public\.create_document_version/i);
expect(migration).toMatch(/create or replace function public\.restore_document_version/i);
expect(migration).toMatch(/v_tail_ids\s*<>\s*coalesce\(p_included_update_ids/i);
expect(migration).toMatch(/interval '10 minutes'/i);
expect(migration).not.toMatch(/alter publication supabase_realtime/i);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test:unit -- tests/unit/database/document-version-history-migration.test.ts --runInBand`

Expected: FAIL because `20260716040000_document_version_history.sql` does not exist.

- [ ] **Step 3: Add the schema, RLS, and create/restore functions**

Implement the SQL contract from the design. Both mutations lock `documents` with `FOR UPDATE`, authorize owner/admin/editor, compare expected epoch/revision, and compute:

```sql
select coalesce(array_agg(u.id order by u.created_at, u.id), array[]::uuid[])
into v_tail_ids
from public.document_yjs_updates u
where u.document_id = p_document_id
  and u.epoch = p_expected_epoch;

if v_tail_ids <> coalesce(p_included_update_ids, array[]::uuid[]) then
  raise exception 'Document update tail changed' using errcode = 'PT409';
end if;
```

Manual create inserts the supplied id/name and exact supplied merged snapshot. Restore inserts `pre_restore` under `p_backup_version_id`, inserts `restore` under `p_audit_version_id`, copies the target payload into the document, increments both token fields, and deletes every tail row at the old epoch before returning the new head plus both IDs.

Redefine compaction so the following insert occurs in its existing transaction before the document update:

```sql
if p_markdown is distinct from v_document.content
  and not exists (
    select 1 from public.document_versions v
    where v.document_id = p_document_id
      and v.version_type = 'automatic'
      and v.created_at > now() - interval '10 minutes'
  ) then
  insert into public.document_versions (
    document_id, project_id, name, version_type,
    snapshot_yjs_state, snapshot_content, snapshot_epoch,
    snapshot_revision, created_by
  ) values (
    p_document_id, v_document.project_id, 'Automatic checkpoint', 'automatic',
    p_yjs_state, p_markdown, p_expected_epoch,
    p_expected_revision + 1, v_user_id
  );
end if;
```

- [ ] **Step 4: Run the static test and existing collaboration migration test**

Run: `npm run test:unit -- tests/unit/database/document-version-history-migration.test.ts tests/unit/database/document-realtime-collaboration-migration.test.ts --runInBand`

Expected: both suites PASS.

- [ ] **Step 5: Apply the migration locally**

Run: `supabase migration up`

Expected: migration `20260716040000_document_version_history.sql` applies without SQL or dependency errors.

- [ ] **Step 6: Commit the database contract**

```bash
git add tests/unit/database/document-version-history-migration.test.ts supabase/migrations/20260716040000_document_version_history.sql
git commit -m "feat: add document version history schema"
```

### Task 2: Live RLS and Transaction Behavior

**Files:**
- Create: `tests/unit/database/document-version-history.rls.behavior.test.ts`
- Reuse: `tests/unit/database/helpers/rlsTestClient.ts`

**Interfaces:**
- Consumes the three RPCs and table from Task 1.
- Proves owner/admin/editor/viewer/non-member/cross-project behavior against local Supabase.

- [ ] **Step 1: Write failing live database tests**

Create two project fixtures and helpers to seed/initialize a document, append updates, create a manual version, and restore it. Cover:

```ts
for (const actor of [fx.owner, fx.admin, fx.editor]) {
  expect((await createVersion(actor, documentId)).error).toBeNull();
}
expect((await createVersion(fx.viewer, documentId)).error).not.toBeNull();

const viewerRows = await fx.viewer.client
  .from('document_versions')
  .select('id, document_id, name, version_type, snapshot_content')
  .eq('document_id', documentId);
expect(viewerRows.error).toBeNull();

const outsiderRows = await other.editor.client
  .from('document_versions')
  .select('id')
  .eq('document_id', documentId);
expect(outsiderRows.data).toEqual([]);
```

Also assert stale token and non-exact tail create no row; two changed compactions within ten minutes create one automatic row; unchanged compaction creates none; restore creates exact backup/audit rows, advances `{epoch, revision}`, clears old tail, and rejects a stale-epoch append. Pass an existing version ID as `p_audit_version_id` and assert the document, tail, and row count are unchanged after the resulting transaction failure.

- [ ] **Step 2: Run the live test and verify RED**

Run: `RLS_DB_TESTS=1 npm run test:unit -- tests/unit/database/document-version-history.rls.behavior.test.ts --runInBand`

Expected: FAIL on any missing grant, function behavior, rollback, or policy defect.

- [ ] **Step 3: Correct only the migration defects exposed by the live test**

Patch `20260716040000_document_version_history.sql` so every expected actor and transaction assertion passes. Do not weaken RLS, add direct mutation grants, or add a service-role application path.

- [ ] **Step 4: Rebuild/apply local database state and rerun live behavior**

Run: `supabase migration up`

Run: `RLS_DB_TESTS=1 npm run test:unit -- tests/unit/database/document-version-history.rls.behavior.test.ts --runInBand`

Expected: all version history live database tests PASS.

- [ ] **Step 5: Commit live database coverage**

```bash
git add tests/unit/database/document-version-history.rls.behavior.test.ts supabase/migrations/20260716040000_document_version_history.sql
git commit -m "test: prove document version transaction isolation"
```

### Task 3: Isomorphic Document Version Service

**Files:**
- Create: `src/lib/documents/documentVersionService.ts`
- Create: `tests/unit/documents/document-version-service.test.ts`
- Reuse: `src/lib/documents/documentContentCodec.ts`
- Reuse: `src/lib/documents/documentStateTypes.ts`

**Interfaces:**
- Produces `DocumentVersionType`, `DocumentVersionSummary`, `DocumentVersionPreview`, `listDocumentVersions`, `getDocumentVersionPreview`, and `createDocumentVersion`.
- The service has no `'use client'`, UI imports, or service-role client.

- [ ] **Step 1: Write failing service tests with a Supabase query harness**

Prove list uses exactly:

```ts
const DOCUMENT_VERSION_METADATA_COLUMNS =
  'id, document_id, project_id, name, version_type, source_version_id, snapshot_epoch, snapshot_revision, created_by, created_at';
```

and never contains either snapshot payload. Prove preview adds only
`snapshot_content`; creator profiles use `id, full_name, username`; rows map to
camelCase; invalid IDs fail before a query; hidden rows become
`DocumentAccessError`.

For create, mock `readDocumentState`, `mergeYjsState`, and
`yjsStateToMarkdown`; assert the RPC receives the expected token, ordered exact
tail IDs, matching merged Yjs/Markdown, trimmed name, and one stable UUID across
up to three `PT409` retries. Assert `42501` becomes `DocumentReadOnlyError`.

- [ ] **Step 2: Run the service test and verify RED**

Run: `npm run test:unit -- tests/unit/documents/document-version-service.test.ts --runInBand`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the service contract**

Use these exported signatures:

```ts
export async function listDocumentVersions(
  client: SupabaseClient,
  documentId: string
): Promise<DocumentVersionSummary[]>;

export async function getDocumentVersionPreview(
  client: SupabaseClient,
  documentId: string,
  versionId: string
): Promise<DocumentVersionPreview>;

export async function createDocumentVersion(
  client: SupabaseClient,
  input: { documentId: string; name: string }
): Promise<DocumentVersionSummary>;
```

Validate UUIDs, trim and bound names to 120 characters, reuse `validateName`,
read and merge current state, call `create_document_version`, and map the same
typed errors used by the gateway. Fetch creator profile names separately after
the metadata query.

- [ ] **Step 4: Run the service and existing gateway tests**

Run: `npm run test:unit -- tests/unit/documents/document-version-service.test.ts tests/unit/documents/document-state-gateway.test.ts --runInBand`

Expected: both suites PASS.

- [ ] **Step 5: Commit the service**

```bash
git add src/lib/documents/documentVersionService.ts tests/unit/documents/document-version-service.test.ts
git commit -m "feat: add document version service"
```

### Task 4: Transactional State Replacement Gateway

**Files:**
- Modify: `src/lib/documents/documentStateTypes.ts`
- Modify: `src/lib/documents/documentStateGateway.ts`
- Modify: `tests/unit/documents/document-state-gateway.test.ts`

**Interfaces:**
- Produces `ReplaceDocumentStateInput` restricted in Phase 2B to version restore.
- Produces `replaceDocumentState` and `documentStateGateway.replace`.

- [ ] **Step 1: Add failing gateway tests**

Assert a version restore reads the current head/tail, rejects a locally stale
token, merges the exact Yjs state, derives Markdown, creates distinct backup and
audit UUIDs, and calls:

```ts
client.rpc('restore_document_version', {
  p_document_id: DOCUMENT_ID,
  p_target_version_id: VERSION_ID,
  p_backup_version_id: expect.any(String),
  p_audit_version_id: expect.any(String),
  p_expected_epoch: 2,
  p_expected_revision: 4,
  p_included_update_ids: [UPDATE_A, UPDATE_B],
  p_current_yjs_state: 'merged-state',
  p_current_markdown: '# Derived',
});
```

Assert returned state is collaborative with an empty tail and new token. Assert
`kind: 'markdown'`, `reason: 'agent'`, invalid version IDs, `PT409`, and `42501`
are rejected with the intended typed errors.

- [ ] **Step 2: Run the gateway test and verify RED**

Run: `npm run test:unit -- tests/unit/documents/document-state-gateway.test.ts --runInBand`

Expected: FAIL because `replace` and its input type are absent.

- [ ] **Step 3: Implement the minimal replacement path**

Add:

```ts
export type ReplaceDocumentStateInput = {
  documentId: string;
  expected: DocumentStateToken;
  replacement: { kind: 'version'; versionId: string };
  reason: 'restore';
};
```

`replaceDocumentState` must reuse `readRawDocumentState`, `mergeYjsState`,
`documentContentCodec.yjsStateToMarkdown`, `throwMutationError`, and
`stateFromRpc`. It must not fetch the target version payload or accept raw
replacement payload from a component.

- [ ] **Step 4: Run all document state tests**

Run: `npm run test:unit -- tests/unit/documents/document-state-gateway.test.ts tests/unit/documents/document-content-codec.test.ts --runInBand`

Expected: both suites PASS.

- [ ] **Step 5: Commit gateway replacement**

```bash
git add src/lib/documents/documentStateTypes.ts src/lib/documents/documentStateGateway.ts tests/unit/documents/document-state-gateway.test.ts
git commit -m "feat: restore document state from versions"
```

### Task 5: Collaboration Restore and Exactly-Once Reset

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `src/components/documents/useDocumentCollaboration.ts`
- Modify: `tests/unit/documents/document-collaboration-session.test.ts`
- Modify: `tests/unit/documents/document-collaboration-wiring.test.ts`

**Interfaces:**
- `DocumentCollaborationGateway` gains `replace`.
- `DocumentCollaborationSessionOptions` gains `onStateReplaced`.
- `DocumentCollaborationSession` gains `restoreVersion(versionId)`.

- [ ] **Step 1: Add failing session tests**

Cover viewer rejection before gateway access, read-only `syncing` before flush,
flush/replace/local-reload/reset ordering, `reason: 'restore'`, callback after
commit, and typed conflict behavior. Emit the same reset twice and assert the
`reload` listener fires once. Advance heartbeat after a missed reset and assert
one replacement from a newer durable epoch.

```ts
await expect(harness.session.restoreVersion(VERSION_ID)).resolves.toMatchObject({
  token: { epoch: 3, revision: 5 },
});
expect(harness.gateway.replace).toHaveBeenCalledWith(expect.anything(), {
  documentId: DOCUMENT_ID,
  expected: { epoch: 2, revision: 4 },
  replacement: { kind: 'version', versionId: VERSION_ID },
  reason: 'restore',
});
expect(harness.channel.send).toHaveBeenCalledWith(expect.objectContaining({
  event: 'document-state-reset',
  payload: expect.objectContaining({ epoch: 3, revision: 5, reason: 'restore' }),
}));
```

- [ ] **Step 2: Run session tests and verify RED**

Run: `npm run test:unit -- tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts --runInBand`

Expected: FAIL because session restore and replacement callback are absent.

- [ ] **Step 3: Implement restore and reset deduplication**

Before reloading a reset, ignore an event when:

```ts
reset.epoch < this.currentToken.epoch ||
(reset.epoch === this.currentToken.epoch &&
  reset.revision <= this.currentToken.revision)
```

`restoreVersion` checks role/status, sets `syncing`, flushes pending durability,
calls `gateway.replace`, applies `replaceActiveDocument` exactly once, sends the
reset after the RPC resolves, and invokes `onStateReplaced`. On a conflict,
refresh durable state and surface the conflict without automatically retrying
the destructive action.

In `useDocumentCollaboration`, pass `documentStateGateway.replace`, invalidate
`queryKeys.documentVersions(documentId)` after compaction/replacement, and reuse
`broadcastProjectDocumentUpdate` for the durable save notification.

- [ ] **Step 4: Run collaboration unit regression tests**

Run: `npm run test:unit -- tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts tests/unit/documents/document-collaboration-protocol.test.ts --runInBand`

Expected: all suites PASS.

- [ ] **Step 5: Commit session lifecycle**

```bash
git add src/lib/documents/documentCollaborationSession.ts src/components/documents/useDocumentCollaboration.ts tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts
git commit -m "feat: reset live sessions after version restore"
```

### Task 6: Document Version History UI

**Files:**
- Create: `src/components/documents/DocumentVersionSidebar.tsx`
- Create: `src/components/documents/DocumentVersionSidebar.module.css`
- Create: `src/components/documents/CreateDocumentVersionModal.tsx`
- Create: `src/components/documents/DocumentVersionPreviewModal.tsx`
- Create: `src/components/documents/RestoreDocumentVersionModal.tsx`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css`
- Create: `tests/unit/documents/document-version-ui-wiring.test.ts`

**Interfaces:**
- Sidebar receives `projectId`, `documentId`, `canMutate`, and the active `DocumentCollaborationSession`.
- Modals receive one focused command and report success/close without accessing global session internals.

- [ ] **Step 1: Write failing UI wiring tests**

Use the repository's static/component wiring style to assert:

- history icon has `aria-label="Version history"` and stable icon-button class;
- `queryKeys.documentVersions(documentId)` and metadata service power the list;
- viewer path omits create/restore commands but retains preview;
- create awaits `session.flush()` before `createDocumentVersion`;
- preview passes `readOnly`, `showToolbar={false}`, and snapshot Markdown to
  `MdxDocumentEditor`;
- restore copy states the backup is automatic and calls
  `session.restoreVersion(version.id)`;
- no edit/delete library-version service or Postgres Realtime subscription is imported.

- [ ] **Step 2: Run the UI wiring test and verify RED**

Run: `npm run test:unit -- tests/unit/documents/document-version-ui-wiring.test.ts --runInBand`

Expected: FAIL because the document version components do not exist.

- [ ] **Step 3: Implement the sidebar and focused modals**

Use React Query for newest-first summaries and subscribe to
`subscribeToProjectDocumentUpdates` for matching-document invalidation. Render
plain list rows, type labels, creator, and local date. Use an icon-only history
button and close button with tooltips; use text buttons only for `Create version`,
`Preview`, `Restore`, `Cancel`, and confirmation commands.

Create action:

```ts
await session.flush();
await createDocumentVersion(supabase, { documentId, name });
await queryClient.invalidateQueries({
  queryKey: queryKeys.documentVersions(documentId),
});
```

Restore action:

```ts
await session.restoreVersion(version.id);
await queryClient.invalidateQueries({
  queryKey: queryKeys.documentVersions(documentId),
});
```

Keep the live editor mounted in a grid/flex editor pane while the 320px history
sidebar is open. Preview uses the already dynamically-loaded MDX editor in a
modal and never swaps the collaboration binding.

- [ ] **Step 4: Run UI and document editor tests**

Run: `npm run test:unit -- tests/unit/documents/document-version-ui-wiring.test.ts tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/mdx-editor-lazy-load.test.ts tests/unit/documents/document-permissions.test.ts --runInBand`

Expected: all suites PASS and the lazy-load guard still excludes MDXEditor from the dashboard entry.

- [ ] **Step 5: Commit the UI**

```bash
git add src/components/documents/DocumentVersionSidebar.tsx src/components/documents/DocumentVersionSidebar.module.css src/components/documents/CreateDocumentVersionModal.tsx src/components/documents/DocumentVersionPreviewModal.tsx src/components/documents/RestoreDocumentVersionModal.tsx src/components/documents/DocumentEditor.tsx src/components/documents/DocumentEditor.module.css tests/unit/documents/document-version-ui-wiring.test.ts
git commit -m "feat: add document version history interface"
```

### Task 7: Browser Restore Release Gate

**Files:**
- Create: `tests/e2e/specs/document-version-history.spec.ts`
- Reuse: `tests/e2e/specs/document-collaboration.spec.ts` fixture/login patterns.

**Interfaces:**
- Exercises the real UI, private channel, guarded RPCs, and local Supabase with two editors and one viewer.

- [ ] **Step 1: Write the failing Playwright flow**

Create a project/document with editor and viewer memberships. Open two editor
contexts, create `Before rewrite`, add newer concurrent text, open history, and
confirm restore. Assert both editor DOMs lose the newer text and show the saved
text, the viewer follows but has no create/restore buttons, history shows
`Before restore` and `Restored: Before rewrite`, and reload preserves restored
content.

Intercept one old-epoch `append_document_yjs_updates` request until after
restore and assert it returns `PT409`/non-2xx and its text never appears after
reload. Count editor root/binding replacement markers or durable reset events so
each remote editor rehydrates once for the new epoch.

- [ ] **Step 2: Run Playwright and verify RED**

Run: `npx playwright test tests/e2e/specs/document-version-history.spec.ts --workers=1`

Expected: FAIL at the first missing or incorrect browser behavior.

- [ ] **Step 3: Fix only integration defects revealed by the browser test**

Patch the smallest owning module for selectors, state transitions, query
invalidation, modal focus, or reset timing. Do not relax database assertions or
replace the real provider with mocks.

- [ ] **Step 4: Run the new and existing document Playwright gates**

Run: `npx playwright test tests/e2e/specs/document-version-history.spec.ts tests/e2e/specs/document-collaboration.spec.ts tests/e2e/specs/documents.spec.ts --workers=1`

Expected: all specs PASS.

- [ ] **Step 5: Commit the browser gate**

```bash
git add tests/e2e/specs/document-version-history.spec.ts src/lib/documents/documentCollaborationSession.ts src/components/documents/useDocumentCollaboration.ts src/components/documents/DocumentVersionSidebar.tsx src/components/documents/CreateDocumentVersionModal.tsx src/components/documents/DocumentVersionPreviewModal.tsx src/components/documents/RestoreDocumentVersionModal.tsx src/components/documents/DocumentEditor.tsx
git commit -m "test: gate document version restore workflow"
```

### Task 8: Final Review and Release Verification

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Confirms Phase 2B acceptance without changing Phase 2C+ scope.

- [ ] **Step 1: Review changed code against the detailed design**

Check immutable grants, metadata-only list, preview-only Markdown, exact-tail
manual/restore checks, automatic timing, mandatory backup, audit provenance,
post-commit reset, viewer UI/RLS, cross-project hiding, and absence of snapshot
indexes/Realtime publication changes.

- [ ] **Step 2: Run focused document Jest suites**

Run: `npm run test:unit -- tests/unit/documents tests/unit/database/document-version-history-migration.test.ts --runInBand`

Expected: all focused suites PASS.

- [ ] **Step 3: Run live RLS behavior**

Run: `RLS_DB_TESTS=1 npm run test:unit -- tests/unit/database/document-version-history.rls.behavior.test.ts tests/unit/database/document-realtime-collaboration.rls.behavior.test.ts --runInBand`

Expected: both live suites PASS.

- [ ] **Step 4: Run document Playwright gates**

Run: `npx playwright test tests/e2e/specs/document-version-history.spec.ts tests/e2e/specs/document-collaboration.spec.ts tests/e2e/specs/documents.spec.ts --workers=1`

Expected: all specs PASS.

- [ ] **Step 5: Run repository validation and diff checks**

Run: `npm run validate`

Expected: lint has zero errors, typechecks pass, unit tests pass, and production build succeeds.

Run: `git diff --check`

Expected: exit code 0 with no output.

- [ ] **Step 6: Commit any verification-only corrections**

```bash
git add supabase/migrations/20260716040000_document_version_history.sql src/lib/documents/documentVersionService.ts src/lib/documents/documentStateTypes.ts src/lib/documents/documentStateGateway.ts src/lib/documents/documentCollaborationSession.ts src/components/documents/useDocumentCollaboration.ts src/components/documents/DocumentVersionSidebar.tsx src/components/documents/DocumentVersionSidebar.module.css src/components/documents/CreateDocumentVersionModal.tsx src/components/documents/DocumentVersionPreviewModal.tsx src/components/documents/RestoreDocumentVersionModal.tsx src/components/documents/DocumentEditor.tsx src/components/documents/DocumentEditor.module.css tests/unit/database/document-version-history-migration.test.ts tests/unit/database/document-version-history.rls.behavior.test.ts tests/unit/documents/document-version-service.test.ts tests/unit/documents/document-state-gateway.test.ts tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts tests/unit/documents/document-version-ui-wiring.test.ts tests/e2e/specs/document-version-history.spec.ts
git commit -m "fix: close document version history release gaps"
```
