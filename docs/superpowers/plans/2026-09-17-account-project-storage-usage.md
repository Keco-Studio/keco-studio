# Account Project Storage Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accurate per-account and per-project physical-file usage to Account, provide a read-only two-pane file explorer, and atomically prevent every project upload from exceeding the project owner's 1 TB allowance.

**Architecture:** A private physical-file registry and quota cache are maintained by atomic reservation/finalization RPCs. Authenticated APIs expose only the signed-in account summary and authorized project files; every browser, MCP, map, character, and import upload path must reserve before writing and finalize from verified Storage metadata. Idempotent backfill and reconciliation commands establish and continuously check parity with Supabase Storage.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, TanStack Query, Supabase Postgres/Auth/Storage, PostgreSQL PL/pgSQL, Jest 30, Testing Library, Playwright, Deno tests for Edge Functions.

## Global Constraints

- Count physical Supabase Storage objects only; never count Postgres rows or document text.
- Default quota is exactly `1,099,511,627,776` bytes and is displayed as `1 TB` / `1,024 GB`.
- Owned projects and unassigned legacy files count toward the signed-in owner's quota; shared projects are visible but excluded from that user's total.
- Collaborator uploads consume and enforce the project owner's quota.
- Permit `used + reserved + requested === quota`; reject only values greater than quota.
- Viewer and pending-collaborator access must not reserve or upload.
- The Account browser is read-only; cleanup remains source-aware and releases bytes only after physical deletion succeeds.
- The 80% and 95% warning thresholds are fixed product constants for this release.
- Account/API failures never render a false zero value, and quota-service failures fail closed for uploads.
- Every accounted upload path must use the common reservation contract before enforcement is enabled.
- Follow TDD: observe each new test fail for the intended reason before adding production code.
- Do not commit `.superpowers/brainstorm/`.

---

## File and Responsibility Map

### Database and commands

- Create `supabase/migrations/20260917010000_account_project_storage_usage.sql`: tables, indexes, RLS/grants, summary/file-list RPCs, reservation/finalization/release RPCs, cleanup settlement, and library-media path policy.
- Create `scripts/backfill-account-storage.ts`: report/apply historical physical-object attribution and rebuild cached totals.
- Create `scripts/reconcile-account-storage.ts`: compare registry, reservations, quota caches, and actual objects; repair only safe drift.
- Create `scripts/check-accounted-storage-writes.ts`: fail CI when an unapproved direct write to an accounted bucket appears.
- Modify `package.json`: add `storage:backfill`, `storage:reconcile`, and `check:storage-writes` commands.

### Shared application contracts

- Create `src/lib/types/accountStorage.ts`: API types, sort/source unions, constants, and strict browser-side guards.
- Create `src/lib/server/accountStorage.ts`: strict RPC response parsers and Account read service.
- Create `src/lib/server/storageQuota.ts`: reservation/finalization/release wrappers and stable domain errors for Node routes/services.
- Create `supabase/functions/_shared/storage-quota.ts`: Deno-compatible wrappers with the same RPC names and error-code mapping.

### Account APIs and UI

- Create `src/app/api/account/storage/route.ts`: private no-store owner/project summary.
- Create `src/app/api/account/storage/projects/[projectId]/files/route.ts`: validated search/sort/pagination endpoint.
- Create `src/components/account/AccountStorageSection.tsx` and `AccountStorageSection.module.css`: quota summary, project explorer, file table, loading/stale/error states, and source navigation.
- Modify `src/app/(dashboard)/account/page.tsx` and `src/components/account/AccountEmailSettings.module.css`: insert Storage after Credits and allow the approved wider layout.

### Upload and cleanup integration

- Modify `src/app/api/projects/[projectId]/game-assets/route.ts`: reserve on prepare, carry reservation IDs, finalize verified objects, and release failures.
- Modify `src/lib/services/mediaFileUploadService.ts`, `src/components/media/MediaFileUpload.tsx`, library component callers, and document-image callers: require a project ID and use project-aware upload paths/reservations.
- Modify `supabase/functions/mcp/write-tools.ts`: reserve/finalize/release MCP image and project-asset uploads.
- Modify `src/lib/server/createMapReferenceService.ts`, `supabase/functions/pixellab-map/storage.ts`, and `supabase/functions/pixellab-character/storage.ts`: enforce owner quota for reference and generated assets.
- Modify `src/lib/server/projectDeletion.ts` and the deletion RPC in the new migration: enqueue every registered project object and settle usage only after successful removal.

---

### Task 1: Create the Storage Accounting Schema and Atomic Quota RPCs

**Files:**
- Create: `supabase/migrations/20260917010000_account_project_storage_usage.sql`
- Create: `tests/unit/database/account-project-storage-migration.test.ts`
- Create: `tests/unit/database/account-project-storage.behavior.test.ts`

**Interfaces:**
- Produces tables: `account_storage_quotas`, `project_storage_files`, `project_storage_file_locations`, `storage_upload_reservations`.
- Produces authenticated RPCs:
  - `reserve_project_storage_upload(p_project_id uuid, p_bucket_id text, p_object_path text, p_expected_bytes bigint, p_display_name text, p_mime_type text, p_source_kind text, p_source_entity_id uuid default null) returns jsonb`
  - `finalize_project_storage_upload(p_reservation_id uuid, p_actual_bytes bigint, p_source_entity_id uuid default null, p_object_created_at timestamptz default null) returns jsonb`
  - `release_project_storage_upload(p_reservation_id uuid) returns jsonb`
  - `account_storage_summary() returns jsonb`
  - `account_storage_project_files(p_project_id uuid, p_query text default null, p_sort text default 'size_desc', p_limit integer default 50, p_offset integer default 0) returns jsonb`
