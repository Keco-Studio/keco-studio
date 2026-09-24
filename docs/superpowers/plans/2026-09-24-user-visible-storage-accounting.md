# User-Visible Storage Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude unreferenced historical Storage objects from Account Storage display and user quota while preserving current Table, Document, Assets, map, and character media.

**Architecture:** Add a forward-only migration with a single current-visible-file selector and new lock-safe v5 read RPCs. Quota calculations use the same selector plus active reservations; the physical registry remains unchanged for reconciliation. The existing Billing and OAuth Playwright coverage is included and verified in the same branch at the user's request.

**Tech Stack:** PostgreSQL/Supabase migrations, TypeScript, Jest, Playwright, GitHub Actions.

## Global Constraints

- Do not edit or delete any deployed migration.
- Do not delete historical Storage objects or registry rows.
- Do not add a second storage ledger or change the Account UI layout.
- Only current user-visible business records consume displayed or enforced quota.
- Active upload reservations continue to reserve bytes.
- All tracked source and documentation files must pass the repository Chinese-character gate.
- The user explicitly waived test-first development; add and run regression coverage after implementation.

---

### Task 1: Synchronize the branch and add current-visible storage accounting

**Files:**
- Create: `supabase/migrations/20260924100000_user_visible_storage_accounting.sql`
- Modify: `tests/unit/database/account-project-storage-migration.test.ts`
- Modify: `tests/unit/database/account-project-storage.behavior.test.ts`

**Interfaces:**
- Produces: `private.storage_project_visible_physical_files_v5(uuid)` as the canonical eligible-file selector.
- Produces: lock-safe public `account_storage_summary_v5()`, `account_storage_project_entities_v5(...)`, and `account_storage_entity_details_v5(...)` RPCs.
- Preserves: raw `project_storage_files` rows and physical `storage.objects` inventory.

- [ ] **Step 1: Merge the latest remote main into the feature branch**

Run:

```bash
git merge --no-edit origin/main
```

Expected: the branch contains PRs #458-#465 without changing the untracked Playwright files.

- [ ] **Step 2: Add the shared eligibility selector**

Create a forward-only migration whose selector keeps current Table and Document bindings and admits Assets files only when a matching current native row exists:

```sql
where physical.entity_kind in ('table', 'document')
   or exists (select 1 from public.project_game_assets ... matching file id/bucket/path)
   or exists (select 1 from public.map_reference_images ... matching source/path/project)
   or exists (select 1 from public.map_assets ... matching source/path/project)
   or exists (select 1 from public.character_generation_attempts ... matching source/path/project)
```

Path-only fallback rows with no current owner are omitted. Keep canonical file identity so one object contributes at most once.

- [ ] **Step 3: Add lock-safe v5 read functions**

Create new private hierarchy/directory functions and public v5 RPCs instead of replacing the live v4 functions. Use the visible-file selector for entity totals and details. Compute account fields as:

```sql
physicalUsedBytes = sum(visible physical files in owned projects)
usedBytes = physicalUsedBytes + logicalUsedBytes
remainingBytes = greatest(quotaBytes - usedBytes - reservedBytes, 0)
overageBytes = greatest(usedBytes + reservedBytes - quotaBytes, 0)
```

An enabled empty Assets workspace remains a visible `0 B` entry.

- [ ] **Step 4: Align quota checks with visible bytes**

Add new `storage_reserve_project_storage_upload_v2`,
`storage_finalize_project_storage_upload_v2`,
`service_reserve_project_storage_upload_v2`,
`service_finalize_project_storage_upload_v2`, `reserve_project_storage_upload_v2`,
`finalize_project_storage_upload_v2`, and
`complete_project_game_asset_storage_upload_v2` entry points. Do not replace the
live unversioned functions. The v2 allowance predicate uses current-visible
physical bytes, logical bytes, and pending reservations:

```sql
expected_bytes > quota_bytes - visible_physical_bytes - logical_used_bytes - reserved_bytes
```

Do not alter raw physical inventory. Preserve advisory locking and idempotency contracts from the existing functions.

- [ ] **Step 5: Add post-implementation regression coverage**

Extend database tests to cover an active fallback file with no current owner. Assert it remains in `project_storage_files`, reports `0 B` under Assets, is absent from Assets details, and does not reduce remaining quota. Assert current Table, Document, native asset, map, and character objects still count once.

- [ ] **Step 6: Run storage database tests**

Run:

```bash
npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts tests/unit/database/account-project-storage.behavior.test.ts
```

Expected: all migration contract tests pass; behavior tests pass when the local Supabase test environment is available and otherwise report their existing explicit skip condition.

---

### Task 2: Switch the application to lock-safe v5 RPCs

