# Project Storage Hierarchy And Assets Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair historical physical-storage accounting and make Account Storage browse project-root Folder, Table, Document, and Assets entries with recursive Folder sizes.

**Architecture:** A forward-only PostgreSQL migration imports attributable historical `storage.objects` into the canonical registry, refreshes entity bindings, and exposes a directory-aware aggregate RPC. The Next.js service/API passes a nullable parent Folder ID and validates breadcrumbs; the existing Account Storage component adds Folder navigation while retaining entity detail behavior.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Next.js App Router, TypeScript, React Query, Jest/Testing Library, Playwright.

## Global Constraints

- Do not edit the deployed `20260922120000_project_storage_entity_aggregation.sql`; add a migration with a later timestamp.
- Assets is one optional root entry controlled by `projects.assets_workspace_enabled`; it never appears inside a Folder.
- Each physical `(bucket_id, object_path)` contributes its authoritative Storage byte size exactly once.
- Folder rows recursively total descendant Table and Document entries; media remains detail-only.
- Search, sorting, and pagination apply to the current directory.
- Preserve project reader authorization, shared-project allowance behavior, physical upload quota enforcement, and cleanup accounting.
- The user explicitly waived TDD. Implement each task first, then add/run focused regression coverage before its review checkpoint.
- Preserve unrelated untracked workspace files and do not include them in commits.

---

## File Map

- Create `supabase/migrations/20260922180000_account_storage_hierarchy_and_historical_assets.sql`: historical object import, Assets existence repair, recursive directory aggregation, updated project summary, grants.
- Modify `src/lib/types/accountStorage.ts`: Folder entry kind and breadcrumb contract.
- Modify `src/lib/server/accountStorage.ts`: validate Folder entries/breadcrumbs and pass `p_parent_folder_id`.
- Modify `src/app/api/account/storage/projects/[projectId]/entities/route.ts`: accept nullable `parentFolderId`.
- Modify `src/components/account/AccountStorageSection.tsx`: breadcrumb state, Folder rendering/navigation, directory-aware query.
- Modify `src/components/account/AccountStorageSection.module.css`: breadcrumb and Folder-row presentation within existing layout.
- Modify focused unit/database/E2E tests listed by task.

### Task 1: Historical Object Repair And Directory RPC

**Files:**
- Create: `supabase/migrations/20260922180000_account_storage_hierarchy_and_historical_assets.sql`
- Modify: `tests/unit/database/account-project-storage-migration.test.ts`
- Modify: `tests/unit/database/account-project-storage.behavior.test.ts`

**Interfaces:**
- Consumes: `project_storage_files`, `project_storage_entity_bindings`, `private.storage_refresh_file_entity_binding(uuid)`, `private.storage_project_entities(uuid)`, `account_storage_summary()`.
- Produces: `account_storage_project_entities(uuid,text,text,integer,integer,uuid)` returning `{items,total,limit,offset,breadcrumb}`.

- [x] **Step 1: Add the forward-only repair migration**

Create an idempotent migration that:

1. Defines a private helper for safe Storage metadata size extraction.
2. Builds attribution candidates from native records first and known bucket path layouts second.
3. Inserts missing `(bucket_id, object_path)` objects into `project_storage_files` using the owning project's `owner_id`, object metadata MIME type/size, and the specific source kind available.
4. Adds `project_storage_file_locations` rows for imported project objects.
5. Enables `assets_workspace_enabled` for projects with standalone asset records or files canonically bound to Assets.
6. Refreshes every active entity binding and calls the existing quota-total rebuild logic internally.
7. Replaces the entity-directory RPC with a six-argument signature whose final parameter is `p_parent_folder_id uuid default null`.
8. Uses a recursive Folder CTE to calculate each Folder's logical, physical, and total descendant bytes.
9. Emits only direct children for the requested directory and a root-only Assets entry based on workspace existence, including `0 B`.
10. Returns a root-to-current breadcrumb array and rejects a parent Folder outside the requested project.
11. Replaces `account_storage_summary()` so project item counts include each Folder, Table, Document, and enabled Assets workspace once while used bytes remain the canonical logical plus physical total.
12. Revokes private helpers from API roles and grants only the public reader RPC to `authenticated`.

- [x] **Step 2: Add static migration contract coverage**

Assert the new SQL includes the later migration, `storage.objects` metadata import, conflict-safe registry writes, binding refresh, recursive Folder ancestry/descendant CTEs, root-only Assets existence logic, the new RPC parameter, breadcrumb JSON, item-count calculation, and explicit revoke/grant statements.

- [x] **Step 3: Add live database behavior coverage**

Extend the PostgreSQL behavior suite to create nested Folders, a child Table with one physical media object, a child Document, an enabled empty Assets workspace, and an unregistered historical Storage object. Assert:

