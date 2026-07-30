# MCP Image Fields and Add-Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MCP clients create tables with image fields and append safe optional fields, including image fields, to existing project tables.

**Architecture:** Extend the shared strict field schema and register one new non-destructive write tool for both account and legacy endpoints. Route additions through a security-definer PostgreSQL RPC that rechecks project writer access, validates the field, appends it atomically, and touches affected timestamps.

**Tech Stack:** TypeScript, Deno, MCP SDK, Zod, PostgreSQL/PLpgSQL, Supabase, Jest.

## Global Constraints

- Account endpoint requires `projectId`; legacy project endpoint omits it.
- `create_table` and `add_table_field` support only `string`, `string_array`, `int`, `int_array`, `float`, `float_array`, `boolean`, `enum`, `date`, `reference`, and `image`.
- `add_table_field` rejects `required: true`; rename, delete, reorder, and other media/formula types remain out of scope.
- Labels are unique per table after trimming and case folding.
- Reference targets must belong to the same project.
- The field is appended to its section, defaulting to `section1`.
- Image bytes continue to use the signed PUT upload flow, never MCP JSON.

---

### Task 1: MCP Tool Contract and Handler

**Files:**
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/server.ts`

**Interfaces:**
- Consumes: existing `fieldSchema`, `withProjectContext`, `executeRpc`, and account/legacy registration paths.
- Produces: `add_table_field({ projectId?, tableId, field })` calling `mcp_add_table_field(p_project_id, p_table_id, p_field_id, p_field)`.

- [ ] **Step 1: Write failing schema and advertisement tests**

Add tests that call `create_table` with `{ label: "Icon", dataType: "image" }`, assert `add_table_field` appears in writable account and legacy tool lists, assert account input requires `projectId`, and assert legacy input rejects `projectId`.

- [ ] **Step 2: Write the failing handler test**

Invoke:

```ts
{
  name: "add_table_field",
  arguments: {
    projectId,
    tableId,
    field: { label: "Icon", dataType: "image" },
  },
}
```

Assert the mocked RPC receives:

```ts
{
  p_project_id: projectId,
  p_table_id: tableId,
  p_field_id: /* generated UUID */,
  p_field: { label: "Icon", dataType: "image" },
}
```

- [ ] **Step 3: Run focused Deno tests and verify RED**

Run:

```bash
npx deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net \
  supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/server.test.ts
```

Expected: failures because `image` is rejected and `add_table_field` is absent.

- [ ] **Step 4: Implement the minimal MCP changes**

Add `"image"` to `fieldSchema`, derive an add-field schema from the same field contract, register `add_table_field`, generate `p_field_id` with `crypto.randomUUID()`, call `mcp_add_table_field`, and add the tool name to `WRITE_TOOLS`.

- [ ] **Step 5: Run focused Deno tests and verify GREEN**

Run the Step 3 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit the MCP layer**

```bash
git add supabase/functions/mcp/write-tools.ts \
  supabase/functions/mcp/account-tools.test.ts \
  supabase/functions/mcp/server.test.ts \
  supabase/functions/mcp/server.ts
git commit -m "feat(mcp): add table field tool"
```

### Task 2: Atomic Database Field Creation

**Files:**
- Create: `supabase/migrations/20260730130000_add_mcp_table_fields.sql`
- Modify: `tests/unit/database/mcp-atomic-writes.behavior.test.ts`

**Interfaces:**
- Consumes: `mcp_require_writer(uuid)`, `libraries`, `library_field_definitions`, `projects`, and `folders`.
- Produces: `mcp_add_table_field(uuid, uuid, uuid, jsonb)` returning the inserted field metadata; replaces `mcp_create_table` with `image` in its supported-type allowlist.

- [ ] **Step 1: Write failing database behavior tests**

Add tests proving `mcp_create_table` accepts an image field and `mcp_add_table_field`:

```ts
await fx.editor.client.rpc("mcp_add_table_field", {
  p_project_id: fx.projectId,
  p_table_id: tableId,
  p_field_id: crypto.randomUUID(),
  p_field: { label: "Icon", dataType: "image", section: "main" },
});
```

Verify section-local ordering, case-insensitive duplicate rejection, `required: true` rejection, viewer/outsider denial, and cross-project reference rejection.

- [ ] **Step 2: Run database behavior tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/database/mcp-atomic-writes.behavior.test.ts
```

Expected: failure because `mcp_add_table_field` does not exist and `mcp_create_table` rejects `image`.

- [ ] **Step 3: Add the SQL migration**

Replace `mcp_create_table` with its current implementation plus `image` in the allowlist. Add `mcp_add_table_field` that calls `mcp_require_writer`, locks and project-checks the table, rejects required or duplicate fields, validates enum/reference configuration, resolves the section, computes `max(order_index) + 1`, inserts the field, updates table/project/folder timestamps, and explicitly revokes public/anon access while granting authenticated execution.

- [ ] **Step 4: Run database behavior tests and verify GREEN**

Run the Step 2 command against the local Supabase stack. Expected: all database behavior tests pass; if the stack is unavailable, start it and apply local migrations before rerunning.

- [ ] **Step 5: Commit database behavior**

```bash
git add supabase/migrations/20260730130000_add_mcp_table_fields.sql \
  tests/unit/database/mcp-atomic-writes.behavior.test.ts
git commit -m "feat(database): add atomic MCP table fields"
```

### Task 3: Capability Contract, Documentation, and End-to-End Verification

**Files:**
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`
- Modify: `docs/mcp/README.md`

**Interfaces:**
- Consumes: the advertised `add_table_field` MCP tool and existing capability probe fixtures.
- Produces: current account/legacy capability counts and public operator guidance for creating image fields.

- [ ] **Step 1: Write failing capability probe expectations**

Add `add_table_field` to the expected write set and increment writable account and legacy tool counts. Run:

```bash
npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts
```

Expected: failure until the probe's production write set includes the new tool.

- [ ] **Step 2: Update the probe and documentation**

Add `add_table_field` to `WRITE_TOOLS`. Document that `create_table` accepts image fields, show the account/legacy `add_table_field` distinction, and place field creation before signed image upload and `update_table_row` in the image workflow.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run the Step 1 command. Expected: all capability probe tests pass.

- [ ] **Step 4: Run the full verification suite**

```bash
npm run test:mcp
npm run check:mcp
npm run typecheck
npm run typecheck:api
npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts
npx jest --runInBand tests/unit/database/mcp-atomic-writes.behavior.test.ts
git diff --check
supabase db push --linked --dry-run
```

Expected: every command succeeds. Then deploy the migration/function through the repository's normal workflow, wait for CI to pass, merge, reconnect the account MCP, and execute a real create-image-field, signed PUT, completion, row update, and read-back test in the approved `battle-poc` project.

- [ ] **Step 5: Commit supporting updates**

```bash
git add scripts/probe-mcp-capabilities.ts \
  tests/unit/mcp/capabilities-probe.test.ts docs/mcp/README.md \
  docs/superpowers/plans/2026-07-30-mcp-add-table-field.md
git commit -m "docs(mcp): describe image field creation"
```
