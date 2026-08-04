# Document Loading Performance Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make standard and Script workspace document startup run independent document, role, and membership checks concurrently while preserving every existing authorization boundary.

**Architecture:** Refactor `useDocumentPermissions` to consume the shared React Query project-role query and begin session/role resolution from `projectId`, independent of the document response. Add a targeted Script workspace membership GET on the existing nested route, then make the Script document page use that query in parallel with `DocumentEditor`; the editor mounts only after all checks pass.

**Tech Stack:** Next.js App Router, React 19, TanStack React Query, Supabase, Jest/ts-jest, TypeScript.

---

### Task 1: Add targeted Script workspace membership service and API tests

**Files:**
- Modify: `src/lib/script-system/scriptWorkspaceService.ts`
- Modify: `src/app/api/script-workspace/[projectId]/[documentId]/route.ts`
- Test: `tests/unit/api/script-workspace-route.test.ts`

- [ ] **Step 1: Write the failing service/API tests**

Add tests for `GET /api/script-workspace/:projectId/:documentId` that assert:

```ts
it('returns membership for the requested document without listing the workspace', async () => {
  // Mock authenticated owner and a single .maybeSingle() membership lookup.
  // Expect { member: true } and no full-list query.
});

it('returns member false for a missing workspace row', async () => {
  // Mock a successful role check and maybeSingle() returning null.
  // Expect { member: false }.
});

it('returns forbidden when project access fails', async () => {
  // Mock getUserProjectRole to reject with AuthorizationError.
  // Expect HTTP 403.
});
```