- Produces service-role wrappers with an explicit trusted actor: `service_reserve_project_storage_upload(...)`, `service_finalize_project_storage_upload(...)`, and `service_release_project_storage_upload(...)`.
- Produces stable SQLSTATE/detail code strings: `STORAGE_QUOTA_EXCEEDED`, `STORAGE_PROJECT_FORBIDDEN`, `STORAGE_RESERVATION_EXPIRED`, and `STORAGE_OBJECT_MISMATCH`.

- [ ] **Step 1: Write the migration contract test**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260917010000_account_project_storage_usage.sql',
), 'utf8');

describe('account project storage migration', () => {
  it('defines private quota, file, location, and reservation tables', () => {
    for (const table of [
      'account_storage_quotas',
      'project_storage_files',
      'project_storage_file_locations',
      'storage_upload_reservations',
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    }
    expect(sql).toMatch(/default 1099511627776/i);
    expect(sql).toMatch(/unique\s*\(bucket_id,\s*object_path\)/i);
    expect(sql).toMatch(/revoke all on table public\.account_storage_quotas from public, anon, authenticated/i);
  });

  it('defines atomic authenticated and service-role quota functions', () => {
    expect(sql).toMatch(/function public\.reserve_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.finalize_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.release_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.service_reserve_project_storage_upload\(/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/used_bytes\s*\+\s*reserved_bytes\s*\+\s*p_expected_bytes\s*>\s*quota_bytes/i);
    expect(sql).toMatch(/STORAGE_QUOTA_EXCEEDED/i);
  });
});
```

- [ ] **Step 2: Run the contract test and verify the missing migration failure**

Run: `npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts`

Expected: FAIL because `20260917010000_account_project_storage_usage.sql` does not exist.

- [ ] **Step 3: Write SQL behavior tests for boundary and isolation rules**

Use the repository's existing Supabase behavior-test harness and create fixtures for owner, editor, viewer, pending collaborator, and second owner. The assertions must execute these exact cases:

```ts
await expect(reserve(owner, QUOTA_BYTES)).resolves.toMatchObject({ expectedBytes: QUOTA_BYTES });
await expect(reserve(owner, 1)).rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
await expect(Promise.allSettled([reserve(owner, QUOTA_BYTES), reserve(owner, QUOTA_BYTES)]))
  .resolves.toSatisfy((results) => results.filter((result) => result.status === 'fulfilled').length === 1);
await expect(reserve(editor, 16)).resolves.toMatchObject({ ownerId: OWNER_ID });
await expect(reserve(viewer, 16)).rejects.toMatchObject({ code: 'STORAGE_PROJECT_FORBIDDEN' });
await expect(reserve(pendingCollaborator, 16)).rejects.toMatchObject({ code: 'STORAGE_PROJECT_FORBIDDEN' });
```

Also assert finalize replay is idempotent, release replay is idempotent, an expired reservation cannot finalize, a one-byte actual-size increase rechecks quota, shared-project usage is excluded from the collaborator's own summary, and file listing rejects unrelated users.

- [ ] **Step 4: Run the behavior test and verify missing-relation/function failures**

Run: `npx jest --runInBand tests/unit/database/account-project-storage.behavior.test.ts`

Expected: FAIL because the storage tables and RPCs are absent.

- [ ] **Step 5: Implement the migration**

Use integer-byte columns and these exact checks/status sets:

```sql
create table public.account_storage_quotas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  quota_bytes bigint not null default 1099511627776 check (quota_bytes > 0),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (used_bytes <= 9223372036854775807 - reserved_bytes)
);

create table public.project_storage_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null check (bucket_id in ('library-media-files','project-assets','map-assets','character-assets','tiptap-images')),
  object_path text not null check (object_path = btrim(object_path) and object_path <> '' and object_path not like '%..%'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 255),
  mime_type text not null check (char_length(btrim(mime_type)) between 1 and 200),
  size_bytes bigint not null check (size_bytes > 0),
  source_kind text not null check (source_kind in ('project_asset','library_media','document_image','map_reference','map_asset','character_asset','legacy_unassigned')),
  source_entity_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  object_created_at timestamptz,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','pending_cleanup')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket_id, object_path),
  check ((source_kind = 'legacy_unassigned') = (project_id is null))
);

create table public.storage_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  display_name text not null,
  mime_type text not null,
  source_kind text not null,
  source_entity_id uuid,
  expected_bytes bigint not null check (expected_bytes > 0),
  actual_bytes bigint check (actual_bytes is null or actual_bytes > 0),
  status text not null default 'pending' check (status in ('pending','finalized','released','expired')),
  file_id uuid references public.project_storage_files(id) on delete set null,
  expires_at timestamptz not null default (clock_timestamp() + interval '2 hours'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket_id, object_path)
);
```

Implement a private `storage_require_writer(project_id, actor_id)` helper, private internal reserve/finalize/release functions, authenticated wrappers bound to `auth.uid()`, and service-role wrappers that accept `p_actor_user_id`. Lock the quota row with `SELECT ... FOR UPDATE` before every counter transition. Finalization must upsert by `(bucket_id, object_path)` only for an exact replay and return a JSON object containing `fileId`, `ownerId`, `projectId`, `sizeBytes`, `reservationId`, and `reused`.

`account_storage_summary()` returns exactly:

```json
{
  "quotaBytes": 1099511627776,
  "usedBytes": 0,
  "reservedBytes": 0,
  "remainingBytes": 1099511627776,
  "ownedProjects": [],
  "sharedProjects": [],
  "unassigned": null
}
```

Project rows contain `id`, `name`, `ownerName`, `fileCount`, `usedBytes`, and `ownedByCurrentUser`. File-list output contains `items`, `total`, `limit`, and `offset`; each item contains `id`, `name`, `mimeType`, `sizeBytes`, `sourceKind`, `sourceEntityId`, `createdAt`, and `sourceAvailable`.

Enable RLS and revoke raw-table access from `public`, `anon`, and `authenticated`. Grant only the authenticated summary/list/reserve/finalize/release wrappers to `authenticated`, and grant service wrappers plus reconciliation helpers only to `service_role`. Update `library-media-files` insert/update policies to require `{auth.uid()}/{project_id}/...` and writer membership for new paths while leaving existing objects readable/deletable for migration compatibility.

- [ ] **Step 6: Run database tests**

Run: `npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts tests/unit/database/account-project-storage.behavior.test.ts tests/unit/database/migration-version-uniqueness.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the database foundation**

