# Document Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch subagents unless the user explicitly authorizes them.

**Goal:** Rebase `using-MDXEditor` onto main and repair every blocker, major, and selected minor from the July 15 document review.

**Architecture:** Preserve the sanctioned-MDX and Yjs architecture. Adopt main's shared auth, pagination, and sidebar infrastructure first, then harden each ownership boundary independently: SQL, state gateway, import/export, collaboration, agent/UI, and cleanup.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase/PostgreSQL RLS and RPCs, Yjs, MDXEditor/Lexical, Jest, Playwright, Sharp, PDFKit, and docx.

## Global Constraints

- Do not use test-driven sequencing; implement each bounded repair and then add or update regression coverage immediately.
- Preserve the user's uncommitted `next-env.d.ts` change exactly.
- Keep all repository source, tests, migrations, and documentation English-only.
- Do not weaken the closed sanctioned-MDX registry or evaluate MDX expressions.
- Keep document realtime transport broadcast-only; do not add documents to the Supabase realtime publication.
- Keep viewer authorization and CAS epoch/revision checks server-enforced.
- Do not remove Sharp's input-pixel safety guard.
- Do not spawn subagents without explicit user authorization.

---

### Task 1: Rebase and Main Baseline Adoption

**Files:**
- Modify during conflicts: `package.json`
- Modify during conflicts: `package-lock.json`
- Modify during conflicts: `src/components/layout/Sidebar.tsx`
- Modify during conflicts: `src/components/layout/hooks/useSidebarRealtime.ts`
- Modify during conflicts: `src/app/(dashboard)/[projectId]/design-upload/page.tsx`
- Preserve: `next-env.d.ts`

**Interfaces:**
- Consumes: `origin/main`, the current document branch, and the user's working-tree diff.
- Produces: a rebased branch that uses main's `withAuth`, `fetchAllPaged`, consolidated sidebar channel, and English-only baseline.

- [ ] **Step 1: Preserve the working-tree change and rebase**

Record `git diff -- next-env.d.ts`, stash only that path, run
`git rebase origin/main`, resolve conflicts in favor of main's shared
infrastructure plus the branch's document-specific additions, and restore the
stash. Confirm the restored diff is byte-for-byte identical to the recorded
diff.

- [ ] **Step 2: Resolve shared-infrastructure conflicts**

Keep `withAuth` from `src/lib/auth/route-auth.ts`, `fetchAllPaged` from
`src/lib/services/pagination.ts`, main's consolidated folders/sidebar channel,
and all English-only replacements. Reapply document routes, document sidebar
nodes, and document invalidation without recreating an extra project channel.

- [ ] **Step 3: Verify the rebase baseline**

Run:

```bash
git status --short --branch
git diff --check
git diff origin/main...HEAD --check
```

Expected: no rebase state, no conflict markers, no whitespace errors, and only
the original `next-env.d.ts` working-tree change remains uncommitted.

### Task 2: Migration Identity, Archive RLS, Payload Bounds, and Version Retention

**Files:**
- Rename: `supabase/migrations/20260713000000_create_documents.sql` -> `supabase/migrations/20260716000000_create_documents.sql`
- Rename: `supabase/migrations/20260713010000_retire_shared_documents.sql` -> `supabase/migrations/20260716010000_retire_shared_documents.sql`
- Rename: `supabase/migrations/20260713100000_documents_yjs_state.sql` -> `supabase/migrations/20260716020000_documents_yjs_state.sql`
- Rename: `supabase/migrations/20260714000000_document_realtime_collaboration.sql` -> `supabase/migrations/20260716030000_document_realtime_collaboration.sql`
- Rename: `supabase/migrations/20260714010000_document_version_history.sql` -> `supabase/migrations/20260716040000_document_version_history.sql`
- Rename: `supabase/migrations/20260715000000_document_agent_edit.sql` -> `supabase/migrations/20260716050000_document_agent_edit.sql`
- Rename: `supabase/migrations/20260715010000_document_import_checkpoint.sql` -> `supabase/migrations/20260716060000_document_import_checkpoint.sql`
- Modify: `src/lib/documents/documentVersionService.ts`
- Modify: `src/components/documents/DocumentVersionSidebar.tsx`
- Modify: `tests/unit/database/*document*.test.ts`
- Modify: `tests/unit/documents/document-version-service.test.ts`
- Modify: `tests/unit/documents/document-version-ui-wiring.test.ts`

