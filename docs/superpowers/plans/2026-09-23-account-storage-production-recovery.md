# Account Storage Production Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the pending Account Storage schema migration complete without running the production-wide historical data repair inside the migration transaction.

**Architecture:** Keep the idempotent, service-role-only repair RPC installed by the migration, but remove its automatic invocation from `supabase db push`. After the database is healthy and schema deployment succeeds, run the existing `storage:backfill` command separately so data repair is observable and retryable without rolling back schema installation.

**Tech Stack:** PostgreSQL/Supabase migrations, Jest migration contract tests, TypeScript recovery scripts.

## Global Constraints

- Production migration `20260922180000` is still unapplied and may be edited only to remove the unsafe automatic data operation.
- Preserve the repair RPC and its service-role-only permission boundary.
- Do not change Account Storage API behavior or function version routing.
- Preserve unrelated workspace changes.

---

### Task 1: Decouple Historical Repair From Schema Deployment

**Files:**
- Modify: `tests/unit/database/account-project-storage-migration.test.ts`
- Modify: `supabase/migrations/20260922180000_account_storage_hierarchy_and_historical_assets.sql`

**Interfaces:**
- Consumes: `public.service_repair_historical_project_storage()` as an operator-invoked service RPC.
- Produces: a schema-only migration path that does not invoke the RPC during `supabase db push`.

- [x] **Step 1: Write the failing migration contract test**

Add an assertion that strips the RPC function definition from the SQL and rejects any remaining `select public.service_repair_historical_project_storage();` call.

- [x] **Step 2: Verify the contract fails**

Run: `npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts`

Expected: FAIL because the migration currently invokes the repair RPC after creating the storage trigger.

- [x] **Step 3: Remove the automatic repair invocation**

Delete only the standalone repair call and replace its comment with an operational note that repair is run separately after schema deployment.

- [x] **Step 4: Verify focused and live database coverage**

Run:

```bash
npx jest --runInBand tests/unit/database/account-project-storage-migration.test.ts
RLS_DB_TESTS=1 REQUIRE_RLS_DB_TESTS=1 npx jest --runInBand tests/unit/database/account-project-storage.behavior.test.ts
```

Expected: all tests pass.

- [x] **Step 5: Review the production recovery diff**

Confirm the migration still creates and grants the repair RPC, no Account Storage version name changed, and only the automatic invocation was removed.