```bash
git add supabase/migrations/20260917010000_account_project_storage_usage.sql tests/unit/database/account-project-storage-migration.test.ts tests/unit/database/account-project-storage.behavior.test.ts
git commit -m "feat: add atomic project storage accounting"
```

### Task 2: Add Strict TypeScript Contracts and Quota Wrappers

**Files:**
- Create: `src/lib/types/accountStorage.ts`
- Create: `src/lib/server/accountStorage.ts`
- Create: `src/lib/server/storageQuota.ts`
- Create: `tests/unit/account/account-storage-service.test.ts`
- Create: `tests/unit/storage-quota-service.test.ts`

**Interfaces:**
- Consumes the Task 1 RPCs.
- Produces `AccountStorageSummary`, `AccountStorageProject`, `AccountStorageFile`, `AccountStorageFilePage`, `StorageSourceKind`, and `AccountStorageSort`.
- Produces `readOwnAccountStorage(client)`, `readProjectStorageFiles(client, input)`, `reserveProjectStorage(client, input)`, `finalizeProjectStorage(client, input)`, and `releaseProjectStorage(client, reservationId)`.

- [ ] **Step 1: Write strict-parser and domain-error tests**

```ts
it('rejects fractional, negative, unsafe, missing, and extra summary fields', async () => {
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    await expect(readOwnAccountStorage(clientFor({ ...validSummary, usedBytes: invalid }) as never))
      .rejects.toThrow('Invalid account storage field: usedBytes');
  }
  await expect(readOwnAccountStorage(clientFor({ ...validSummary, extra: true }) as never))
    .rejects.toThrow('Invalid account storage summary');
});

it('maps quota RPC details to a stable domain error', async () => {
  const client = rpcClient({ code: 'P0001', details: 'STORAGE_QUOTA_EXCEEDED' });
  await expect(reserveProjectStorage(client as never, reserveInput))
    .rejects.toMatchObject({ code: 'STORAGE_QUOTA_EXCEEDED' });
});
```

- [ ] **Step 2: Run the tests and verify module-not-found failures**

Run: `npx jest --runInBand tests/unit/account/account-storage-service.test.ts tests/unit/storage-quota-service.test.ts`

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement exact public contracts**

```ts
export const ACCOUNT_STORAGE_QUOTA_BYTES = 1_099_511_627_776;
export const ACCOUNT_STORAGE_WARNING_PERCENT = 80;
export const ACCOUNT_STORAGE_CRITICAL_PERCENT = 95;
export const ACCOUNT_STORAGE_PAGE_SIZE = 50;

export type StorageSourceKind =
  | 'project_asset' | 'library_media' | 'document_image'
  | 'map_reference' | 'map_asset' | 'character_asset' | 'legacy_unassigned';
export type AccountStorageSort = 'name_asc' | 'name_desc' | 'size_asc' | 'size_desc' | 'created_asc' | 'created_desc';

export type AccountStorageProject = {
  id: string;
  name: string;
  ownerName: string;
  fileCount: number;
  usedBytes: number;
  ownedByCurrentUser: boolean;
};

export type AccountStorageSummary = {
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  remainingBytes: number;
  ownedProjects: AccountStorageProject[];
  sharedProjects: AccountStorageProject[];
  unassigned: { fileCount: number; usedBytes: number } | null;
};
```

Implement exact-key parsers modeled on `src/lib/server/accountCredits.ts`; accept only known source/sort values, safe non-negative integers, UUID strings, valid timestamps, and arrays of valid rows. `readProjectStorageFiles` clamps `limit` to `1..100`, requires `offset >= 0`, trims queries to 200 characters, and passes named RPC parameters.

In `storageQuota.ts`, export:

```ts
export type StorageQuotaErrorCode =
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'STORAGE_PROJECT_FORBIDDEN'
  | 'STORAGE_RESERVATION_EXPIRED'
  | 'STORAGE_OBJECT_MISMATCH'
  | 'STORAGE_TEMPORARILY_UNAVAILABLE';

export class StorageQuotaError extends Error {
  constructor(public readonly code: StorageQuotaErrorCode) {
    super(code);
  }
}
```

Map only recognized database detail/message codes; map every unknown client/RPC failure to `STORAGE_TEMPORARILY_UNAVAILABLE`. Never include raw database messages in the domain error.

- [ ] **Step 4: Run service tests**

Run: `npx jest --runInBand tests/unit/account/account-storage-service.test.ts tests/unit/storage-quota-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/lib/types/accountStorage.ts src/lib/server/accountStorage.ts src/lib/server/storageQuota.ts tests/unit/account/account-storage-service.test.ts tests/unit/storage-quota-service.test.ts
git commit -m "feat: add account storage service contracts"
```

