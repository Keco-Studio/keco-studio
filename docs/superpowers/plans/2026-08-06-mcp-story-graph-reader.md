# MCP Story Graph Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only, cursor-paginated `read_story_graph` remote MCP tool that returns the complete canonical story graph of a document-derived Script library.

**Architecture:** Reuse the existing `src/lib/story-graph` codec and validator directly from the Deno MCP runtime by making their pure dependencies explicit cross-runtime TypeScript imports. A single stable PostgreSQL RPC returns one authorized raw graph snapshot; the Edge operation decodes and validates it, builds a typed warning/Plot/story item stream, and pages that stream with an HMAC-bound snapshot cursor and a response-size budget.

**Tech Stack:** TypeScript, Zod, Jest, Deno tests, Supabase Edge Functions, PostgreSQL JSONB RPC, MCP SDK

---

## File Responsibility Map

- `src/lib/story-graph/constants.ts`: shared stable-label syntax with no framework dependency.
- `src/lib/story-graph/plotSummary.ts`: pure visible Plot fragment summarization used by Agent and MCP.
- `src/lib/story-graph/rowCodec.ts`: existing canonical Script-row decoder, made Deno-importable.
- `src/lib/story-graph/validator.ts`: existing whole-graph validator, made Deno-importable.
- `supabase/migrations/20260806000000_mcp_read_story_graph_snapshot.sql`: one authorized, transaction-consistent raw snapshot RPC; no graph interpretation.
- `supabase/functions/mcp/story-graph.ts`: MCP-specific snapshot mapping, digesting, typed stream construction, sizing, and cursor paging.
- `supabase/functions/mcp/read-tools.ts`: account/legacy tool schema and registration.
- `supabase/functions/mcp/server.ts`: telemetry operation classification.
- `scripts/probe-mcp-capabilities.ts`: production discovery and bounded-read acceptance without content evidence.

### Task 1: Make The Existing Story Graph Core Cross-Runtime

**Files:**
- Create: `src/lib/story-graph/constants.ts`
- Create: `src/lib/story-graph/plotSummary.ts`
- Create: `src/lib/story-graph/plotSummary.test.ts`
- Modify: `tsconfig.json`
- Modify: `src/lib/story-ir/schema.ts`
- Modify: `src/lib/story-plot/schema.ts`
- Modify: `src/lib/story-graph/editableGraph.ts`
- Modify: `src/lib/story-graph/rowCodec.ts`
- Modify: `src/lib/story-graph/validator.ts`
- Modify: `src/lib/agent/tools/read-story-graph.ts`
- Test: `src/lib/story-graph/rowCodec.test.ts`
- Test: `src/lib/story-graph/validator.test.ts`
- Test: `tests/unit/agent/read-story-graph.test.ts`

- [ ] **Step 1: Write the failing shared Plot summarizer test**

Create `src/lib/story-graph/plotSummary.test.ts` with a same-title, ordinary edge pair followed by a choice edge. Assert that only the adjacent same-title fragments coalesce and that choice metadata survives:

```ts
import { summarizeVisiblePlotGraph } from './plotSummary';

it('coalesces adjacent same-title ordinary fragments without losing choices', () => {
  const result = summarizeVisiblePlotGraph({
    storyNodeOrder: ['Intro', 'Decision', 'Ending'],
    nodes: [
      { id: 'OpeningA', title: 'Opening', storyNodeIds: ['Intro'] },
      { id: 'OpeningB', title: 'Opening', storyNodeIds: ['Decision'] },
      { id: 'Ending', title: 'Ending', storyNodeIds: ['Ending'] },
    ],
    edges: [
      { fromPlotNodeId: 'OpeningA', toPlotNodeId: 'OpeningB', optionText: null, optionIndex: null },
      { fromPlotNodeId: 'OpeningB', toPlotNodeId: 'Ending', optionText: 'Leave', optionIndex: 0 },
    ],
  });

  expect(result.nodes).toEqual([{
    id: 'OpeningA', title: 'Opening', firstLabel: 'Intro', lastLabel: 'Decision',
    nodeCount: 2, storyLabels: ['Intro', 'Decision'],
    outgoing: [{ toPlotNodeId: 'Ending', optionText: 'Leave', optionIndex: 0 }],
  }, {
    id: 'Ending', title: 'Ending', firstLabel: 'Ending', lastLabel: 'Ending',
    nodeCount: 1, storyLabels: ['Ending'], outgoing: [],
  }]);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/plotSummary.test.ts`

