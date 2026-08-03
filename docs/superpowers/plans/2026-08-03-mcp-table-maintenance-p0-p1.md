# MCP Table Maintenance P0/P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add P0/P1 MCP table maintenance tools for schema edits, destructive table/field/row maintenance, and batch row writes.

**Architecture:** Keep Edge Function logic as a schema/routing adapter and implement authoritative behavior in PostgreSQL RPCs. All tools share existing account/project authorization, telemetry, `mcp_require_writer`, field value validation, and reindex scheduling patterns.

**Tech Stack:** Supabase Edge Function Deno TypeScript, Zod, PostgreSQL PL/pgSQL migrations, Deno tests, Jest migration text tests.

## Global Constraints

- User requested spec-driven development on branch `f/mcpExtand`.
- User requested no TDD workflow.
- Do not touch unrelated worktrees or branches.
- Every destructive MCP tool must use `destructiveHint: true`.
- Every account-scoped write tool must require `projectId`.
- Every project-bound write tool must omit `projectId`.
- All table maintenance writes must go through PostgreSQL `security definer` RPCs guarded by `mcp_require_writer`.
- Run verification before claiming completion or pushing.

---

### Task 1: Database RPCs

**Files:**
- Create: `supabase/migrations/20260803000000_mcp_table_maintenance_p0_p1.sql`

**Interfaces:**
- Consumes: `public.mcp_require_writer(uuid)`, `public.mcp_value_is_empty(jsonb)`, `public.mcp_resolve_values(uuid,uuid,jsonb,jsonb,boolean)`, `public.mcp_validate_field_value(uuid,uuid,public.library_field_definitions,jsonb)`
- Produces: `public.mcp_edit_table_field`, `public.mcp_delete_table_field`, `public.mcp_delete_table_row`, `public.mcp_update_table`, `public.mcp_reorder_table_fields`, `public.mcp_delete_table`, `public.mcp_bulk_update_table_rows`, `public.mcp_upsert_table_rows`

- [ ] **Step 1: Add helper and P0 RPCs**

Create a forward migration defining helper logic for reference cleanup and P0 RPCs. Use table locks and explicit guard checks.

- [ ] **Step 2: Add P1 RPCs**

Extend the same migration with reorder, table delete, bulk update, and upsert RPCs. Keep all bulk/upsert behavior atomic inside a single function call.

- [ ] **Step 3: Add grants and revokes**

Revoke new RPCs from `public, anon`, grant execute to `authenticated`, and do not grant internal helper functions to clients.

### Task 2: MCP Tool Registration

**Files:**
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/database.ts`

**Interfaces:**
- Consumes: Task 1 RPC names.
- Produces: registered tools `edit_table_field`, `delete_table_field`, `delete_table_row`, `update_table`, `reorder_table_fields`, `delete_table`, `bulk_update_table_rows`, `upsert_table_rows`.

- [ ] **Step 1: Add Zod schemas**

Define schemas for table metadata updates, field edit/delete, row delete, reorder specs, table delete confirmation, bulk row updates, and upsert rows.

- [ ] **Step 2: Register tools**

Add tools to `registerWriteToolSet` using `executeRpc`, matching existing create/update patterns.

- [ ] **Step 3: Add annotations**

Keep update/reorder/bulk/upsert as non-destructive. Mark delete field, delete row, and delete table as destructive.

- [ ] **Step 4: Update telemetry classification**

Add every new tool name to `WRITE_TOOLS` in `server.ts`.

- [ ] **Step 5: Map RPC conflicts**

Update `database.ts` only if needed so P0/P1 RPC conflicts return stable MCP errors.

### Task 3: Tests and Documentation

**Files:**
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Create: `tests/unit/database/mcp-table-maintenance-p0-p1-migration.test.ts`
- Modify: `docs/mcp/README.md`

**Interfaces:**
- Consumes: registered tools and migration SQL from Tasks 1 and 2.
- Produces: coverage for tool discovery, schema routing, destructive annotations, account projectId requirements, and migration guardrails.

- [ ] **Step 1: Update project-bound tool list tests**

Expect all new tools in editor tools/list and confirm viewer tools/list excludes them.

- [ ] **Step 2: Update account tool list tests**

Expect all new write tools when an account has at least one writable project, and require `projectId` for all account-scoped project tools.

- [ ] **Step 3: Add RPC mapping tests**

Add Deno tests proving representative calls reach the intended RPC with expected parameters.

- [ ] **Step 4: Add destructive annotation tests**

Assert delete tools have `destructiveHint: true` and update/bulk/upsert tools do not.

- [ ] **Step 5: Add migration text tests**

Assert every new RPC exists, uses `mcp_require_writer`, validates destructive flags, checks references, and has revoke/grant statements.

- [ ] **Step 6: Update MCP docs**

Document the new table maintenance tools, destructive confirmations, and reference cleanup behavior.

### Task 4: Verification, Push, CI, Merge, Real-Link Smoke

**Files:**
- No source edits expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: pushed branch and post-merge real-link validation notes.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run check:mcp
npm run test:mcp
npx jest --runInBand tests/unit/database/mcp-table-maintenance-p0-p1-migration.test.ts
npm run typecheck
```

- [ ] **Step 2: Commit and push**

Commit all changes and push `f/mcpExtand`.

- [ ] **Step 3: Monitor CI**

Check GitHub CI until it is green. If CI fails, fix on the branch, rerun focused verification, and push again.

- [ ] **Step 4: Merge**

Merge the green branch into `main` using the repository's normal merge path.

- [ ] **Step 5: Real-link test**

Run a disposable real MCP/OAuth smoke flow against the deployed endpoint after merge and record results.