### Task 3: Expose Authenticated Account Storage APIs

**Files:**
- Create: `src/app/api/account/storage/route.ts`
- Create: `src/app/api/account/storage/projects/[projectId]/files/route.ts`
- Create: `tests/unit/account/account-storage-route.test.ts`
- Create: `tests/unit/account/account-storage-files-route.test.ts`

**Interfaces:**
- Consumes Task 2 read services.
- Produces private no-store `GET /api/account/storage` and `GET /api/account/storage/projects/:projectId/files`.

- [ ] **Step 1: Write route tests for authentication, validation, success, and generic failures**

```ts
it('returns the signed-in storage summary privately', async () => {
  const response = await GET(summaryRequest, undefined);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual(validSummary);
});

it.each([
  ['sort=unknown', 400],
  ['limit=0', 400],
  ['offset=-1', 400],
  [`query=${'x'.repeat(201)}`, 400],
])('rejects invalid file query %s', async (query, status) => {
  expect((await getFiles(query)).status).toBe(status);
});
```

Also assert 401 for unauthenticated calls, 403 for an inaccessible project, and 503 without internal details for service failures.

- [ ] **Step 2: Run the route tests and verify module-not-found failures**

Run: `npx jest --runInBand tests/unit/account/account-storage-route.test.ts tests/unit/account/account-storage-files-route.test.ts`

Expected: FAIL because both routes are absent.

- [ ] **Step 3: Implement both routes**

Use `withAuth`, `NextResponse.json`, and this shared header exactly:

```ts
const NO_STORE = { 'Cache-Control': 'private, no-store' };
```

The summary route calls `readOwnAccountStorage(supabase)`. The file route validates `projectId` with `z.string().uuid()`, parses `query`, `sort`, `limit`, and `offset` with a strict Zod object, then calls `readProjectStorageFiles`. Return only `{ error: 'Unable to load account storage' }` or `{ error: 'Unable to load project files' }` on 503. Map `STORAGE_PROJECT_FORBIDDEN` to 403.

- [ ] **Step 4: Run route tests**

Run: `npx jest --runInBand tests/unit/account/account-storage-route.test.ts tests/unit/account/account-storage-files-route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the APIs**

```bash
git add src/app/api/account/storage/route.ts 'src/app/api/account/storage/projects/[projectId]/files/route.ts' tests/unit/account/account-storage-route.test.ts tests/unit/account/account-storage-files-route.test.ts
git commit -m "feat: expose account storage APIs"
```

### Task 4: Build the Account Storage Explorer

**Files:**
- Create: `src/components/account/AccountStorageSection.tsx`
- Create: `src/components/account/AccountStorageSection.module.css`
- Create: `tests/unit/account/account-storage-section.test.tsx`
- Modify: `src/app/(dashboard)/account/page.tsx`
- Modify: `src/components/account/AccountEmailSettings.module.css`

**Interfaces:**
- Consumes Task 3 APIs and Task 2 browser-safe types/constants.
- Produces the approved read-only two-pane Account Storage UI.

- [ ] **Step 1: Write component tests**

Cover these exact behaviors:

```ts
expect((await screen.findByTestId('account-storage-used')).textContent).toBe('348.6 GB');
expect(screen.getByText('1 TB')).toBeTruthy();
expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('34');
expect(screen.getByText('My projects')).toBeTruthy();
expect(screen.getByText('Shared with me')).toBeTruthy();

fireEvent.click(screen.getByRole('button', { name: /Rainy Manor/ }));
expect(await screen.findByText('manor_intro.mp4')).toBeTruthy();
expect(screen.getByText('82.4 GB')).toBeTruthy();

fireEvent.change(screen.getByRole('searchbox', { name: 'Search files' }), { target: { value: 'intro' } });
await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith(expect.stringContaining('query=intro'), expect.anything()));
```

Also test: three stable summary placeholders; first-load retry without false zeros; stale refresh retaining values; 80%, 95%, and full warnings; shared projects excluded from summary; owner label; empty project; unassigned pseudo-group; file sort/pagination; source-unavailable text; `Open location` navigation; and stacked mobile class semantics.

- [ ] **Step 2: Run the component test and verify module-not-found failure**

Run: `npx jest --runInBand tests/unit/account/account-storage-section.test.tsx`

Expected: FAIL because `AccountStorageSection` does not exist.

- [ ] **Step 3: Implement formatting and query behavior**

Use binary units and keep byte math integer-based:

```ts
export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0$/, '')} ${units[unit]}`;
}
```

Use summary query key `['account-storage']` and file query key `['account-storage-files', projectId, query, sort, offset]`. Set `retry: false`, `staleTime: 0`, `refetchOnMount: 'always'`, and `refetchOnWindowFocus: true`, matching Credits behavior. Debounce filename search by 250 ms. Use router destinations derived from a closed `sourceKind` switch; disable `Open location` when `sourceAvailable` is false.

- [ ] **Step 4: Implement the approved layout and Account page insertion**

The page order must be:

```tsx
<header className={`${styles.pageHeader} ${styles.narrow}`}>...</header>
<div className={styles.narrow}><AccountCreditsSection /></div>
<AccountStorageSection />
<div className={styles.narrow}><AccountEmailSettings /></div>
```

Change `.content` to `width: min(100%, 1120px)` and add `.narrow { width: min(100%, 760px); margin-inline: auto; }`. The Storage CSS must use a two-column explorer above 760 px and one column below it, preserve visible focus rings, use semantic buttons/table/progressbar markup, and avoid horizontal page overflow.