**Interfaces:**
- Consumes: existing document SQL RPC signatures and `anonClient()` database helper.
- Produces: collision-free migrations, deny-all archive access, bounded RPC inputs, automatic retention, and `deleteDocumentVersion(client, documentId, versionId)`.

- [ ] **Step 1: Renumber migrations and all path references**

Rename the seven migrations in dependency order to the exact versions listed
above. Update tests and documentation that open or name the old paths. Confirm
`rg '20260713000000_create_documents|20260713010000_retire_shared_documents|20260713100000_documents_yjs_state|20260714000000_document_realtime_collaboration|20260714010000_document_version_history|20260715000000_document_agent_edit|20260715010000_document_import_checkpoint'` returns no stale document-migration references.

- [ ] **Step 2: Lock down the archive table**

Immediately after `shared_documents_archive` creation, add:

```sql
alter table public.shared_documents_archive enable row level security;
revoke all on table public.shared_documents_archive from anon, authenticated;
```

Do not add archive policies.

- [ ] **Step 3: Bound collaboration and snapshot RPC inputs**

In every relevant security-definer function, validate before authorization-
independent allocation or mutation:

```sql
-- Updates: 1..100 entries, each canonical base64 and <= 262144 decoded bytes.
-- Markdown: octet_length <= 2097152.
-- Snapshot: encoded length bounded before decode and decoded length <= 8388608.
```

Apply the shared bounds to initialization, append, compaction, restore, agent
replacement, and import checkpoint paths. Invalid input raises SQLSTATE
`22023`; permission and CAS SQLSTATE mappings remain unchanged.

- [ ] **Step 4: Add automatic retention and guarded deletion**

After inserting an automatic checkpoint, delete automatic versions outside the
newest 100 for the same document. Add
`public.delete_document_version(p_document_id uuid, p_version_id uuid)` as a
security-definer RPC that locks the document, checks owner/editor/admin access,
permits only `manual` and `automatic`, and returns the deleted ID. Revoke from
public/anon/service role and grant execute to authenticated.

- [ ] **Step 5: Wire version deletion**

Add `deleteDocumentVersion` to the service with typed permission/conflict
mapping. Add a version-row delete command and confirmation in the sidebar for
manual and automatic versions only. Invalidate the document-version query on
success.

- [ ] **Step 6: Add and run database regression coverage**

Cover migration uniqueness, archive RLS/grants, anonymous denial, update and
snapshot caps, retention ordering, protected audit versions, authorized
deletion, denied deletion, and referenced-version conflict.

Run:

