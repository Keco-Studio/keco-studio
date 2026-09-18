# Project Logical Storage Accounting Implementation Plan

> **For agentic workers:** Execute tasks in order and review the complete diff after implementation. The user explicitly requested no TDD; add regression coverage after production changes and run it as a unified verification pass.

**Goal:** Count documents, library tables, and physical project files in Account storage while leaving existing upload quota enforcement based only on physical bytes.

**Architecture:** Add a private logical-file registry and a separate cached logical byte counter. Database triggers recompute deterministic document and library sizes, read RPCs union logical and physical rows, and reconciliation validates both counters without treating Postgres content as a physical Storage object.

**Tech Stack:** PostgreSQL/PL/pgSQL, Supabase, Next.js 16, React 19, TypeScript 5.9, Jest 30, Playwright.

## Global Constraints

- Do not add quota rejection to document or library writes.
- Do not include logical bytes in the physical upload reservation predicate.
- Count UTF-8 bytes using deterministic representations.
- Do not double-count uploaded binary attachments.
- Use a new forward-only migration; do not edit applied migrations.
- Preserve private accounting tables, RLS, grants, advisory locks, and security-definer search paths.
- Preserve unrelated worktree changes, especially `.superpowers/brainstorm/`.
- Run the repository Chinese-text gate before push.

---

### Task 1: Add The Logical File Registry And Counter

**Files:**
- Create: `supabase/migrations/20260918030000_project_logical_storage_accounting.sql`
- Modify: `tests/unit/database/account-project-storage-migration.test.ts`

**Interfaces:**
- Produces table `public.project_storage_logical_files`.
- Produces `private.storage_document_logical_size(uuid)` and `private.storage_library_logical_size(uuid)`.
- Produces source-sync and counter-settlement trigger functions.
- Adds `account_storage_quotas.logical_used_bytes bigint`.

- [ ] **Step 1: Create the forward migration**

Define the registry with unique source identity and private access:

```sql
create table public.project_storage_logical_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('document_content', 'library_table')),
  source_entity_id uuid not null,
  display_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (source_kind, source_entity_id)
);
```

Add `logical_used_bytes`, enable RLS, revoke direct access, and add owner/project indexes.

- [ ] **Step 2: Implement deterministic sizing**

Document size uses the Markdown body's UTF-8 length. Library size builds stable
JSONB arrays ordered by field order/ID and row order/ID. It includes only the
editable columns enumerated in the design and cell `value_json`.

- [ ] **Step 3: Install source synchronization triggers**

Replace `trg_sync_document_content_storage` with a trigger that upserts every
document, including empty documents. Add triggers on `libraries`,
`library_field_definitions`, `library_assets`, and `library_asset_values` that
resolve the affected library and recompute its registry row.

- [ ] **Step 4: Move existing document accounting safely**

Drop the old document settlement trigger before counter conversion. Backfill
documents and libraries into the new registry, then rebuild:

```sql
update public.account_storage_quotas quota
set used_bytes = coalesce((
      select sum(file.size_bytes)
      from public.project_storage_files file
      where file.owner_id = quota.owner_id
        and file.lifecycle_status in ('active', 'pending_cleanup')
    ), 0),
    logical_used_bytes = coalesce((
      select sum(file.size_bytes)
      from public.project_storage_logical_files file
      where file.owner_id = quota.owner_id
    ), 0);
```

Drop the obsolete `project_storage_document_content` table only after the new
registry is populated.

- [ ] **Step 5: Update the migration contract test**

Assert the new table, RLS/revokes, logical counter, trigger coverage, canonical
size functions, backfill, and physical-only quota predicate.

---

### Task 2: Return Unified Summary And File Listings

**Files:**
- Modify: `supabase/migrations/20260918030000_project_logical_storage_accounting.sql`
- Modify: `src/lib/types/accountStorage.ts`
- Modify: `src/lib/server/accountStorage.ts`
- Modify: `src/components/account/AccountStorageSection.tsx`
- Modify: `tests/unit/account/account-storage-service.test.ts`
- Modify: `tests/unit/account/account-storage-route.test.ts`
- Modify: `tests/unit/account/account-storage-section.test.tsx`

**Interfaces:**
- Extends `AccountStorageSummary` with `physicalUsedBytes`, `logicalUsedBytes`, and `overageBytes`.
- Extends `StorageSourceKind` with `library_table`.
- Keeps `usedBytes` as the displayed total.

- [ ] **Step 1: Replace account summary RPC**

Calculate owner and project totals as physical plus logical bytes. Sort owned
projects by total bytes descending. Return safe remaining and overage values:

```sql
'usedBytes', v_physical_used + v_logical_used,
'physicalUsedBytes', v_physical_used,
'logicalUsedBytes', v_logical_used,
'remainingBytes', greatest(v_quota.quota_bytes
  - v_physical_used - v_logical_used - v_quota.reserved_bytes, 0),
'overageBytes', greatest(v_physical_used + v_logical_used
  + v_quota.reserved_bytes - v_quota.quota_bytes, 0)
```

- [ ] **Step 2: Replace project file-list RPC**