Use the existing route test's `withAuth` and Supabase mock patterns. Keep the
tests focused on the GET handler and ensure the service query filters both
`project_id` and `document_id`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/api/script-workspace-route.test.ts
```

Expected: the new GET tests fail because the service function and GET handler
do not yet exist.

- [ ] **Step 3: Implement the minimal targeted lookup**

Add to `scriptWorkspaceService.ts`:

```ts
export async function isScriptWorkspaceDocument(
  supabase: SupabaseClient,
  { projectId, documentId }: { projectId: string; documentId: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from('script_workspace_documents')
    .select('document_id')
    .eq('project_id', projectId)
    .eq('document_id', documentId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}
```

Add a GET export beside the existing DELETE handler in the nested route. It
must authenticate through `withAuth`, call `getUserProjectRole` through the
existing `verifyProjectAccess` helper, call the targeted service, and return
`{ member: boolean }`. Map authorization failures to 403 and unexpected
service failures to the route's existing 500 error shape.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same Jest command. Expected: all existing and new Script workspace
route tests pass.

- [ ] **Step 5: Commit the isolated API change**

```bash
git add src/lib/script-system/scriptWorkspaceService.ts \
  'src/app/api/script-workspace/[projectId]/[documentId]/route.ts' \
  tests/unit/api/script-workspace-route.test.ts
git commit -m "feat: add targeted script workspace membership lookup"
```

### Task 2: Reuse the cached project role in document permissions

**Files:**
- Modify: `src/components/documents/useDocumentPermissions.ts`
- Test: `tests/unit/documents/document-permissions.test.ts`
- Test: `tests/unit/documents/document-editor-wiring.test.ts`

- [ ] **Step 1: Write the failing hook tests**

Extend the permission tests to cover a permission load where
`documentProjectId` is initially `null`, asserting that the hook can still
resolve the session and project role from `projectId` and that a later
cross-project document result is denied. Add a wiring assertion that the hook
imports and uses `useProjectRoleQuery`/`queryKeys.projectRole` rather than
calling `/api/projects/${projectId}/role` directly.

The behavior assertion should be expressed through the existing exported
`loadDocumentPermissions` helper where possible; do not weaken the existing
cross-project test.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx jest --runInBand tests/unit/documents/document-permissions.test.ts \
  tests/unit/documents/document-editor-wiring.test.ts
```

Expected: the new startup/caching assertions fail against the current hook.

- [ ] **Step 3: Implement shared role-query consumption**

Refactor `useDocumentPermissions` so that:

- it receives `projectId` and an optional `documentProjectId`;
- it obtains the authenticated user ID/session locally without making it a
  prerequisite for the document query;
- it uses `useProjectRoleQuery(projectId, userId)` and therefore the shared
  `queryKeys.projectRole` cache;
- its loading state remains true until the local session and role query settle;
- it returns the existing `role`, `readOnly`, `userId`, `accessToken`, and
  `userName` fields;
- it returns `This document does not belong to this project.` when a resolved
  document project differs from the route project;
- it does not issue a direct uncached fetch to the role endpoint.

Keep `loadDocumentPermissions` as a pure helper for existing tests and callers,
but make the React hook's startup path use the shared role query. Ensure effect
cleanup ignores stale session results after navigation.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Task 2 Jest command. Expected: all permission and editor wiring tests
pass.

- [ ] **Step 5: Commit the permission/cache change**

```bash
git add src/components/documents/useDocumentPermissions.ts \
  tests/unit/documents/document-permissions.test.ts \
  tests/unit/documents/document-editor-wiring.test.ts
git commit -m "perf: reuse cached project role during document startup"
```

### Task 3: Parallelize standard document startup

**Files:**
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/components/documents/DocumentEditor.module.css` only if the
  existing loading state needs no visual changes (avoid changing it otherwise)
- Test: `tests/unit/documents/document-editor-wiring.test.ts`

- [ ] **Step 1: Write the failing startup wiring test**

Add assertions that `DocumentEditor` passes the route `projectId` to the
permission hook before a document is available, keeps the document query
enabled by `documentId`, and no longer configures `refetchOnWindowFocus: true`.

- [ ] **Step 2: Run the test and verify RED**

```bash
npx jest --runInBand tests/unit/documents/document-editor-wiring.test.ts
```

Expected: the assertions fail because the current hook input depends on
`document?.project_id` and the query forces focus refetching.

- [ ] **Step 3: Make the minimal component change**

Change the permission hook call to pass `documentProjectId:
document?.project_id ?? null` while allowing the refactored hook to start from
`projectId`. Remove the document query's component-level
`refetchOnWindowFocus: true` override so the shared QueryProvider policy is
used. Do not change collaboration creation or editor props in this task.

- [ ] **Step 4: Run document-focused regression tests**

```bash
npx jest --runInBand tests/unit/documents/document-editor-wiring.test.ts \
  tests/unit/documents/document-editor-export.test.tsx \
  tests/unit/documents/document-collaboration-wiring.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit the standard-route change**

```bash
git add src/components/documents/DocumentEditor.tsx \
  tests/unit/documents/document-editor-wiring.test.ts
git commit -m "perf: parallelize standard document startup"
```

### Task 4: Replace Script workspace full-list guard with targeted query

**Files:**
- Create: `src/components/script-system/useScriptWorkspaceDocumentMembership.ts`
- Modify: `src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx`
- Modify: `src/components/script-system/useScriptSidebarActions.ts`
- Modify: `src/components/script-system/ImportDocumentationView.tsx`
- Test: `tests/unit/script-system/doc-route-guard.test.ts`
- Test: `tests/unit/script-system/script-context-menu.test.tsx`

- [ ] **Step 1: Write the failing membership-hook and route tests**

Add tests asserting that the Script document page queries
`/api/script-workspace/${projectId}/${documentId}`, uses a targeted query key,
and does not import/use `useScriptWorkspaceMembership` for the document guard.
Add a mutation wiring assertion that workspace add/remove invalidates both the
existing `['script-workspace', projectId]` key and the targeted key for the
affected document.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx jest --runInBand tests/unit/script-system/doc-route-guard.test.ts \
  tests/unit/script-system/script-context-menu.test.tsx
```

Expected: the new targeted-query assertions fail against the full-list guard.

- [ ] **Step 3: Implement the targeted membership hook**

Create a React Query hook with a stable key such as
`['script-workspace-document', projectId, documentId]`, a short stale time of
30 seconds, and a query function that treats `{ member: false }` as a valid
result while throwing for non-OK responses. Return `isMember`, `isLoading`,
`isFetching`, `isFetched`, and `isError` in the same style as the existing
membership hook.

Update the Script document page to use the targeted hook. Preserve the current
redirect behavior: wait until the query settles, redirect on a definitive
non-member result, show the existing verification toast on errors, and render
`DocumentEditor` only for a confirmed member. Since the query starts as soon as
the page mounts, it runs concurrently with the document and role queries inside
`DocumentEditor`.

Update add/remove/import invalidation paths to invalidate the affected targeted
key in addition to the full-list key.

- [ ] **Step 4: Run Script workspace regression tests**

```bash
npx jest --runInBand tests/unit/script-system/doc-route-guard.test.ts \
  tests/unit/script-system/script-context-menu.test.tsx \
  tests/unit/script-system/import-documentation-wiring.test.ts
```

Expected: all pass, including existing redirect and mutation behavior.

- [ ] **Step 5: Commit the Script startup change**

```bash
git add src/components/script-system/useScriptWorkspaceDocumentMembership.ts \
  'src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx' \
  src/components/script-system/useScriptSidebarActions.ts \
  src/components/script-system/ImportDocumentationView.tsx \
  tests/unit/script-system/doc-route-guard.test.ts \
  tests/unit/script-system/script-context-menu.test.tsx
git commit -m "perf: parallelize script document startup checks"
```

### Task 5: Full verification and type safety

**Files:**
- No production files unless a verification failure identifies a concrete
  issue.

- [ ] **Step 1: Run all focused document and Script tests**

```bash
npx jest --runInBand \
  tests/unit/api/script-workspace-route.test.ts \
  tests/unit/documents/document-permissions.test.ts \
  tests/unit/documents/document-editor-wiring.test.ts \
  tests/unit/documents/document-collaboration-wiring.test.ts \
  tests/unit/script-system/doc-route-guard.test.ts \
  tests/unit/script-system/script-context-menu.test.tsx \
  tests/unit/script-system/import-documentation-wiring.test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Run TypeScript checks**

```bash
npm run typecheck
npm run typecheck:api
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Inspect the final diff and working tree**

```bash
git diff --check HEAD~4..HEAD
git status --short
```

Confirm that only the planned files were changed by the implementation commits
and that the user's pre-existing unrelated worktree changes were not reverted
or included.

- [ ] **Step 4: Run the relevant end-to-end document smoke tests when Supabase
  credentials are available**

```bash
npx playwright test tests/e2e/specs/documents.spec.ts \
  tests/e2e/specs/document-collaboration.spec.ts
```

Expected: document navigation, access denial, editing, and collaboration flows
remain green. If credentials or a running app are unavailable, report that
limitation explicitly rather than inferring an end-to-end pass.