- [ ] **Step 5: Run Account UI tests**

Run: `npx jest --runInBand tests/unit/account/account-storage-section.test.tsx tests/unit/account/account-credits-section.test.tsx tests/unit/account/account-email-settings.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the Account UI**

```bash
git add src/components/account/AccountStorageSection.tsx src/components/account/AccountStorageSection.module.css 'src/app/(dashboard)/account/page.tsx' src/components/account/AccountEmailSettings.module.css tests/unit/account/account-storage-section.test.tsx
git commit -m "feat: add account storage explorer"
```

### Task 5: Gate Browser Project Asset Uploads

**Files:**
- Modify: `src/app/api/projects/[projectId]/game-assets/route.ts`
- Modify: `tests/unit/project-game-assets-route.test.ts`
- Modify: `src/components/admin/GameAssetsPage.tsx`

**Interfaces:**
- Consumes Task 2 quota wrappers.
- Prepare results add `reservationId`; completion requests require the matching `reservationId` per item.
- Quota failures return `{ error: 'Storage quota exceeded', code: 'STORAGE_QUOTA_EXCEEDED' }` with HTTP 409.

- [ ] **Step 1: Extend route tests before production edits**

```ts
expect(reserveProjectStorage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
  projectId: PROJECT_ID,
  bucketId: 'project-assets',
  expectedBytes: 8,
  sourceKind: 'project_asset',
}));
expect(result.items[0]).toMatchObject({ ok: true, reservationId: RESERVATION_ID });

expect(finalizeProjectStorage).toHaveBeenCalledWith(expect.anything(), {
  reservationId: RESERVATION_ID,
  actualBytes: bytes.byteLength,
  sourceEntityId: ASSET_ID,
});
```

Add cases for viewer rejection before reserve, quota exceeded before signed URL creation, invalid uploaded content releasing the reservation, registration failure removing the object and releasing, exact replay success, and batch items receiving independent reservations.

- [ ] **Step 2: Run the focused route test and verify missing calls**

Run: `npx jest --runInBand tests/unit/project-game-assets-route.test.ts`

Expected: FAIL because the route does not reserve/finalize/release.

- [ ] **Step 3: Implement prepare and completion settlement**

Generate the object path before reserve. Call `reserveProjectStorage` before `createSignedUploadUrl`. Return `reservationId` with the signed target. Require this ID during completion; after content verification and `mcp_register_project_game_asset`, call `finalizeProjectStorage` using actual Storage size and the returned asset ID. On every failure after reservation, best-effort remove an uploaded object, then release. Preserve item-scoped batch outcomes.

Use one response mapper:

```ts
function storageErrorResponse(error: unknown): Response | null {
  if (!(error instanceof StorageQuotaError)) return null;
  if (error.code === 'STORAGE_QUOTA_EXCEEDED') {
    return json({ error: 'Storage quota exceeded', code: error.code }, 409);
  }
  if (error.code === 'STORAGE_PROJECT_FORBIDDEN') {
    return json({ error: 'Forbidden', code: error.code }, 403);
  }
  return json({ error: 'Storage is temporarily unavailable', code: error.code }, 503);
}
```

Update the browser caller to carry `reservationId` unchanged from prepare to complete and show owner-safe versus collaborator-safe quota copy based only on the current project role/ownership already available to that UI.

- [ ] **Step 4: Run route and Assets tests**

Run: `npx jest --runInBand tests/unit/project-game-assets-route.test.ts tests/unit/project-game-assets-page-activation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the browser Assets gate**

```bash
git add 'src/app/api/projects/[projectId]/game-assets/route.ts' tests/unit/project-game-assets-route.test.ts src/components/admin src/lib
git commit -m "feat: enforce storage quota for project assets"
```

### Task 6: Make Library Media and Document Images Project-Aware

**Files:**
- Modify: `src/lib/services/mediaFileUploadService.ts`
- Modify: `src/components/media/MediaFileUpload.tsx`
- Modify: `src/components/libraries/components/MediaCell.tsx`
- Modify: `src/components/libraries/components/AddNewRowForm.tsx`
- Modify: `src/components/libraries/components/AssetDetailDrawer.tsx`
- Modify: `src/components/libraries/components/LibraryAssetsTableBody.tsx`
- Modify: `src/components/libraries/components/LibraryAssetDetailDrawerWiring.tsx`
- Modify: `src/lib/services/documentImageUpload.ts`
- Modify: `src/lib/documents/documentImportService.ts`
- Modify: `src/components/agent/ChatInput.tsx`
- Create: `tests/unit/media-file-storage-quota.test.ts`
- Modify: `tests/unit/documents/document-import-service.test.ts`
- Modify: `tests/unit/agent/chat-input-document-source-wiring.test.ts`

**Interfaces:**
- `uploadMediaFile(supabase, file, { userId, projectId, sourceKind, sourceEntityId? })` replaces the user-ID-only signature.
- Media paths become `{userId}/{projectId}/{uuid}-{safeName}`.
- `MediaFileMetadata` adds `reservationId?: string` only during the upload handshake; persisted cell JSON remains the existing stable metadata fields.

- [ ] **Step 1: Write failing service and caller tests**

```ts
await uploadMediaFile(client as never, file, {
  userId: USER_ID,
  projectId: PROJECT_ID,
  sourceKind: 'library_media',
  sourceEntityId: ASSET_ID,
});
expect(uploadPath).toMatch(new RegExp(`^${USER_ID}/${PROJECT_ID}/`));
expect(reserveProjectStorage).toHaveBeenCalledBefore(storageUpload);
expect(finalizeProjectStorage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actualBytes: file.size }));
```

