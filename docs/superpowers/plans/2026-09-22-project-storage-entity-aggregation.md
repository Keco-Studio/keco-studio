# Project Storage Entity Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Account storage show one row per Table, one row per Document, and at most one Assets row, with each row including the actual bytes of its owned media exactly once.

**Architecture:** Keep `project_storage_files` as the physical-byte authority and `project_storage_logical_files` as the logical-byte authority. Add a canonical physical-file-to-entity binding table, derive bindings at the database boundary, expose aggregate summary/detail RPCs, and replace the raw file UI with entity rows plus a read-only detail pane.

**Tech Stack:** PostgreSQL/Supabase migrations and RPCs, Next.js App Router, TypeScript, React Query, Vitest, Playwright.

## Global Constraints

- Use a new forward-only migration; do not edit deployed migrations.
- Do not change physical upload quota enforcement or quota counter semantics.
- Count each physical `(bucket_id, object_path)` registry row once.
- Attribution precedence is Document, then lexicographically smallest Table UUID, then project Assets.
- The top-level project list contains only Table, Document, and Assets aggregate rows.
- Implement first and add or update tests afterward, per the user's explicit instruction not to use TDD.
- Preserve unrelated untracked and modified files.

---

### Task 1: Canonical storage entity bindings and aggregate RPCs

**Files:**
- Create: `supabase/migrations/20260922120000_project_storage_entity_aggregation.sql`

**Interfaces:**
- Produces: `project_storage_entity_bindings`, `private.storage_refresh_file_entity_binding(uuid)`, `private.storage_refresh_project_entity_bindings(uuid)`, `account_storage_project_entities(uuid,text,text,integer,integer)`, and `account_storage_entity_details(uuid,text,uuid)`.
- Updates: `account_storage_summary()` so project counts and totals use visible aggregate entities.

- [x] **Step 1: Add the canonical binding relation and indexes**

Create one row per physical registry file with `entity_kind`, `entity_id`, optional `detail_entity_id`, provenance, and timestamps. Enforce one binding per `file_id`, constrain kinds to `document`, `table`, and `assets`, and cascade on physical-file deletion.

- [x] **Step 2: Add deterministic attribution refresh functions and triggers**

Resolve valid document ownership first, then inspect `library_asset_values.value_json` for exact `path`/`bucket` references and select the smallest matching library UUID, then bind the remainder to the project Assets entity. Refresh affected files after physical-registry and table-cell writes.

- [x] **Step 3: Backfill all active project files**

Populate bindings for existing registered objects without fetching URLs or guessing byte sizes. Ensure every active project file ends with exactly one binding and unassigned legacy rows remain account-level.

- [x] **Step 4: Add aggregate entity and detail RPCs**

Return exact camelCase JSON contracts, enforce `storage_require_reader`, support existing search/sort/pagination rules, and build detail items whose bytes sum to the entity subtotal.

- [x] **Step 5: Replace project summary arithmetic**

Calculate each project `fileCount` from visible Table, Document, and optional Assets rows and `usedBytes` from logical plus bound physical bytes. Preserve owned/shared visibility and owner-only account charging.

### Task 2: Server contracts and authenticated routes

**Files:**
- Modify: `src/lib/types/accountStorage.ts`
- Modify: `src/lib/server/accountStorage.ts`
- Create: `src/app/api/account/storage/projects/[projectId]/entities/route.ts`
- Create: `src/app/api/account/storage/projects/[projectId]/entities/[kind]/[entityId]/route.ts`
- Remove after callers migrate: `src/app/api/account/storage/projects/[projectId]/files/route.ts`

**Interfaces:**
- Produces: `AccountStorageEntity`, `AccountStorageEntityPage`, `AccountStorageEntityDetail`, `readProjectStorageEntities()`, and `readProjectStorageEntityDetail()`.
- Consumes: the two new aggregate RPCs from Task 1.

- [x] **Step 1: Define exact entity and detail types**

Model entity kind, logical/physical/total bytes, folder, timestamps, source availability, and detail groups/items without exposing raw storage paths as top-level rows.

- [x] **Step 2: Parse RPC payloads defensively**

Validate exact object shapes, UUIDs, safe non-negative integers, timestamps, entity-kind constraints, pagination, and forbidden-project errors.