Union active physical registry rows with logical registry rows before search,
sort, count, and pagination. Derive physical `sourceAvailable` with the existing
location check; logical source availability is guaranteed by foreign-key-backed
source triggers.

- [ ] **Step 3: Update strict TypeScript parsers**

Parse all new exact fields, accept `library_table`, keep non-negative safe
integer validation, and preserve forbidden-project error mapping.

- [ ] **Step 4: Update Account presentation**

Show total used plus a compact physical/logical breakdown. Show zero remaining
and an overage amount when exceeded. Route `library_table` rows to
`/${projectId}/${libraryId}`. Do not add copy implying logical writes are quota
blocked.

- [ ] **Step 5: Update service, route, and UI tests**

Cover mixed totals, overage responses, table routing, logical file rendering,
source-unavailable physical files, size-desc project ordering, and exact API
shape validation.

---

### Task 3: Repair Reconciliation And Backfill Reporting

**Files:**
- Modify: `scripts/reconcile-account-storage.ts`
- Modify: `scripts/backfill-account-storage.ts`
- Modify: `tests/unit/scripts/reconcile-account-storage.test.ts`
- Modify: `tests/unit/scripts/backfill-account-storage.test.ts`

**Interfaces:**
- Adds `RegisteredLogicalFile` to reconciliation.
- Reports `physicalQuotaMismatches` and `logicalQuotaMismatches` separately.
- Keeps physical object inventory parity independent from logical rows.

- [ ] **Step 1: Load logical registry rows**

Read `project_storage_logical_files(owner_id,size_bytes)` and
`account_storage_quotas.logical_used_bytes` in native mode. Keep injected test
clients backwards-compatible through explicit logical-list hooks.

- [ ] **Step 2: Compare counters independently**

Expected physical usage comes only from `project_storage_files`; expected
logical usage comes only from `project_storage_logical_files`. Do not compare
logical rows against Supabase Storage inventory.

- [ ] **Step 3: Keep repair idempotent**

Call `service_rebuild_account_storage_quota_totals()` when either counter
drifts. Update the report text so a second report after repair returns zero
counter mismatches.

- [ ] **Step 4: Clarify backfill output**

Rename/report the backfill byte total as physical bytes so operators do not
mistake it for total displayed account usage.

- [ ] **Step 5: Update script tests**

Cover correct mixed counters, document/table logical bytes, actual physical
drift, actual logical drift, and repeatable repair behavior.

---

### Task 4: Validate Real Database Behavior

**Files:**
- Modify: `tests/unit/database/account-project-storage.behavior.test.ts`
- Modify: `tests/e2e/helpers/account-storage.ts`
- Modify: `tests/e2e/specs/account-storage.spec.ts`

**Interfaces:**
- Verifies triggers rather than client-maintained accounting.

- [ ] **Step 1: Extend real-Postgres behavior coverage**

Create a document and a library with fields, rows, and JSON cell values. Assert
registry rows and account logical totals update after insert, edit, move, and
delete. Assert no logical edit returns `STORAGE_QUOTA_EXCEEDED`.

- [ ] **Step 2: Cover migration conversion**

Assert physical `used_bytes` excludes document/table content after the new
migration and `logical_used_bytes` equals the registry sum.

- [ ] **Step 3: Update browser fixtures and E2E**

Show document/table logical rows, the total breakdown, and overage state. Keep
shared-project exclusion and mobile stacking coverage.

---

### Task 5: Unified Review, Migration Verification, And Delivery

**Files:**
- Review all modified files.

- [ ] **Step 1: Run focused tests**

```bash
npx jest --runInBand \
  tests/unit/database/account-project-storage-migration.test.ts \
  tests/unit/database/account-project-storage.behavior.test.ts \
  tests/unit/account/account-storage-service.test.ts \
  tests/unit/account/account-storage-route.test.ts \
  tests/unit/account/account-storage-section.test.tsx \
  tests/unit/scripts/reconcile-account-storage.test.ts \
  tests/unit/scripts/backfill-account-storage.test.ts
```

- [ ] **Step 2: Run static and repository gates**

```bash
npm run typecheck
npm run typecheck:api
npm run check:storage-writes
```

Discover and run the repository's Chinese-text gate from CI/package scripts;
do not invent a substitute that scans different files.

- [ ] **Step 3: Validate migrations locally**

Run the migration on the existing local database, inspect counter parity, then
perform a local Supabase reset after confirming the target is `127.0.0.1`.
Re-run real-Postgres tests against the reset schema.

- [ ] **Step 4: Run Account browser E2E**

Start the application on an available port and run
`tests/e2e/specs/account-storage.spec.ts` against desktop and mobile projects.

- [ ] **Step 5: Review the complete diff**

Check security-definer grants, migration ordering, counter invariants, exact API
contracts, user-visible copy, and unrelated worktree preservation. Fix all
findings before delivery.

- [ ] **Step 6: Commit and push**

Commit implementation and verification changes to `sum-storage`, push to
`origin/sum-storage`, then inspect CI status.

- [ ] **Step 7: Merge only when green**

Create or update the pull request into `main`. Merge only after every required
check reports success; do not bypass branch protection or required gates.