Expected: FAIL because `plotSummary.ts` does not exist.

- [ ] **Step 3: Enable explicit TypeScript extensions and centralize the label constant**

Add this compiler option in `tsconfig.json`:

```json
"allowImportingTsExtensions": true
```

Create `src/lib/story-graph/constants.ts`:

```ts
export const STORY_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
```

In `src/lib/story-ir/schema.ts`, replace the local regex with:

```ts
import { STORY_LABEL_PATTERN } from '../story-graph/constants.ts';
export const LABEL_PATTERN = STORY_LABEL_PATTERN;
```

In `src/lib/story-plot/schema.ts`, import `STORY_LABEL_PATTERN` directly and use it for `IdSchema`. Change the transitive imports in `editableGraph.ts`, `rowCodec.ts`, and `validator.ts` to explicit relative `.ts` imports. The important dependency edges are:

```ts
// rowCodec.ts
import { parseJumpTarget } from '../script-system/parseJumpTarget.ts';
import { parseStoryPlotPlan } from '../story-plot/schema.ts';
import type { EditableChoice, EditableNodeType, EditableStoryGraph, NamedScriptRow } from './editableGraph.ts';

// validator.ts
import { STORY_LABEL_PATTERN } from './constants.ts';
import type { EditableStoryGraph, EditableStoryNode } from './editableGraph.ts';
```

- [ ] **Step 4: Extract the existing Plot summarizer without changing its behavior**

Move `PlotEdgeSummary`, `PlotNodeSummary`, `PlotPlanEdgeSummary`, `summarizePlotNodes`, and `coalesceVisiblePlotFragments` from `src/lib/agent/tools/read-story-graph.ts` into `src/lib/story-graph/plotSummary.ts`. Export the three summary types and this single pure entry point:

```ts
export function summarizeVisiblePlotGraph(input: {
  storyNodeOrder: string[];
  nodes: Array<{ id: string; title: string; storyNodeIds: string[] }>;
  edges: Array<{
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: string | null;
    optionIndex: number | null;
  }>;
}): { nodes: PlotNodeSummary[]; edges: PlotPlanEdgeSummary[] } {
  return coalesceVisiblePlotFragments(
    summarizePlotNodes(input.nodes, input.edges),
    input.edges,
    input.storyNodeOrder,
  );
}
```

Update the Agent reader to call `summarizeVisiblePlotGraph` and keep its public response unchanged.

- [ ] **Step 5: Run focused core and Agent tests**

Run:

```bash
npm run test:unit -- --runInBand \
  src/lib/story-graph/plotSummary.test.ts \
  src/lib/story-graph/rowCodec.test.ts \
  src/lib/story-graph/validator.test.ts \
  tests/unit/agent/read-story-graph.test.ts
```

Expected: PASS with the existing row decoding, warnings, summary, and Agent output unchanged.

- [ ] **Step 6: Verify Deno can import the reused core**

Add this import-only check to a temporary command invocation, without creating a committed generated file:

```bash
deno eval --config supabase/functions/mcp/deno.json \
  'await import("./src/lib/story-graph/rowCodec.ts"); await import("./src/lib/story-graph/validator.ts"); await import("./src/lib/story-graph/plotSummary.ts");'
```

Expected: exit 0 with no module-resolution or Zod-version errors.

- [ ] **Step 7: Commit the shared-core refactor**

```bash
git add tsconfig.json src/lib/story-graph src/lib/story-ir/schema.ts \
  src/lib/story-plot/schema.ts src/lib/agent/tools/read-story-graph.ts
git commit -m "refactor: share story graph reader core"
```

### Task 2: Add An Atomic Raw Story Graph Snapshot RPC

**Files:**
- Create: `supabase/migrations/20260806000000_mcp_read_story_graph_snapshot.sql`
- Create: `supabase/functions/mcp/story-graph.test.ts`
- Create: `supabase/functions/mcp/story-graph.ts`
- Modify: `supabase/functions/mcp/errors.ts`