Test quota failure before upload, upload failure release, finalize failure cleanup/release, atomic document-image rollback, and ChatInput passing its current project ID.

- [ ] **Step 2: Run focused tests and verify signature/path failures**

Run: `npx jest --runInBand tests/unit/media-file-storage-quota.test.ts tests/unit/media-file-upload-ui.test.ts tests/unit/documents/document-import-service.test.ts`

Expected: FAIL because project-aware reservation is absent.

- [ ] **Step 3: Implement explicit project propagation**

Add required `projectId: string` props through the listed library components, starting from the existing route/table project context. Do not read project identity from `window.location`. Pass `currentProjectId` from Agent Chat selection context to document-image uploads; if no project is selected, skip file upload and keep the existing text-only fallback.

Implement `uploadMediaFile` as reserve -> Storage upload -> verified `bucket.info(path)` -> finalize. Return the existing persisted shape:

```ts
return {
  url,
  path,
  fileName: file.name,
  fileSize: actualSize,
  fileType: canonicalType,
  uploadedAt: objectCreatedAt,
};
```

`deleteMediaFile` must delete the physical object first and then call a new authenticated `settle_project_storage_file_deletion(p_bucket_id, p_object_path)` RPC added to the Task 1 migration. If settlement fails after deletion, reconciliation repairs the stale registry; do not restore the deleted file.

- [ ] **Step 4: Run media/document tests**

Run: `npx jest --runInBand tests/unit/media-file-storage-quota.test.ts tests/unit/media-file-upload-ui.test.ts tests/unit/documents/document-import-service.test.ts tests/unit/documents/document-editor-media-link-controls.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit project-aware media**

```bash
git add src/lib/services/mediaFileUploadService.ts src/components/media/MediaFileUpload.tsx src/components/libraries src/lib/services/documentImageUpload.ts src/lib/documents/documentImportService.ts src/components/agent/ChatInput.tsx tests/unit/media-file-storage-quota.test.ts tests/unit/documents
git commit -m "feat: account for project library media"
```

### Task 7: Gate MCP, Map, and Character Storage Writes

**Files:**
- Create: `supabase/functions/_shared/storage-quota.ts`
- Create: `supabase/functions/_shared/storage-quota.test.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: MCP image/project-asset tests under `supabase/functions/mcp/image-tools.test.ts`
- Modify: `src/lib/server/createMapReferenceService.ts`
- Modify: `tests/unit/create-map/create-map-reference-service.test.ts`
- Modify: `supabase/functions/pixellab-map/storage.ts`
- Modify: `supabase/functions/pixellab-map/storage.test.ts`
- Modify: `supabase/functions/pixellab-character/storage.ts`
- Create or modify: `supabase/functions/pixellab-character/storage.test.ts`

**Interfaces:**
- Consumes Task 1 service-role RPCs.
- Deno helper exports `reserveServiceStorage`, `finalizeServiceStorage`, `releaseServiceStorage`, and `StorageQuotaError` with the same stable codes as Task 2.
- Generated storage functions receive the authenticated initiating actor ID in their context/state; they never substitute the project owner as the actor.

- [ ] **Step 1: Write Deno helper and integration tests**

```ts
Deno.test('generated asset reserves maximum then settles actual bytes', async () => {
  await persistValidatedAsset(context, asset, png);
  assertEquals(rpcCalls[0].name, 'service_reserve_project_storage_upload');
  assertEquals(rpcCalls[0].args.p_expected_bytes, MAX_PNG_BYTES);
  assertEquals(rpcCalls.at(-1)?.name, 'service_finalize_project_storage_upload');
  assertEquals(rpcCalls.at(-1)?.args.p_actual_bytes, png.bytes.byteLength);
});
```

Add parallel cases for MCP signed targets, map-reference actual bytes, character max-size reserve, existing-object idempotent replay, quota rejection before provider/storage work, and upload/read-back/transition failure release.

- [ ] **Step 2: Run focused Jest and Deno tests and verify missing quota calls**