```bash
npx jest tests/unit/database/documents-rls.test.ts tests/unit/database/shared-documents-retire.test.ts tests/unit/database/document-realtime-collaboration-migration.test.ts tests/unit/database/document-version-history-migration.test.ts tests/unit/database/document-agent-edit-migration.test.ts tests/unit/database/document-import-checkpoint-migration.test.ts tests/unit/documents/document-version-service.test.ts tests/unit/documents/document-version-ui-wiring.test.ts --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 7: Commit the database batch**

```bash
git add supabase/migrations src/lib/documents/documentVersionService.ts src/components/documents/DocumentVersionSidebar.tsx tests/unit/database tests/unit/documents/document-version-service.test.ts tests/unit/documents/document-version-ui-wiring.test.ts
git commit -m "fix: harden document migrations and versions"
```

### Task 3: Complete and Lightweight State Gateway Reads

**Files:**
- Modify: `src/lib/documents/documentStateTypes.ts`
- Modify: `src/lib/documents/documentStateGateway.ts`
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `tests/unit/documents/document-state-gateway.test.ts`
- Modify: `tests/unit/documents/document-collaboration-session.test.ts`

**Interfaces:**
- Consumes: `fetchAllPaged<T>(fetchPage)` from `src/lib/services/pagination.ts`.
- Produces: `readDocumentState(...)` with Markdown and `readDocumentTransportState(...)` without Markdown materialization.

- [ ] **Step 1: Page update-tail reads**

Replace the single tail select with `fetchAllPaged`, applying `.range(from,
to)` after both stable order clauses. Keep the before/after head-token read and
retry the entire page sequence if the token changes.

- [ ] **Step 2: Split transport and materialized reads**

Factor one internal authoritative read returning identity, snapshot, complete
tail, and token. Export `readDocumentTransportState` for callers that do not
need Markdown. Keep `readDocumentState` as the public materializing wrapper and
preserve the legacy-document behavior.

- [ ] **Step 3: Move heartbeat/catch-up to transport reads**

Use transport reads for 15-second heartbeats and token-only durable catch-up.
Materialize Markdown only for compaction, replacement, versions, export,
import, and agent consumers.

- [ ] **Step 4: Add and run gateway regressions**

Extend the Supabase query mock with `.range`. Simulate 1,001 ordered updates in
two pages, verify both pages participate in materialization, verify an unstable
head restarts at page zero, and verify heartbeat never calls
`yjsStateToMarkdown`.

Run:

```bash
npx jest tests/unit/documents/document-state-gateway.test.ts tests/unit/documents/document-collaboration-session.test.ts --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 5: Commit the gateway batch**

```bash
git add src/lib/documents/documentStateTypes.ts src/lib/documents/documentStateGateway.ts src/lib/documents/documentCollaborationSession.ts tests/unit/documents/document-state-gateway.test.ts tests/unit/documents/document-collaboration-session.test.ts
git commit -m "fix: read complete document collaboration state"
```

### Task 4: Import, Export, URL, Route, and Token Hardening

**Files:**
- Modify: `src/lib/document-parser.ts`
- Modify: `src/lib/documents/documentImportService.ts`
- Modify: `src/lib/documents/documentExportService.ts`
- Modify: `src/app/api/documents/import/route.ts`
- Modify: `src/app/api/documents/[documentId]/export/route.ts`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `tests/unit/documents/document-import-service.test.ts`
- Modify: `tests/unit/documents/document-export-service.test.ts`
- Modify: `tests/unit/documents/document-import-route.test.ts`
- Modify: `tests/unit/documents/document-export-route.test.ts`
- Modify: `tests/unit/documents/document-editor-export.test.tsx`

**Interfaces:**
- Consumes: main's `withAuth` and configured Supabase URL.
- Produces: prefix-free import sentinels, two-worker image resolution, normalized trusted-image validation, 60-second routes, and fresh export authorization.

- [ ] **Step 1: Make image placeholders prefix-free**

Generate an opaque UUID sentinel per parsed image and carry it through Markdown
construction, upload, and replacement. Replace exact sentinels only. Reject
missing or duplicate sentinels before publication.

- [ ] **Step 2: Bound image resolution concurrency**

Replace `Promise.all` with an internal ordered worker pool of two. Keep the
20-image count, 5 MiB response, signature, timeout, dimensions, Sharp pixel
limit, and 480 by 360 output bounds. Preserve alt-text fallback for a failed
image.

- [ ] **Step 3: Normalize and validate trusted image URLs**

Parse the configured Supabase origin once. Require production HTTPS. Allow
loopback HTTP only for non-production loopback Supabase configuration. Decode
each pathname segment, reject malformed encoding, dot segments, encoded
slashes/backslashes, username/password/fragment, and require exact normalized
segments `storage/v1/object/public/library-media-files/...`.