- [ ] **Step 1: Write failing operation tests for snapshot mapping**

Create `story-graph.test.ts` with a context whose `supabase.rpc` returns one raw snapshot. The minimal passing fixture must contain `Label`, `Type`, `Name`, `Content`, `Commands`, `Option0`, `Option0_Next`, and `Option0_Commands`. Assert:

```ts
const result = await readStoryGraph(context, { libraryId: LIBRARY_ID, limit: 200 });
assertEquals(result.library.name, 'Branching Script');
assertEquals(result.graph.entryLabel, 'Intro');
assertEquals(result.items.filter(item => item.kind === 'story_node'), [{
  kind: 'story_node', label: 'Intro', plotNodeId: 'Opening', plotTitle: 'Opening',
  rowId: ROW_1, rowIndex: 1, nodeType: 'narration', content: 'Choose.',
  commands: '', terminal: false, nextLabel: null,
  choices: [{ optionIndex: 0, text: 'Leave', targetLabel: 'Ending', commands: 'Set route = 1' }],
}, {
  kind: 'story_node', label: 'Ending', plotNodeId: 'Ending', plotTitle: 'Ending',
  rowId: ROW_2, rowIndex: 2, nodeType: 'narration', content: 'Done.',
  commands: '', terminal: true, nextLabel: null, choices: [],
}]);
assertEquals(calls, [{ name: 'mcp_read_story_graph_snapshot', parameters: {
  p_project_id: PROJECT_ID, p_library_id: LIBRARY_ID,
} }]);
```

Also add cases where the RPC returns `null`, a non-Script library, version 1, missing required fields, duplicate field labels, and invalid Plot membership. Assert the public codes `TABLE_NOT_FOUND`, `STORY_GRAPH_UNSUPPORTED_LIBRARY`, or `STORY_GRAPH_INVALID_SNAPSHOT` as appropriate.

- [ ] **Step 2: Run the Deno test and verify it fails**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/story-graph.test.ts`

Expected: FAIL because `story-graph.ts` and the new error codes do not exist.

- [ ] **Step 3: Add stable MCP story graph error codes**

Add these values to `MCP_ERROR_CODES` in `errors.ts`:

```ts
"STORY_GRAPH_UNSUPPORTED_LIBRARY",
"STORY_GRAPH_INVALID_SNAPSHOT",
"STORY_GRAPH_CONFLICT",
```

- [ ] **Step 4: Create the authorized stable SQL snapshot function**

Create a `security definer`, `stable`, empty-search-path function:

```sql
create or replace function public.mcp_read_story_graph_snapshot(
  p_project_id uuid,
  p_library_id uuid
) returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  with membership as (
    select p.id
    from public.projects p
    where p.id = p_project_id
      and public.mcp_current_project_role(p.id) is not null
  ), target_library as (
    select l.id, l.name, l.document_export_type, l.updated_at, l.plot_plan
    from public.libraries l
    join membership m on m.id = l.project_id
    where l.id = p_library_id
  ), relevant_fields as (
    select f.id, f.label, f.data_type, f.order_index
    from public.library_field_definitions f
    join target_library l on l.id = f.library_id
    where f.label in ('Label', 'Type', 'Name', 'Content', 'Commands')
       or f.label ~ '^Option[0-9]+(_Next|_Commands)?$'
  ), ordered_rows as (
    select a.id, a.name, a.row_index, a.created_at, a.updated_at
    from public.library_assets a
    join target_library l on l.id = a.library_id
    order by a.row_index nulls last, a.created_at, a.id
  )
  select case
    when not exists (select 1 from membership) then
      jsonb_build_object('status', 'access_denied')
    when not exists (select 1 from target_library) then null
    else (select jsonb_build_object(
    'status', 'ok',
    'library', jsonb_build_object(
      'id', l.id, 'name', l.name, 'documentExportType', l.document_export_type,
      'updatedAt', l.updated_at, 'plotPlan', l.plot_plan
    ),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'label', f.label, 'dataType', f.data_type,
      'orderIndex', f.order_index
    ) order by f.order_index, f.id) from relevant_fields f), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'rowIndex', r.row_index,
      'createdAt', r.created_at, 'updatedAt', r.updated_at,
      'values', coalesce((select jsonb_agg(jsonb_build_object(
        'fieldId', v.field_id, 'value', v.value_json
      ) order by v.field_id) from public.library_asset_values v
        join relevant_fields f on f.id = v.field_id where v.asset_id = r.id), '[]'::jsonb)
    ) order by r.row_index nulls last, r.created_at, r.id) from ordered_rows r), '[]'::jsonb)
    ) from target_library l)
  end