Run: `npx jest --runInBand tests/unit/create-map/create-map-reference-service.test.ts`

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/_shared/storage-quota.test.ts supabase/functions/mcp/image-tools.test.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-character/storage.test.ts`

Expected: FAIL because generated/MCP paths write without reservations.

- [ ] **Step 3: Implement the shared Deno wrapper**

The helper calls only `service_*` RPCs and requires `{ actorUserId, projectId, bucketId, objectPath, expectedBytes, displayName, mimeType, sourceKind, sourceEntityId }`. Parse returned reservation/file objects strictly. Translate recognized detail codes and map all unknown errors to `STORAGE_TEMPORARILY_UNAVAILABLE`.

- [ ] **Step 4: Integrate each write path**

For MCP manual uploads, reserve before `createSignedUploadUrl`, return `reservationId`, require it on completion, and settle verified size. For map references, reserve exact normalized PNG bytes before service-role upload and finalize with the inserted reference ID. For PixelLab map/character generation, reserve `MAX_PNG_BYTES` before upload, finalize after read-back and ready-state persistence, and release on every terminal failure. If a provider workflow can fail before producing bytes, reserve immediately before storage persistence rather than before paid generation, while still preventing any object write without a reservation.

Keep exact-replay behavior: when an identical object already exists, finalize the same reservation/file identity without double-counting.

- [ ] **Step 5: Run focused MCP/map/character tests**

Run: `npx jest --runInBand tests/unit/create-map/create-map-reference-service.test.ts`

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/_shared/storage-quota.test.ts supabase/functions/mcp/image-tools.test.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-character/storage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit non-browser upload gates**

```bash
git add supabase/functions/_shared/storage-quota.ts supabase/functions/_shared/storage-quota.test.ts supabase/functions/mcp/write-tools.ts supabase/functions/mcp/image-tools.test.ts src/lib/server/createMapReferenceService.ts tests/unit/create-map/create-map-reference-service.test.ts supabase/functions/pixellab-map supabase/functions/pixellab-character
git commit -m "feat: enforce quota for generated storage"
```

### Task 8: Settle Usage Through Source-Aware Deletion and Project Cleanup

**Files:**
- Modify: `supabase/migrations/20260917010000_account_project_storage_usage.sql`
- Modify: `src/lib/server/projectDeletion.ts`
- Modify: `tests/unit/project-delete-server-boundary.test.ts`
- Modify: `tests/unit/database/project-storage-cleanup-migration.test.ts`
- Create: `tests/unit/storage-file-deletion.test.ts`

**Interfaces:**
- Produces authenticated RPC `settle_project_storage_file_deletion(p_bucket_id text, p_object_path text) returns jsonb`.
- Produces service RPC `service_settle_project_storage_file_deletion(...)`.
- Project cleanup rows accept `library-media-files`, `project-assets`, `map-assets`, and `character-assets` and carry registry file IDs/owner bytes needed for idempotent settlement.

- [ ] **Step 1: Write deletion ordering and retry tests**

```ts
expect(calls).toEqual([
  'storage:project-assets',
  'remove:owner/project/file.png',
  'rpc:service_settle_project_storage_file_deletion:project-assets:owner/project/file.png',
  'delete-job',
]);
```

Assert failed physical removal never settles bytes, failed settlement keeps the cleanup job retryable, retry does not double-decrement, individual media deletion settles only after Storage success, and deleting a project keeps pending-cleanup bytes charged until the worker finishes.

- [ ] **Step 2: Run deletion tests and verify ordering failures**

Run: `npx jest --runInBand tests/unit/project-delete-server-boundary.test.ts tests/unit/storage-file-deletion.test.ts tests/unit/database/project-storage-cleanup-migration.test.ts`

Expected: FAIL because cleanup does not cover/settle all registered objects.

- [ ] **Step 3: Extend SQL cleanup semantics**

When deleting a project, mark matching registry rows `pending_cleanup` and enqueue bucket/path groups before removing the project row. Because `project_storage_files.project_id` uses `ON DELETE SET NULL`, retain the original owner and bytes. The settlement RPC locks the owner quota, deletes the active/pending registry row, decrements `used_bytes` with an underflow guard, and returns `{ releasedBytes, reused }`; missing rows are idempotent `{ releasedBytes: 0, reused: true }`.

- [ ] **Step 4: Update the cleanup worker**

Allow all four accounted buckets. After each successful removal batch, settle every path; delete the job only after all settlement calls succeed. On any error, record `failed` and a bounded error message. Do not settle a path whose Storage removal returned an error.

- [ ] **Step 5: Run deletion tests**

Run: `npx jest --runInBand tests/unit/project-delete-server-boundary.test.ts tests/unit/storage-file-deletion.test.ts tests/unit/database/project-storage-cleanup-migration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit cleanup settlement**

```bash
git add supabase/migrations/20260917010000_account_project_storage_usage.sql src/lib/server/projectDeletion.ts tests/unit/project-delete-server-boundary.test.ts tests/unit/storage-file-deletion.test.ts tests/unit/database/project-storage-cleanup-migration.test.ts
git commit -m "feat: settle storage usage after deletion"
```

### Task 9: Add Idempotent Backfill, Reconciliation, and Direct-Write Guard

**Files:**
- Create: `scripts/backfill-account-storage.ts`
- Create: `scripts/reconcile-account-storage.ts`
- Create: `scripts/check-accounted-storage-writes.ts`
- Create: `tests/unit/scripts/backfill-account-storage.test.ts`
- Create: `tests/unit/scripts/reconcile-account-storage.test.ts`
- Create: `tests/unit/scripts/check-accounted-storage-writes.test.ts`
- Modify: `package.json`