**Files:**
- Modify: `src/lib/server/accountStorage.ts`
- Modify: `src/lib/storageQuota.ts`
- Modify: `src/app/api/projects/[projectId]/game-assets/route.ts`
- Modify: `supabase/functions/_shared/storage-quota.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `tests/unit/account/account-storage-service.test.ts`
- Modify: `tests/unit/storage-quota-service.test.ts`
- Modify: `tests/unit/project-game-assets-route.test.ts`
- Modify: `supabase/functions/pixellab-map/storage.test.ts`
- Modify: `supabase/functions/pixellab-character/storage.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/image-tools.test.ts`

**Interfaces:**
- Consumes: the versioned v5 read and quota RPCs from Task 1.
- Produces: unchanged TypeScript return types and API response contracts.

- [ ] **Step 1: Update Account Storage read RPC names**

Change only the RPC names; preserve request arguments and strict response parsing:

```ts
client.rpc('account_storage_summary_v5')
client.rpc('account_storage_project_entities_v5', args)
client.rpc('account_storage_entity_details_v5', args)
```

- [ ] **Step 2: Update upload quota RPC names**

Update browser, project-game-assets, service-function, and MCP callers together
to use the `_v2` names from Task 1. Keep TypeScript API signatures, error
mapping, and reservation cleanup unchanged.

- [ ] **Step 3: Update focused unit expectations and run them**

Run:

```bash
npx jest --runInBand tests/unit/account/account-storage-service.test.ts tests/unit/storage-quota-service.test.ts tests/unit/project-game-assets-route.test.ts
deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-character/storage.test.ts supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/image-tools.test.ts
```

Expected: all selected tests pass with the new RPC names and unchanged response contracts.

---

### Task 3: Include and verify Billing/OAuth Playwright coverage

**Files:**
- Add: `docs/superpowers/specs/2026-09-19-billing-oauth-playwright-coverage-design.md`
- Add: `docs/superpowers/plans/2026-09-19-billing-oauth-playwright-coverage.md`
- Add: `tests/e2e/specs/billing.spec.ts`
- Add: `tests/e2e/specs/oauth-consent.spec.ts`

**Interfaces:**
- Produces: browser coverage for Billing checkout/result pages and OAuth consent approval, denial, revalidation, and invalid requests.

- [ ] **Step 1: Review the existing untracked specs for merge compatibility**

Compare selectors and endpoint fixtures against current `origin/main`. Keep callbacks same-origin and prevent any real Stripe or external OAuth navigation.

- [ ] **Step 2: Run focused static checks and discovery**

Run:

```bash
npx eslint tests/e2e/specs/billing.spec.ts tests/e2e/specs/oauth-consent.spec.ts
npx playwright test --list | rg 'billing\.spec|oauth-consent\.spec'
```

Expected: both files are lint-clean and all nine tests are discovered.

- [ ] **Step 3: Run both browser specs**

Run:

```bash
npx playwright test tests/e2e/specs/billing.spec.ts tests/e2e/specs/oauth-consent.spec.ts --project=chromium --workers=1
```

Expected: all tests pass against the configured local Playwright/Supabase environment.

---

### Task 4: Review, verify, push, monitor, and merge

**Files:**
- Verify all changed files.

**Interfaces:**
- Produces: a reviewed PR merged only after required checks succeed.

- [ ] **Step 1: Run repository gates**

Run the exact Chinese-character gate, migration checks, focused tests, lint, and typecheck:

```bash
git grep -nI -P '[\x{4E00}-\x{9FFF}\x{3400}-\x{4DBF}\x{F900}-\x{FAFF}]' -- .
npm run lint
npm run typecheck
npm run typecheck:api
```

Expected: the grep returns no matches and exits 1 as its normal no-match status; all npm checks exit 0.

- [ ] **Step 2: Review the final diff**

Check migration lock safety, authorization, quota arithmetic, deduplication, test isolation, and absence of unrelated tracked changes. Fix all Critical and Important findings before continuing.

- [ ] **Step 3: Commit and push the branch**

Commit the storage implementation separately from the Playwright coverage where practical, then run:

```bash
git push -u origin account-storage-hierarchy-assets-fix
```

- [ ] **Step 4: Create or update the PR and poll checks**

Use GitHub CLI to create or locate the PR, then poll required checks until every check reaches a terminal state. Do not merge with pending, canceled, or failed migration, Chinese gate, CI, deployment, or Playwright checks.

- [ ] **Step 5: Merge and verify post-merge status**

Merge through GitHub only after all required checks pass. Poll the resulting `main` workflows, including database migration/deployment, and perform read-only production verification for `battle-poc` and representative Table/Document/Assets projects. Do not modify or delete production data.