```ts
expect(rootKinds).toEqual(expect.arrayContaining(['folder', 'assets']));
expect(folder.sizeBytes).toBe(childTable.sizeBytes + childDocument.sizeBytes);
expect(folderPage.breadcrumb.map((part) => part.id)).toEqual([folderId]);
expect(folderPage.items.some((item) => item.kind === 'assets')).toBe(false);
expect(emptyAssets.sizeBytes).toBe(0);
expect(importedRegistryRow.size_bytes).toBe(authoritativeObjectBytes);
```

Run the repair logic twice and assert registry counts and quota totals do not change on the second run.

- [x] **Step 4: Run database verification**

Run:

```bash
npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts
npm run test:db -- --runInBand tests/unit/database/account-project-storage.behavior.test.ts
```

Expected: all Account Storage migration and live behavior tests pass.

- [ ] **Step 5: Review and commit the database task**

Inspect the SQL for ownership ambiguity, duplicate counting, unsafe SECURITY DEFINER search paths, API-role grants, and migration idempotency. Commit only the migration and its focused tests:

```bash
git add supabase/migrations/20260922180000_account_storage_hierarchy_and_historical_assets.sql tests/unit/database/account-project-storage-migration.test.ts tests/unit/database/account-project-storage.behavior.test.ts
git commit -m "fix: repair hierarchical account storage totals"
```

### Task 2: Directory-Aware Type, Service, And API Contract

**Files:**
- Modify: `src/lib/types/accountStorage.ts`
- Modify: `src/lib/server/accountStorage.ts`
- Modify: `src/app/api/account/storage/projects/[projectId]/entities/route.ts`
- Modify: `tests/unit/account/account-storage-service.test.ts`
- Modify: `tests/unit/account/account-storage-entities-route.test.ts`

**Interfaces:**
- Consumes: the six-argument `account_storage_project_entities` RPC from Task 1.
- Produces: `AccountStorageEntryKind`, `AccountStorageBreadcrumb`, and `readProjectStorageEntities(..., { parentFolderId })`.

- [ ] **Step 1: Evolve shared TypeScript contracts**

Define:

```ts
export type AccountStorageEntryKind = 'folder' | 'table' | 'document' | 'assets';
export type AccountStorageEntityKind = Exclude<AccountStorageEntryKind, 'folder'>;
export type AccountStorageBreadcrumb = { id: string; name: string };
```

Change the list entry to use `AccountStorageEntryKind`, rename its placement field to `parentFolderId`, and require `breadcrumb: AccountStorageBreadcrumb[]` on `AccountStorageEntityPage`. Keep detail requests restricted to `AccountStorageEntityKind`.

- [ ] **Step 2: Validate and forward directory state in the server service**

Add strict readers for Folder list rows and breadcrumb parts. Extend the service input with `parentFolderId?: string | null`, validate it as UUID when non-null, and call:

```ts
client.rpc('account_storage_project_entities', {
  p_project_id: projectId,
  p_query: query,
  p_sort: sort,
  p_limit: limit,
  p_offset: offset,
  p_parent_folder_id: parentFolderId,
});
```

Reject malformed breadcrumbs, Folder detail kinds, unsafe integers, and mismatched logical plus physical totals exactly as the current readers reject malformed entity payloads.

- [ ] **Step 3: Add API query validation**

Accept an optional UUID `parentFolderId` query parameter, normalize absence to null, pass it to `readProjectStorageEntities`, and retain strict rejection of unknown parameters.

- [ ] **Step 4: Add and run service/API tests**

Cover root null forwarding, child Folder UUID forwarding, Folder row parsing, breadcrumb parsing, invalid parent IDs, malformed Folder payloads, and the rule that Folder cannot be requested from the detail route.

Run:

```bash
npx jest --runInBand tests/unit/account/account-storage-service.test.ts tests/unit/account/account-storage-entities-route.test.ts
npx tsc --noEmit
```

Expected: focused Jest suites and TypeScript validation pass.

- [ ] **Step 5: Review and commit the contract task**

```bash
git add src/lib/types/accountStorage.ts src/lib/server/accountStorage.ts src/app/api/account/storage/projects/'[projectId]'/entities/route.ts tests/unit/account/account-storage-service.test.ts tests/unit/account/account-storage-entities-route.test.ts
git commit -m "feat: expose account storage directories"
```

### Task 3: Account Storage Folder Navigation

**Files:**
- Modify: `src/components/account/AccountStorageSection.tsx`
- Modify: `src/components/account/AccountStorageSection.module.css`
- Modify: `tests/unit/account/account-storage-section.test.tsx`

**Interfaces:**
- Consumes: Task 2's directory page and breadcrumb contract.
- Produces: root/Folder navigation while preserving Table/Document/Assets detail behavior.

- [ ] **Step 1: Add current-directory state and fetching**

Track `currentFolderId: string | null`. Include it in the React Query key and request URL. Reset it on project changes. On Folder navigation, clear selected detail, search/debounced search, and offset; preserve sort. Generate breadcrumb controls from the response rather than local Folder guesses.

- [ ] **Step 2: Render Folder entries and breadcrumbs**