**Interfaces:**
- `backfillAccountStorage(client, { apply: boolean }): Promise<BackfillReport>`.
- `reconcileAccountStorage(client, { applySafeRepairs: boolean }): Promise<ReconciliationReport>`.
- Commands require `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; report mode is default and `--apply` enables writes.

- [ ] **Step 1: Write command-level tests with fake clients**

```ts
expect(await backfillAccountStorage(client, { apply: false })).toEqual({
  scannedObjects: 7,
  attributableObjects: 5,
  unassignedObjects: 1,
  conflicts: 1,
  insertedFiles: 0,
  totalBytes: 4096,
});
expect(client.inserts).toHaveLength(0);
```

Test path-first attribution, unique live-reference attribution, deterministic same-account multi-reference attribution, uploader-owned unassigned fallback, ambiguous-owner conflict, rerun idempotency, actual Storage size authority, cached-total rebuild, expired reservation repair, unexpected-object alerting, and no automatic ownership guess for ambiguous objects.

The direct-write guard test supplies a fixture containing `storage.from('map-assets').upload(...)` outside its allowlist and expects a non-zero result naming the file and line.

- [ ] **Step 2: Run script tests and verify module-not-found failures**

Run: `npx jest --runInBand tests/unit/scripts/backfill-account-storage.test.ts tests/unit/scripts/reconcile-account-storage.test.ts tests/unit/scripts/check-accounted-storage-writes.test.ts`

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement report/apply command contracts**

Use dependency-injected exported functions for tests and a guarded CLI entry point. Never print keys, signed URLs, or full object URLs. Backfill reads bucket objects in pages, joins project registries/references, and calls a service-only idempotent import RPC rather than writing raw quota counters from TypeScript. Reconciliation recomputes expected totals from active/pending-cleanup file rows and pending reservations; `--apply` may expire reservations and repair counters, but only reports missing objects, unexpected objects, size mismatches, and ambiguous ownership.

CLI usage must be:

```text
npm run storage:backfill -- [--apply]
npm run storage:reconcile -- [--apply]
npm run check:storage-writes
```

The direct-write allowlist contains only the shared coordinator implementations and known cleanup code. Integrate `npm run check:storage-writes` into `validate` before tests.

- [ ] **Step 4: Run script tests and dry-run help**

Run: `npx jest --runInBand tests/unit/scripts/backfill-account-storage.test.ts tests/unit/scripts/reconcile-account-storage.test.ts tests/unit/scripts/check-accounted-storage-writes.test.ts`

Run: `npm run storage:backfill -- --help && npm run storage:reconcile -- --help && npm run check:storage-writes`

Expected: all tests PASS; help exits 0 without environment variables; the write scan exits 0.

- [ ] **Step 5: Commit operational tooling**

```bash
git add scripts/backfill-account-storage.ts scripts/reconcile-account-storage.ts scripts/check-accounted-storage-writes.ts tests/unit/scripts package.json
git commit -m "feat: add storage backfill and reconciliation"
```

### Task 10: Add End-to-End Coverage and Complete Verification

**Files:**
- Create: `tests/e2e/specs/account-storage.spec.ts`
- Create: `tests/e2e/helpers/account-storage.ts`
- Modify: `scripts/README.md` to document report/apply rollout commands and enablement order

**Interfaces:**
- Consumes the complete feature.
- Produces user-visible evidence for Account browsing and quota enforcement.

- [ ] **Step 1: Write the failing Playwright scenarios**

```ts
test('owner sees owned and shared usage without double charging', async ({ page }) => {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
  await expect(page.getByTestId('account-storage-quota')).toContainText('1 TB');
  await expect(page.getByRole('button', { name: /Owned Storage Fixture/ })).toContainText('files');
  await expect(page.getByRole('button', { name: /Shared Storage Fixture/ })).toContainText('Shared');
});

test('owner and collaborator are blocked by the same owner quota', async ({ page }) => {
  await seedOwnerAtQuota();
  await attemptProjectAssetUpload(page, 'one-byte.txt');
  await expect(page.getByRole('alert')).toContainText(/storage.*full|quota/i);
});
```

Also cover project selection, per-file size, search, sorting, source-unavailable state, Open location, 80/95/full warnings, unassigned legacy row, owner successful upload below quota, collaborator successful upload below owner quota, and inaccessible project API denial.

- [ ] **Step 2: Run the focused E2E test and verify failures before final wiring fixes**

Run: `npx playwright test tests/e2e/specs/account-storage.spec.ts --workers=1`

Expected: FAIL at the first missing Account Storage heading or quota gate assertion. Implement the missing behavior while preserving every assertion.

- [ ] **Step 3: Document rollout gates**

Document this exact order:

1. deploy schema and code with enforcement feature flag off;
2. run `npm run storage:backfill` and review conflicts/unassigned totals;
3. run `npm run storage:backfill -- --apply`;
4. run `npm run storage:reconcile` and reach zero unexplained counter drift;
5. enable enforcement;
6. monitor quota errors, expired reservations, and cleanup failures;
7. retain rollback ability by disabling enforcement without deleting accounting rows.

- [ ] **Step 4: Run focused feature suites**

Run: `npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts tests/unit/database/account-project-storage.behavior.test.ts tests/unit/account/account-storage-service.test.ts tests/unit/account/account-storage-route.test.ts tests/unit/account/account-storage-files-route.test.ts tests/unit/account/account-storage-section.test.tsx tests/unit/storage-quota-service.test.ts tests/unit/project-game-assets-route.test.ts tests/unit/media-file-storage-quota.test.ts tests/unit/project-delete-server-boundary.test.ts tests/unit/storage-file-deletion.test.ts tests/unit/scripts/backfill-account-storage.test.ts tests/unit/scripts/reconcile-account-storage.test.ts tests/unit/scripts/check-accounted-storage-writes.test.ts`

Expected: PASS.

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/_shared/storage-quota.test.ts supabase/functions/mcp/image-tools.test.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-character/storage.test.ts`

Expected: PASS.

Run: `npx playwright test tests/e2e/specs/account-storage.spec.ts --workers=1`

Expected: PASS.

- [ ] **Step 5: Run repository verification**

Run: `npm run check:storage-writes && npm run lint && npm run typecheck && npm run typecheck:api && npm run check:mcp && npm run test:unit -- --runInBand && npm run build`

Expected: every command exits 0. Record any unrelated pre-existing failure separately; do not claim completion while a feature-related failure remains.

- [ ] **Step 6: Inspect final diff and commit the verified feature**

Run: `git status --short && git diff --check && git log --oneline --decorate -12`

Expected: only intentional tracked changes plus the untracked `.superpowers/brainstorm/` directory; no whitespace errors.

```bash
git add tests/e2e/specs/account-storage.spec.ts tests/e2e/helpers/account-storage.ts scripts/README.md
git commit -m "test: verify account storage quota flow"
```

Do not add `.superpowers/brainstorm/`.