- [x] **Step 3: Add route handlers**

Follow the existing authenticated route response/error conventions. Validate path/query parameters and return `403`, `400`, or `500` consistently with current Account storage behavior.

### Task 3: One-level entity explorer with detail pane

**Files:**
- Modify: `src/components/account/AccountStorageSection.tsx`
- Modify: `src/components/account/AccountStorageSection.module.css`

**Interfaces:**
- Consumes: `/api/account/storage/projects/:projectId/entities` and `/api/account/storage/projects/:projectId/entities/:kind/:entityId`.
- Produces: a flat entity list and retryable read-only detail pane.

- [x] **Step 1: Replace raw-file fetching and validation**

Load aggregate entity pages, keep project selection/search/sort/pagination behavior, and reset selected detail when the project or query context changes.

- [x] **Step 2: Render only Table, Document, and Assets rows**

Show entity name/type/aggregate size and open details on row activation. Navigate Table, Document, and Assets to their existing source destinations only through the explicit open-source action.

- [x] **Step 3: Add the detail pane states**

Show entity subtotal, logical/physical split, grouped breakdown, loading, failure/retry, empty state, and close behavior. Keep the main list one level deep and do not render actual media as sibling rows.

- [x] **Step 4: Add responsive styling**

Use the existing account visual language, stable row/control sizes, an unframed desktop pane and mobile drawer behavior, and prevent text/control overlap.

### Task 4: Reconciliation and regression coverage

**Files:**
- Modify: `scripts/backfill-account-storage.ts`
- Modify: `scripts/reconcile-account-storage.ts`
- Modify: `tests/unit/database/account-project-storage-migration.test.ts`
- Modify: `tests/unit/database/account-project-storage.behavior.test.ts`
- Modify: `tests/unit/account/account-storage-service.test.ts`
- Modify: `tests/unit/account/account-storage-section.test.tsx`
- Replace: `tests/unit/account/account-storage-files-route.test.ts`
- Modify: `tests/e2e/helpers/account-storage.ts`
- Modify: `tests/e2e/specs/account-storage.spec.ts`

**Interfaces:**
- Consumes: the binding table, aggregate RPCs, routes, and UI delivered above.
- Produces: drift detection/repair and regression evidence for accounting and presentation.

- [x] **Step 1: Extend operational reconciliation**

Report missing, stale, and conflicting bindings and repair them only through the canonical database refresh function. Keep dry-run behavior intact.

- [x] **Step 2: Add migration and real-Postgres behavior coverage**

Prove one Table with multiple rows/media appears once, Documents include image bytes, standalone objects form one Assets row, duplicate references charge once, unbound files fall back to Assets, folders do not change totals, and shared projects do not charge collaborators.

- [x] **Step 3: Update service, route, component, and E2E coverage**

Assert exact contracts, validation failures, forbidden access, entity-only top-level rendering, detail open/close/retry, source navigation, search/sort/pagination, and responsive states.

### Task 5: Verification, review, push, merge, and production inspection

**Files:**
- Review: all files changed by Tasks 1-4

**Interfaces:**
- Produces: reviewed commit(s), a green CI branch, merged mainline change, and production verification notes.

- [x] **Step 1: Run focused tests and static checks**

Run the Account storage unit/database tests, TypeScript checks, lint for touched files, migration verification, and relevant Playwright flow. Record any environment-limited checks explicitly.

- [x] **Step 2: Review the complete diff**

Check aggregate arithmetic, ownership/authorization, deduplication, API/type agreement, trigger recursion/performance, responsive UI, and preservation of existing quota behavior. Fix every confirmed finding and rerun affected checks.

- [ ] **Step 3: Commit and push the branch**

Stage only intended files, commit with scoped messages, push `ci-always-run-branch-migrations`, and inspect the pushed diff.

- [ ] **Step 4: Wait for green CI and merge**

Monitor required checks to completion, repair failures within scope, merge only after all required checks pass, and verify the merge commit on the target branch.

- [ ] **Step 5: Inspect production**

Locate the Windows `E:` Keco Studio runtime or checkout, run the production build/site through its established workflow, and verify the account storage summary, entity list, detail totals, and navigation against live data without mutating unrelated production data.