$$;

revoke all on function public.mcp_read_story_graph_snapshot(uuid, uuid)
  from public, anon;
grant execute on function public.mcp_read_story_graph_snapshot(uuid, uuid)
  to authenticated, service_role;
```

This RPC returns raw state only. Do not parse Jump, End, choices, Plot membership, or warnings in SQL.

- [ ] **Step 5: Implement strict snapshot mapping and canonical item construction**

In `story-graph.ts`, import the existing core directly:

```ts
import { decodeEditableStoryGraph } from "../../../src/lib/story-graph/rowCodec.ts";
import { validateEditableStoryGraph } from "../../../src/lib/story-graph/validator.ts";
import { summarizeVisiblePlotGraph } from "../../../src/lib/story-graph/plotSummary.ts";
```

Export these contracts:

```ts
export type ReadStoryGraphInput = { libraryId: string; limit?: number; cursor?: string };
export type StoryGraphStreamItem =
  | { kind: "warning"; code: "unreachable_node"; label: string }
  | { kind: "plot_node"; id: string; title: string; firstLabel: string;
      lastLabel: string; nodeCount: number }
  | { kind: "plot_edge"; fromPlotNodeId: string; toPlotNodeId: string;
      optionText: string | null; optionIndex: number | null }
  | { kind: "story_node"; label: string; plotNodeId: string; plotTitle: string;
      rowId: string; rowIndex: number; nodeType: string; speaker?: string;
      content: string; commands: string; terminal: boolean;
      nextLabel: string | null; choices: Array<{ optionIndex: number;
        text: string; targetLabel: string; commands: string }> };
```

Map RPC status `access_denied` to `PROJECT_ACCESS_REVOKED` and null to `TABLE_NOT_FOUND`. For `ok`, map fields by ID, reject duplicate labels and missing required labels, and convert `value_json` with the existing snapshot-reader rules: nullish values become `""`, strings remain unchanged, numbers and booleans use `String(value)`, and arrays/objects use `JSON.stringify(value)`. Build the `NamedScriptRow` map, run the shared codec and validator, and use each summarized Plot node's internal `storyLabels` to map every story label to its final visible `plotNodeId` and `plotTitle`. Catch shared parsing/validation errors and expose only `STORY_GRAPH_INVALID_SNAPSHOT` with a concise message.

- [ ] **Step 6: Run operation tests**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/story-graph.test.ts`

Expected: PASS for canonical content, commands, choices, endings, Plot data, and stable error mapping.

- [ ] **Step 7: Commit the atomic snapshot reader**

```bash
git add supabase/migrations/20260806000000_mcp_read_story_graph_snapshot.sql \
  supabase/functions/mcp/story-graph.ts supabase/functions/mcp/story-graph.test.ts \
  supabase/functions/mcp/errors.ts
git commit -m "feat: read canonical story graph snapshots"
```

### Task 3: Add Snapshot-Bound Adaptive Pagination

**Files:**
- Modify: `supabase/functions/mcp/story-graph.ts`
- Modify: `supabase/functions/mcp/story-graph.test.ts`
- Modify: `supabase/functions/mcp/limits.ts`

- [ ] **Step 1: Add failing multi-page and conflict tests**

Add tests that call page one with `limit: 2`, decode `nextCursor` through the public operation, and collect all pages. Assert the item kinds are ordered exactly as warnings, Plot nodes, Plot edges, then story nodes; no item is missing or duplicated.

After page one, change one returned cell value while leaving IDs unchanged and call page two. Assert:

```ts
const error = await assertRejects(
  () => readStoryGraph(changedContext, {
    libraryId: LIBRARY_ID, limit: 2, cursor: first.nextCursor!,
  }),
  McpDomainError,
);
assertEquals(error.code, 'STORY_GRAPH_CONFLICT');
```