- [ ] **Step 4: Adopt route auth and duration**

Wrap both handlers with `withAuth`, preserve their current response contracts,
and export `maxDuration = 60` from each route.

- [ ] **Step 5: Refresh the export token per request**

Inside `handleExport`, call `supabase.auth.getSession()` immediately before
`fetch`, reject a missing session, and set `Authorization` from the returned
current access token. Remove the mount-captured token dependency.

- [ ] **Step 6: Add and run import/export regressions**

Cover 11 images, deterministic missing/duplicate sentinel rejection, maximum
two concurrent image decodes, production loopback denial, configured local
Supabase allowance in development, `%2e%2e`, encoded slash/backslash, route
duration/auth wiring, and a refreshed token after the initial token expires.

Run:

```bash
npx jest tests/unit/documents/document-import-service.test.ts tests/unit/documents/document-export-service.test.ts tests/unit/documents/document-import-route.test.ts tests/unit/documents/document-export-route.test.ts tests/unit/documents/document-editor-export.test.tsx --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 7: Commit the import/export batch**

```bash
git add src/lib/document-parser.ts src/lib/documents/documentImportService.ts src/lib/documents/documentExportService.ts src/app/api/documents src/components/documents/DocumentEditor.tsx tests/unit/documents/document-import-service.test.ts tests/unit/documents/document-export-service.test.ts tests/unit/documents/document-import-route.test.ts tests/unit/documents/document-export-route.test.ts tests/unit/documents/document-editor-export.test.tsx
git commit -m "fix: bound document import and export resources"
```

### Task 5: Collaboration Failure Isolation and Recovery

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Modify: `src/components/documents/useDocumentCollaboration.ts`
- Modify: `tests/unit/documents/document-collaboration-session.test.ts`
- Modify: `tests/unit/documents/document-collaboration-wiring.test.ts`
- Modify: `tests/e2e/specs/document-collaboration.spec.ts`

**Interfaces:**
- Consumes: existing Yjs docs, semantic validation, private broadcast channel, and durable gateway.
- Produces: post-append transport recovery, candidate peer validation, persistent reconnect, lifecycle triggers, and prompt awareness removal.

- [ ] **Step 1: Separate durable success from broadcast success**

After append succeeds, apply to `durableDoc`, clear the matching pending update,
increment tail counters, and schedule compaction before attempting broadcast.
Catch a broadcast transport error separately, leave the document saved, and
allow the channel failure handler to reconnect. Append failures keep the update
pending and fail closed.

- [ ] **Step 2: Validate remote candidates before apply**

Clone active state into a temporary `Y.Doc`, apply the decoded candidate, and
run `validateSerializedMdxNodes` on its root. Apply to active/durable docs and
record the update ID only after validation succeeds. Use the same candidate
path for sync responses. Destroy the temporary doc in `finally`.

- [ ] **Step 3: Continue reconnect with bounded backoff**

Remove the five-attempt terminal guard. Keep exponential backoff and jitter
capped at 30 seconds. Reset attempts on successful subscription. Add one
public lifecycle method that cancels the current timer and requests immediate
reconnect plus durable reload without creating concurrent reconnect promises.

- [ ] **Step 4: Wire online, focus, and visibility recovery**

Register browser listeners in `useDocumentCollaboration` and call the immediate
recovery method when online, focused, or visible. Remove all listeners during
effect cleanup.

- [ ] **Step 5: Broadcast awareness removal before closing suppression**

Set local awareness state to null, encode the resulting removal, and issue one
best-effort send while the channel is still usable. Then set `closing`, detach
listeners, and continue bounded teardown. Do not turn departure failure into a
destroy failure.

- [ ] **Step 6: Add and run collaboration regressions**

Cover append-success/broadcast-failure clearing dirty state, append failure
remaining dirty, invalid peer isolation, update-ID handling, more than five
reconnect attempts, immediate lifecycle recovery, single reconnect in flight,
and awareness removal ordering.

Run:

```bash
npx jest tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 7: Commit the collaboration batch**