Use the existing Ant Design `FolderOutlined` and `RightOutlined` icons. Folder rows display `Folder · <created date>` and recursive size. Clicking a Folder calls directory navigation; clicking Table, Document, or Assets selects the detail pane. Breadcrumb buttons navigate to root or an ancestor Folder.

Update accessible text to:

```text
Search folders, tables, documents, assets
Project storage path
```

Do not render an Open Folder detail action and do not render media in the directory list.

- [ ] **Step 3: Add responsive breadcrumb styling**

Add a single-line, horizontally scrollable breadcrumb above the toolbar with stable height and visible focus states. Reuse existing row spacing/colors; do not introduce cards or nested panels. Confirm long Folder names truncate without overlapping sort/search controls.

- [ ] **Step 4: Add and run component tests**

Cover:

- root entries containing Folder and one Assets row;
- Folder click requests `parentFolderId` and does not open detail;
- breadcrumb root/ancestor navigation;
- no Assets row injected into child responses;
- Table/Document/Assets details still load and source navigation remains unchanged;
- project switching resets to root;
- Folder errors preserve path and Retry refetches the same directory.

Run:

```bash
npx jest --runInBand tests/unit/account/account-storage-section.test.tsx
npx tsc --noEmit
```

Expected: component suite and TypeScript validation pass.

- [ ] **Step 5: Review and commit the UI task**

```bash
git add src/components/account/AccountStorageSection.tsx src/components/account/AccountStorageSection.module.css tests/unit/account/account-storage-section.test.tsx
git commit -m "feat: browse account storage folders"
```

### Task 4: End-To-End Regression And Full Review

**Files:**
- Modify: `tests/e2e/helpers/account-storage.ts`
- Modify: `tests/e2e/specs/account-storage.spec.ts`

**Interfaces:**
- Consumes: complete database, API, and UI implementation.
- Produces: browser-level proof for hierarchical totals and root Assets behavior.

- [ ] **Step 1: Extend E2E fixtures**

Return a root page containing a Folder and Assets, a child page containing Table and Document, stable breadcrumbs, and detail responses whose item totals equal their rows. Record `parentFolderId` query values so assertions prove root and child requests.

- [ ] **Step 2: Add browser behavior coverage**

Verify selecting a project shows Folder and Assets, opening Folder shows only its direct Table/Document entries, breadcrumbs return to root, Assets remains root-only, detail panes still open, and search/sort are forwarded for the active directory.

- [ ] **Step 3: Run the complete focused verification set**

Run:

```bash
npx jest --runInBand tests/unit/account tests/unit/database/account-project-storage-migration.test.ts tests/unit/scripts/backfill-account-storage.test.ts tests/unit/scripts/reconcile-account-storage.test.ts
npm run test:db -- --runInBand tests/unit/database/account-project-storage.behavior.test.ts
npx playwright test tests/e2e/specs/account-storage.spec.ts --project=chromium
npx tsc --noEmit
npm run build
```

Expected: every command exits 0 with no Account Storage regression.

- [ ] **Step 4: Perform code review**

Review the complete diff for severity-ranked correctness issues, especially double counting, historical attribution ambiguity, Folder recursion boundaries, Assets root visibility, API authorization, unsafe grants, stale React Query keys, mobile overflow, and unrelated-file inclusion. Fix verified findings and rerun affected tests.

- [ ] **Step 5: Commit E2E and review fixes**

```bash
git add tests/e2e/helpers/account-storage.ts tests/e2e/specs/account-storage.spec.ts
git commit -m "test: cover hierarchical account storage"
```

### Task 5: Push, Merge, Deploy, And Production Verification

**Files:**
- No source files unless CI or production verification reveals a reproducible defect.

**Interfaces:**
- Consumes: reviewed branch with all local checks passing.
- Produces: merged production deployment and observed corrected Account Storage output.

- [ ] **Step 1: Push the branch and open a PR**

Push `account-storage-hierarchy-assets-fix`, open a PR against `main`, and include the root cause, migration safety, exact verification commands, and expected `hello` production outcome.

- [ ] **Step 2: Wait for required checks and review results**

Inspect every required workflow. For a failure, read the exact failing job/log, reproduce it locally when possible, fix only the root cause, rerun affected local checks, push, and wait for green again.

- [ ] **Step 3: Merge only after green**

Merge the PR after required checks and deployment prerequisites succeed. Record the PR number and merge commit.

- [ ] **Step 4: Verify production workflows**

Confirm the production Supabase migration, Vercel deployment, and relevant Edge Function workflows all complete successfully. Verify the new migration is applied rather than merely seeing a successful application deploy.

- [ ] **Step 5: Verify through Windows Keco Studio**

Use `E:\\Keco Studio\\bin\\keco-studio.exe` to open the production Account Storage page. Confirm `hello` shows root Folder rows, one root Assets row when its workspace is enabled, materially corrected real-media totals, Folder drill-down/breadcrumb navigation, and detail-only media. Capture the observed totals and any remaining unattributed legacy count in the final report.