Add cursor rejection cases for another library, another limit, tampering, and expiry; expect `INVALID_CURSOR`.

- [ ] **Step 2: Add failing response-budget tests**

Construct several 300 KiB story items and request `limit: 200`. Assert the first page returns fewer than 200 items, remains below `MAX_STORY_GRAPH_RESULT_BYTES`, and has a cursor. Construct one item larger than the budget and assert `PAYLOAD_TOO_LARGE` with no truncated content.

- [ ] **Step 3: Run tests and verify the paging failures**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/story-graph.test.ts`

Expected: FAIL because snapshot digest, cursor paging, and adaptive sizing are not implemented.

- [ ] **Step 4: Add a conservative structured-result budget**

In `limits.ts`, reserve protocol wrapper space below the existing 1 MiB HTTP limit:

```ts
export const MAX_STORY_GRAPH_RESULT_BYTES = MAX_RESPONSE_BYTES - 64 * 1024;
```

- [ ] **Step 5: Implement deterministic snapshot hashing**

Canonicalize object keys recursively, preserve array order, and hash the complete relevant raw snapshot:

```ts
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function snapshotId(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 6: Implement signed item-offset cursors and adaptive page sizing**

Use the existing `encodeCursor`/`decodeCursor` with binding `{ kind: "story_graph", scope: "project", projectId, objectId: libraryId }`. The position is strict:

```ts
type StoryGraphCursorPosition = { offset: number; snapshotId: string; limit: number };
```

Validate nonnegative safe `offset`, 64-character lowercase hex `snapshotId`, and unchanged `limit`. Recompute the snapshot before slicing; mismatched digest throws `STORY_GRAPH_CONFLICT`.

Build the page one item at a time. For each candidate, encode the candidate's actual `nextCursor` when items remain, then measure the full operation result with `utf8ByteLength(JSON.stringify(candidate))`. Stop before `MAX_STORY_GRAPH_RESULT_BYTES`; if even the first remaining item cannot fit, throw `PAYLOAD_TOO_LARGE`. Return `nextCursor: null` only on the final page.

- [ ] **Step 7: Run paging tests**

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/story-graph.test.ts`

Expected: PASS for complete traversal, snapshot conflict, invalid bindings, adaptive pages, and oversized-item rejection.

- [ ] **Step 8: Commit pagination**

```bash
git add supabase/functions/mcp/story-graph.ts \
  supabase/functions/mcp/story-graph.test.ts supabase/functions/mcp/limits.ts
git commit -m "feat: paginate MCP story graph reads"
```

### Task 4: Register The Tool For Account And Legacy MCP

**Files:**
- Modify: `supabase/functions/mcp/read-tools.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`

- [ ] **Step 1: Add failing discovery and schema tests**

Add `read_story_graph` to `PROJECT_READ_TOOL_NAMES` in `server.test.ts`. Assert the legacy schema contains `libraryId`, `limit`, and `cursor` but not `projectId`; assert the account schema also requires `projectId`. In the viewer test, assert the tool remains advertised.

Add an account call test that verifies `mcp_resolve_project_role` runs before `mcp_read_story_graph_snapshot` and that telemetry records operation `read_story_graph` with class `read`.

- [ ] **Step 2: Run protocol tests and verify discovery fails**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net \
  supabase/functions/mcp/server.test.ts \
  supabase/functions/mcp/account-tools.test.ts
```

Expected: FAIL because the tool is not registered or classified.

- [ ] **Step 3: Register the strict read-only tool**

In `read-tools.ts`, add this schema inside `registerReadToolSet`:

```ts
const storyGraphSchema = z.object({
  ...projectShape,
  libraryId: uuid,
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(4096).optional(),
}).strict();
```

Register `read_story_graph` with the existing read-only annotations and this description:

```ts
"Read and validate a complete document-derived Script story graph. Follow nextCursor until hasMore is false; if STORY_GRAPH_CONFLICT is returned, discard prior pages and restart. Obtain libraryId from list_project_structure."
```

Resolve account project context before calling `readStoryGraph(context, withoutProjectId(input))`.

- [ ] **Step 4: Classify the tool as a read operation**

Add `"read_story_graph"` to `READ_TOOLS` in `server.ts`. Do not add it to any write set or confirmation path.

- [ ] **Step 5: Run protocol tests**

Run the command from Step 2.

Expected: PASS for account/legacy discovery, viewer visibility, strict project selectors, live authorization, and read telemetry.

- [ ] **Step 6: Commit tool registration**

```bash
git add supabase/functions/mcp/read-tools.ts supabase/functions/mcp/server.ts \
  supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts
git commit -m "feat: expose story graph MCP reader"
```

### Task 5: Document And Probe The Capability

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Test: `tests/unit/mcp/capabilities-probe.test.ts`

- [ ] **Step 1: Add failing probe expectations**

Add `read_story_graph` to `READ_TOOLS`. Extend the legacy bounded-read path: after `list_project_structure`, try tables in deterministic listed order with `limit: 1` until `read_story_graph` succeeds; treat `STORY_GRAPH_UNSUPPORTED_LIBRARY` as a skipped non-Script table and fail on other errors. Assert a successful response contains `library.snapshotId`, `graph.entryLabel`, an `items` array, and boolean `hasMore`. Record only `storyGraphRead: "succeeded"` or `"not_available"`; do not write item content, labels, titles, commands, or IDs to evidence.

For account mode, keep the probe non-invasive unless an explicit project selection exists; discovery still requires the tool in `ACCOUNT_BASE_TOOLS`.

- [ ] **Step 2: Run the probe unit tests and verify the capability mismatch**

Run: `npm run test:unit -- --runInBand tests/unit/mcp/capabilities-probe.test.ts`

Expected: FAIL because the documented/expected tool set has not yet been updated everywhere.

- [ ] **Step 3: Document the read loop**

Add a `Story Graph Reads` section to `docs/mcp/README.md` containing this example and the account/legacy parameter difference:

```json
{
  "projectId": "from list_projects",
  "libraryId": "from list_project_structure",
  "limit": 100
}
```

State that clients collect typed `warning`, `plot_node`, `plot_edge`, and `story_node` items until `hasMore` is false. State that `STORY_GRAPH_CONFLICT` invalidates every previously collected page and requires a restart without `cursor`.

- [ ] **Step 4: Run probe tests and static checks**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/mcp/capabilities-probe.test.ts
npm run typecheck
npm run check:mcp
```

Expected: PASS.

- [ ] **Step 5: Commit documentation and probe coverage**

```bash
git add docs/mcp/README.md scripts/probe-mcp-capabilities.ts \
  tests/unit/mcp/capabilities-probe.test.ts
git commit -m "docs: describe MCP story graph reads"
```

### Task 6: Run Full Verification

**Files:**
- Modify only files required to fix failures caused by this feature.

- [ ] **Step 1: Run shared-core regression tests**

Run:

```bash
npm run test:unit -- --runInBand \
  src/lib/story-graph/plotSummary.test.ts \
  src/lib/story-graph/rowCodec.test.ts \
  src/lib/story-graph/validator.test.ts \
  tests/unit/agent/read-story-graph.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all MCP tests and type checks**

Run:

```bash
npm run check:mcp
npm run test:mcp
npm run typecheck
npm run typecheck:api
```

Expected: all commands exit 0.

- [ ] **Step 3: Run lint and verify the production build**

Run:

```bash
npm run lint
npm run build
```

Expected: both commands exit 0 with no new warnings attributable to the feature.

- [ ] **Step 4: Inspect the final diff and migration safety**

Run:

```bash
git diff --check
git status --short
git diff HEAD~5 --stat
rg -n 'read_story_graph|mcp_read_story_graph_snapshot' \
  src supabase/functions/mcp supabase/migrations docs/mcp scripts
```

Expected: no whitespace errors; the SQL function is read-only, `stable`, permission-scoped, and granted only to authenticated/service roles; no story content appears in probe evidence.

- [ ] **Step 5: Resolve any verification failure in its owning task**

If a command fails, return to the task that owns the affected file, add a focused regression assertion, make the minimal correction, rerun that task's focused tests, and use that task's exact `git add` list for a `fix: complete MCP story graph verification` commit. If every command passes, do not create an empty commit.