```bash
git add src/lib/documents/documentCollaborationSession.ts src/components/documents/useDocumentCollaboration.ts tests/unit/documents/document-collaboration-session.test.ts tests/unit/documents/document-collaboration-wiring.test.ts tests/e2e/specs/document-collaboration.spec.ts
git commit -m "fix: recover document collaboration sessions"
```

### Task 6: Agent Compaction, Confirmation Diff, and MDX Property Parity

**Files:**
- Modify: `src/lib/agent/tool-result-for-llm.ts`
- Modify: `src/lib/agent/tools/create-document.ts`
- Modify: `src/components/agent/ConfirmationCard.tsx`
- Modify: `src/lib/documents/sanctionedMdx.ts`
- Modify: `src/components/agent/ChatPanel.module.css`
- Modify: `tests/unit/agent/tool-result-for-llm.test.ts`
- Modify: `tests/unit/agent/document-tools.test.ts`
- Modify: `tests/unit/agent/document-confirmation-ui.test.tsx`
- Modify: `src/lib/documents/sanctionedMdx.test.ts`
- Modify: `tests/unit/documents/sanctioned-mdx-property-editor.test.tsx`

**Interfaces:**
- Consumes: persisted `ToolResult`, tool name lookup, confirmation payloads, and sanctioned component rules.
- Produces: valid compact `read_document` JSON with `_llmNote`, default create confirmation, one replacement diff, and property-validation parity.

- [ ] **Step 1: Add structured read-document compaction**

When a successful `read_document` result exceeds 16,000 characters, construct
a new `ToolResult` rather than slicing serialized JSON. Preserve document ID,
project ID, token, and a Markdown prefix that fits. Add `totalCharacters`,
`visibleCharacters`, `truncated: true`, and an `_llmNote` that prohibits full-
document replacement from the partial read. Re-serialize and shrink the
Markdown prefix until the whole JSON is within the limit.

- [ ] **Step 2: Require create confirmation**

Set `createDocumentTool.confirmationRequired` to `true`. Keep `pre_execute`,
editor permission, preview display, cleanup, and resume-time permission checks
unchanged.

- [ ] **Step 3: Render a single replacement diff**

Derive line additions/removals/unchanged spans from the saved original and
replacement content already present in the confirmation payload. Collapse
long unchanged spans, render additions and removals once with accessible
labels, and put the raw proposal in one expandable region. Do not render the
complete replacement twice.

- [ ] **Step 4: Align optional property validation**

Trim-check required values. For optional empty-string values, omit the key from
the returned map and skip enum membership checks. For present optional values,
retain control-character and allowed-value checks.

- [ ] **Step 5: Add and run agent/UI/MDX regressions**

Prove compacted output parses as JSON, stays within 16,000 characters, reports
exact visible/total counts and `_llmNote`, create requires confirmation, the
replacement appears once with additions/removals, optional empty props are
omitted, and the resulting attributes pass full MDX validation.

Run:

```bash
npx jest tests/unit/agent/tool-result-for-llm.test.ts tests/unit/agent/document-tools.test.ts tests/unit/agent/document-confirmation-ui.test.tsx src/lib/documents/sanctionedMdx.test.ts tests/unit/documents/sanctioned-mdx-property-editor.test.tsx --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 6: Commit the agent/UI batch**

```bash
git add src/lib/agent/tool-result-for-llm.ts src/lib/agent/tools/create-document.ts src/components/agent/ConfirmationCard.tsx src/components/agent/ChatPanel.module.css src/lib/documents/sanctionedMdx.ts src/lib/documents/sanctionedMdx.test.ts tests/unit/agent tests/unit/documents/sanctioned-mdx-property-editor.test.tsx
git commit -m "fix: make document agent context safe"
```

### Task 7: Dead Code, Dependency, and Contract Cleanup

**Files:**
- Delete: `src/components/documents/useDocumentAutosave.ts`
- Delete: `src/components/documents/useDocumentStaleCopy.ts`
- Delete: `tests/unit/documents/document-autosave.test.ts`
- Delete: `tests/unit/documents/document-stale-copy.test.ts`
- Modify: `src/lib/services/documentService.ts`
- Modify: `tests/unit/documents/document-service.test.ts`
- Modify: `tests/unit/documents/document-editor-wiring.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/superpowers/specs/2026-07-14-document-realtime-collaboration-design.md`

**Interfaces:**
- Consumes: the collaboration session as the sole document body writer.
- Produces: no dead body-save API, correct dependency classification, no Simplified Chinese font package, and an explicit code-block LWW contract.

- [ ] **Step 1: Remove dead save code**

Delete both unused hooks and their dedicated tests. Remove
`updateDocumentContent` and its deprecated comments/tests. Keep rename, move,
trash, restore, and metadata service operations unchanged. Update wiring tests
to assert the removed symbols and files are absent.

- [ ] **Step 2: Clean dependencies**

Run:

```bash
npm uninstall @fontsource/noto-sans-sc
npm install --save-dev @types/pdfkit
```

Remove Noto font loading from export code. Confirm `@types/pdfkit` appears only
under `devDependencies` and the lockfile has no Noto Sans SC package.

- [ ] **Step 3: Document code-block semantics**

Add one explicit limitation to the collaboration design: rich text uses
character-level Yjs operations, while code-block values are atomic
last-writer-wins fields.

- [ ] **Step 4: Run cleanup regressions**

```bash
npx jest tests/unit/documents/document-service.test.ts tests/unit/documents/document-editor-wiring.test.ts tests/unit/documents/document-export-service.test.ts --runInBand
rg -n "useDocumentAutosave|useDocumentStaleCopy|updateDocumentContent|noto-sans-sc" src package.json package-lock.json
```

Expected: Jest passes; `rg` returns no production or package references.

- [ ] **Step 5: Commit the cleanup batch**

```bash
git add -A src/components/documents src/lib/services/documentService.ts src/lib/documents/documentExportService.ts tests/unit/documents package.json package-lock.json docs/superpowers/specs/2026-07-14-document-realtime-collaboration-design.md
git commit -m "chore: remove legacy document save paths"
```

### Task 8: Full Verification and Review Closure

**Files:**
- Modify only if verification exposes a regression in files already in scope.

**Interfaces:**
- Consumes: all repaired batches.
- Produces: evidence that the branch is mergeable or an explicit list of remaining external blockers.

- [ ] **Step 1: Run static and unit verification**

```bash
git diff --check origin/main...HEAD
npm run lint
npx tsc --noEmit
npm run test:unit -- --runInBand
npm run build
```

Expected: all commands exit zero with no English-only violations.

- [ ] **Step 2: Run database behavior verification**

Start or reuse local Supabase, apply all migrations from a clean baseline, and
run the document RLS behavior suites with the repository's documented RLS test
environment. Confirm migration versions are unique and all seven document
migrations appear after main's `20260713060000`.

- [ ] **Step 3: Run document Playwright verification**

```bash
npx playwright test tests/e2e/specs/documents.spec.ts tests/e2e/specs/document-collaboration.spec.ts tests/e2e/specs/document-version-history.spec.ts tests/e2e/specs/document-phase2.spec.ts
```

Expected: all document workflows pass in the configured projects.

- [ ] **Step 4: Inspect final branch state**

```bash
git status --short --branch
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Expected: only the user's original `next-env.d.ts` working-tree change is
uncommitted; implementation commits are present; no conflict markers or
whitespace errors remain.

- [ ] **Step 5: Close the review checklist**

Map every blocker, major, and selected minor to its implementation commit and
verification. Report any skipped external-service suite explicitly with the
exact command and failure reason.
