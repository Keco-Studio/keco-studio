# Agent Story Graph Edit Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Keco Assistant read and safely patch the executable story graph of a document-derived Script while keeping script rows and `plot_plan` consistent.

**Architecture:** Build a pure normalized graph/patch layer, then wrap it with project-scoped snapshot loading and a `post_preview` Agent tool. Confirmation reapplies the sealed patch against a locked snapshot and calls one Supabase RPC that atomically updates fields, rows, cell values, ordering, and `plot_plan`; the existing Script flow-chart UI renders the result after cache invalidation.

**Tech Stack:** TypeScript, Zod, Jest, React server rendering tests, Next.js Agent tools, Supabase/PostgreSQL JSONB RPC, existing Story Plot schemas.

---

### Task 1: Add The Editable Story Graph And Row Codec

**Files:**
- Create: `src/lib/story-graph/editableGraph.ts`
- Create: `src/lib/story-graph/rowCodec.ts`
- Test: `src/lib/story-graph/rowCodec.test.ts`

- [ ] **Step 1: Write failing row-to-graph tests**

Create fixtures where `plot_plan.version = 2` supplies labels for rows whose visible `Label` cells are empty. Assert that the codec reconstructs fallthrough, `Jump`, `End`, choices, and stable row identity:

```ts
import { decodeEditableStoryGraph, encodeEditableStoryRows } from './rowCodec';

it('uses storyNodeOrder as the stable identity for every ordered row', () => {
  const graph = decodeEditableStoryGraph({
    plotPlan: {
      version: 2,
      entryPlotNodeId: 'Intro',
      storyNodeOrder: ['Intro', 'Decision', 'LeftEnd'],
      nodes: [
        { id: 'Intro', title: 'Opening', storyNodeIds: ['Intro', 'Decision'] },
        { id: 'LeftEnd', title: 'Left ending', storyNodeIds: ['LeftEnd'] },
      ],
      edges: [{
        fromPlotNodeId: 'Intro',
        toPlotNodeId: 'LeftEnd',
        optionText: 'Go left',
        optionIndex: 0,
      }],
    },
    rows: [
      { assetId: 'a1', rowIndex: 0, values: { Label: 'Intro', Content: 'Opening' } },
      { assetId: 'a2', rowIndex: 1, values: {
        Label: '', Content: 'Choose', Option0: 'Go left', Option0_Next: 'Jump LeftEnd',
      } },
      { assetId: 'a3', rowIndex: 2, values: {
        Label: 'LeftEnd', Content: 'Safe', Commands: 'End',
      } },
    ],
  });

  expect(graph.entryLabel).toBe('Intro');
  expect(graph.nodes.map((node) => node.label)).toEqual(['Intro', 'Decision', 'LeftEnd']);
  expect(graph.nodes[0].nextLabel).toBe('Decision');
  expect(graph.nodes[1].choices).toEqual([
    { optionIndex: 0, text: 'Go left', targetLabel: 'LeftEnd', commands: '' },
  ]);
  expect(graph.nodes[2].terminal).toBe(true);
});

it('round-trips executable control fields without changing unrelated cells', () => {
  const encoded = encodeEditableStoryRows(decodeEditableStoryGraph(fixture));
  expect(encoded.map((row) => row.values.Bg)).toEqual(['rain.png', '', '']);
  expect(encoded[1].values.Option0_Next).toBe('Jump LeftEnd');
  expect(encoded[2].values.Commands).toContain('End');
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/rowCodec.test.ts`

Expected: FAIL because `editableGraph.ts` and `rowCodec.ts` do not exist.

- [ ] **Step 3: Define the normalized graph types**

Add these public contracts to `editableGraph.ts`:

```ts
import type { StoryPlotPlan } from '@/lib/story-plot/schema';

export type EditableNodeType = 'dialogue' | 'narration' | 'scene' | 'system';

export type EditableChoice = {
  optionIndex: number;
  text: string;
  targetLabel: string;
  commands: string;
};

export type EditableStoryNode = {
  label: string;
  plotTitle: string;
  assetId: string | null;
  rowIndex: number;
  nodeType: EditableNodeType;
  speaker: string;
  content: string;
  commands: string;
  nextLabel: string | null;
  terminal: boolean;
  choices: EditableChoice[];
  values: Record<string, string>;
};

export type EditableStoryGraph = {
  entryLabel: string;
  nodes: EditableStoryNode[];
  plotPlan: StoryPlotPlan;
};

export type NamedScriptRow = {
  assetId: string | null;
  rowIndex: number;
  values: Record<string, string>;
};
```

- [ ] **Step 4: Implement strict decode and encode behavior**

In `rowCodec.ts`, export:

```ts
export function decodeEditableStoryGraph(input: {
  plotPlan: unknown;
  rows: NamedScriptRow[];
}): EditableStoryGraph;

export function encodeEditableStoryRows(
  graph: EditableStoryGraph
): NamedScriptRow[];
```

Use `parseStoryPlotPlan`, require version 2 for editing, require exact row-count alignment, parse `Jump` with `parseJumpTarget`, preserve non-structural values, and compile physical fallthrough as an empty control command. Preserve non-control commands when adding or removing `Jump`/`End` tokens.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/rowCodec.test.ts`

Expected: PASS.

Run: `git add src/lib/story-graph/editableGraph.ts src/lib/story-graph/rowCodec.ts src/lib/story-graph/rowCodec.test.ts && git commit -m "feat: add editable story graph row codec"`

---

### Task 2: Add The Structured Patch Schema And Pure Patch Engine

**Files:**
- Create: `src/lib/story-graph/patchSchema.ts`
- Create: `src/lib/story-graph/patchEngine.ts`
- Test: `src/lib/story-graph/patchEngine.test.ts`

- [ ] **Step 1: Write failing operation tests**

Cover `create_node`, `add_choice`, `redirect_choice`, `remove_choice`, `set_next`, and `set_end`. Include a multi-operation patch that makes a node terminal before converting it into a choice node:

```ts
it('creates a terminal node and branches to it without discarding an old route', () => {
  const result = applyStoryGraphPatch(linearGraph, {
    operations: [
      { type: 'set_end', fromLabel: 'Decision' },
      {
        type: 'create_node',
        node: {
          label: 'EscapeRoute',
          nodeType: 'narration',
          content: 'The hero leaves through the back door.',
        },
        insertAfterLabel: 'Decision',
      },
      {
        type: 'add_choice',
        fromLabel: 'Decision',
        text: 'Escape',
        targetLabel: 'EscapeRoute',
      },
    ],
  });

  expect(result.graph.nodes.find((node) => node.label === 'Decision')).toMatchObject({
    nextLabel: null,
    choices: [{ optionIndex: 0, text: 'Escape', targetLabel: 'EscapeRoute' }],
  });
  expect(result.changes.map((change) => change.type)).toEqual([
    'next_changed', 'node_created', 'choice_added',
  ]);
});
```

Also assert exact-label resolution happens before exact-title fallback and duplicate titles throw `STORY_GRAPH_AMBIGUOUS_NODE` with candidate labels.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/patchEngine.test.ts`

Expected: FAIL because the patch modules do not exist.

- [ ] **Step 3: Add the strict Zod discriminated union**

Define `StoryGraphPatchSchema` with this operation shape:

```ts
const OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_node'),
    node: z.object({
      label: LabelSchema,
      nodeType: z.enum(['dialogue', 'narration', 'scene', 'system']),
      content: z.string().max(100_000),
      speaker: z.string().max(200).optional(),
      plotTitle: z.string().trim().min(1).max(200).optional(),
      nextLabel: z.string().trim().min(1).max(200).optional(),
    }).strict(),
    insertAfterLabel: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  z.object({
    type: z.literal('add_choice'),
    fromLabel: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(2_000),
    targetLabel: z.string().trim().min(1).max(200),
    commands: z.string().max(10_000).optional(),
  }).strict(),
  z.object({
    type: z.literal('redirect_choice'),
    fromLabel: z.string().trim().min(1).max(200),
    optionIndex: z.number().int().min(0).max(9),
    targetLabel: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal('remove_choice'),
    fromLabel: z.string().trim().min(1).max(200),
    optionIndex: z.number().int().min(0).max(9),
  }).strict(),
  z.object({
    type: z.literal('set_next'),
    fromLabel: z.string().trim().min(1).max(200),
    targetLabel: z.string().trim().min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal('set_end'),
    fromLabel: z.string().trim().min(1).max(200),
  }).strict(),
]);

export const StoryGraphPatchSchema = z.object({
  operations: z.array(OperationSchema).min(1).max(50),
}).strict();
```

- [ ] **Step 4: Implement immutable ordered patch application**

Define the change contract in `patchEngine.ts` so later tasks import one type:

```ts
export type StoryGraphChange =
  | { type: 'node_created'; label: string; rowIndex: number; plotTitle?: string }
  | {
      type: 'choice_added'; fromLabel: string; optionIndex: number;
      text: string; targetLabel: string;
    }
  | {
      type: 'choice_removed'; fromLabel: string; optionIndex: number;
      text: string; targetLabel: string;
    }
  | {
      type: 'choice_redirected'; fromLabel: string; optionIndex: number;
      text: string; fromTargetLabel: string; toTargetLabel: string;
    }
  | {
      type: 'next_changed'; fromLabel: string;
      fromTargetLabel: string | null; toTargetLabel: string;
    }
  | {
      type: 'ending_changed'; fromLabel: string;
      fromTargetLabel: string | null; terminal: true;
    };
```

Export `applyStoryGraphPatch(graph, patch)` returning `{ graph, normalizedPatch, changes }`. Clone the input, resolve every reference against the graph state at that operation, assign the first free choice slot, seal old choice text/target into normalized redirect/remove operations, and never delete a node. Resolve strings as exact stable labels first, then as exact plot titles; if a title owns more than one story node, throw `STORY_GRAPH_AMBIGUOUS_NODE` with all candidate labels.

Reject `add_choice` when the source still has `nextLabel`; require an explicit earlier `set_end`. Reject `set_next` when choices remain. `remove_choice` only removes the selected edge; if it removes the final choice, the node becomes terminal.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/patchEngine.test.ts`

Expected: PASS.

Run: `git add src/lib/story-graph/patchSchema.ts src/lib/story-graph/patchEngine.ts src/lib/story-graph/patchEngine.test.ts && git commit -m "feat: add story graph patch engine"`

---

### Task 3: Add Graph Validation, Reachability, And Preview Diffs

**Files:**
- Create: `src/lib/story-graph/validator.ts`
- Create: `src/lib/story-graph/preview.ts`
- Test: `src/lib/story-graph/validator.test.ts`
- Test: `src/lib/story-graph/preview.test.ts`

- [ ] **Step 1: Write failing validation tests**

Assert duplicate/invalid labels, missing targets, more than ten choices, choice-plus-next, cycles, and invalid entry fail with stable codes. Assert unreachable nodes are warnings and path counts are decimal strings:

```ts
it('warns for disconnected content without rejecting the graph', () => {
  const result = validateEditableStoryGraph(graphWithOrphan);
  expect(result.warnings).toEqual([
    { code: 'unreachable_node', label: 'UnusedEnding' },
  ]);
  expect(result.summary).toMatchObject({
    nodeCount: 4,
    unreachableCount: 1,
    entryToEndingPathCount: '2',
  });
});

it('rejects a newly cyclic final graph', () => {
  expect(() => validateEditableStoryGraph(cyclicGraph)).toThrow(
    expect.objectContaining({ code: 'STORY_GRAPH_INVALID_PATCH' })
  );
});
```

- [ ] **Step 2: Write failing preview tests**

Assert stable arrays for created nodes, choice additions/removals/redirects, successor changes, affected row numbers, new option fields, warnings, and before/after summaries. The preview type must be `story_graph_edit` and contain no full row payload.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/validator.test.ts src/lib/story-graph/preview.test.ts`

Expected: FAIL because the validator and preview builder do not exist.

- [ ] **Step 4: Implement deterministic validation and DAG analysis**

Export:

```ts
export type StoryGraphSummary = {
  nodeCount: number;
  edgeCount: number;
  endingCount: number;
  unreachableCount: number;
  entryToEndingPathCount: string;
};

export function validateEditableStoryGraph(graph: EditableStoryGraph): {
  warnings: Array<{ code: 'unreachable_node'; label: string }>;
  summary: StoryGraphSummary;
};
```

Use DFS color marking for cycle detection, reachability from `entryLabel`, and reverse topological dynamic programming with `bigint` for path counts. Count choice and ordinary edges exactly once.

- [ ] **Step 5: Implement the public preview model**

Export this exact builder signature:

```ts
export function buildStoryGraphEditPreview(input: {
  libraryId: string;
  libraryName: string;
  before: EditableStoryGraph;
  after: EditableStoryGraph;
  changes: StoryGraphChange[];
  addedFields: string[];
  beforeValidation: ReturnType<typeof validateEditableStoryGraph>;
  afterValidation: ReturnType<typeof validateEditableStoryGraph>;
}): StoryGraphEditPreview;
```

Return:

```ts
export type StoryGraphEditPreview = {
  type: 'story_graph_edit';
  libraryId: string;
  libraryName: string;
  createdNodes: Array<{ label: string; contentSummary: string; rowIndex: number }>;
  edgeChanges: Array<{
    kind: 'added' | 'removed' | 'redirected' | 'next_changed' | 'ending_changed';
    fromLabel: string;
    text?: string;
    fromTarget?: string | null;
    toTarget?: string | null;
  }>;
  affectedRows: number[];
  addedFields: string[];
  warnings: Array<{ code: 'unreachable_node'; label: string }>;
  before: StoryGraphSummary;
  after: StoryGraphSummary;
};
```

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/validator.test.ts src/lib/story-graph/preview.test.ts`

Expected: PASS.

Run: `git add src/lib/story-graph/validator.ts src/lib/story-graph/preview.ts src/lib/story-graph/validator.test.ts src/lib/story-graph/preview.test.ts && git commit -m "feat: validate and preview story graph edits"`

---

### Task 4: Preserve And Repair Plot Groups After A Patch

**Files:**
- Create: `src/lib/story-graph/plotPlanUpdater.ts`
- Test: `src/lib/story-graph/plotPlanUpdater.test.ts`

- [ ] **Step 1: Write failing plot-plan update tests**

Test these exact cases:

- unaffected group IDs, titles, and memberships remain byte-for-byte equal;
- a created node gets its own plot node;
- a newly targeted story node is split out of a multi-row group;
- an affected decision is split when grouping would hide its choice edge;
- empty groups disappear;
- all story labels appear exactly once in `storyNodeOrder` and plot membership; and
- all edges are rederived from the patched executable graph.

```ts
const updated = updatePlotPlanAfterPatch(beforePlan, patchedGraph, changes);
expect(updated.nodes.find((node) => node.id === 'Untouched')).toEqual(
  beforePlan.nodes.find((node) => node.id === 'Untouched')
);
expect(updated.nodes.find((node) => node.id === 'EscapeRoute')).toEqual({
  id: 'EscapeRoute',
  title: 'The hero leaves through the back door.',
  storyNodeIds: ['EscapeRoute'],
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/plotPlanUpdater.test.ts`

Expected: FAIL because `updatePlotPlanAfterPatch` does not exist.

- [ ] **Step 3: Implement local group splitting and edge derivation**

Export:

```ts
export function updatePlotPlanAfterPatch(
  previous: StoryPlotPlan,
  graph: EditableStoryGraph,
  changes: StoryGraphChange[]
): StoryPlotPlan;
```

Preserve unaffected groups, split only changed decision/target boundaries, create deterministic titles from `plotTitle`, choice text, or compact content, and return version 2. Call `validateStoryPlotPlan(result, result.storyNodeOrder)` before returning.

- [ ] **Step 4: Run tests and commit**

Run: `npm run test:unit -- --runInBand src/lib/story-graph/plotPlanUpdater.test.ts src/lib/story-plot/validator.test.ts`

Expected: PASS.

Run: `git add src/lib/story-graph/plotPlanUpdater.ts src/lib/story-graph/plotPlanUpdater.test.ts && git commit -m "feat: update plot plans after graph patches"`

---

### Task 5: Add Project-Scoped Snapshot Loading And The Read Tool

**Files:**
- Create: `src/lib/story-graph/snapshotReader.ts`
- Create: `src/lib/agent/tools/read-story-graph.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Test: `tests/unit/agent/read-story-graph.test.ts`

- [ ] **Step 1: Write failing resolver and read-tool tests**

Mock Supabase and shared data access. Assert library resolution order is `libraryId`, exact `libraryName`, then `ctx.currentLibraryId`; cross-project libraries, `document_export_type !== 'script'`, invalid plans, and stale row counts return `STORY_GRAPH_UNSUPPORTED_LIBRARY` or `STORY_GRAPH_INVALID_SNAPSHOT`.

Assert the public result is compact:

```ts
expect(await readStoryGraph.execute({ libraryId }, ctx)).toMatchObject({
  success: true,
  displayHint: 'list',
  data: {
    libraryId,
    entryLabel: 'Intro',
    nodes: [
      expect.objectContaining({
        label: 'Decision',
        rowIndex: 2,
        outgoing: [
          { kind: 'choice', optionIndex: 0, text: 'Left', target: 'LeftEnd' },
        ],
      }),
    ],
  },
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/agent/read-story-graph.test.ts`

Expected: FAIL because the reader and tool do not exist.

- [ ] **Step 3: Implement snapshot loading**

Define `StoryGraphSnapshot` with library metadata, named field mappings, ordered asset metadata, decoded graph, and a canonical expected snapshot:

```ts
export type StoryGraphExpectedSnapshot = {
  libraryUpdatedAt: string;
  plotPlan: StoryPlotPlan;
  fields: Array<{ id: string; label: string; orderIndex: number }>;
  assets: Array<{ id: string; rowIndex: number; updatedAt: string }>;
};
```

Query raw `libraries`, `library_field_definitions`, `library_assets`, and `library_asset_values` so the snapshot retains update tokens omitted by `AssetRow`. Sort with canonical `row_index`, then `created_at`, then `id` semantics.

- [ ] **Step 4: Implement and register `read_story_graph`**

Use a strict selector schema with optional `libraryId` UUID and `libraryName`. Set `category: 'read'`; return stable labels, plot titles, 1-based row indexes, outgoing edges, warnings, and graph summary. Add the tool to `allTools`.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/agent/read-story-graph.test.ts tests/unit/agent/document-tools.test.ts`

Expected: PASS and the registry contains `read_story_graph`.

Run: `git add src/lib/story-graph/snapshotReader.ts src/lib/agent/tools/read-story-graph.ts src/lib/agent/tools/index.ts tests/unit/agent/read-story-graph.test.ts && git commit -m "feat: add Agent story graph reader"`

---

### Task 6: Add The Atomic Story Graph Patch RPC

**Files:**
- Create: `supabase/migrations/20260805120000_agent_story_graph_patch.sql`
- Create: `tests/unit/database/agent-story-graph-patch-migration.test.ts`
- Create: `src/lib/story-graph/atomicWriter.ts`
- Test: `src/lib/story-graph/atomicWriter.test.ts`

- [ ] **Step 1: Write failing migration static tests**

Assert the migration defines `public.apply_story_graph_patch`, uses `SECURITY INVOKER` and `auth.uid()`, checks owner/editor/admin access, locks the library and asset rows with `FOR UPDATE`, compares expected library/field/asset/plot state before mutation, touches ancestor timestamps, grants only `authenticated`, and never grants `anon` or `public`.

```ts
expect(migration).toMatch(/create or replace function public\.apply_story_graph_patch/i);
expect(migration).toMatch(/security invoker/i);
expect(migration).not.toMatch(/security definer/i);
expect(migration).toMatch(/for update/i);
expect(migration).toMatch(/is_editor_or_admin_collaborator/i);
expect(migration).toMatch(/STORY_GRAPH_CONFLICT/i);
expect(migration).toMatch(/grant execute[\s\S]+to authenticated/i);
expect(migration).not.toMatch(/grant execute[\s\S]+to anon/i);
```

- [ ] **Step 2: Run the migration test and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/database/agent-story-graph-patch-migration.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement the RPC contract**

Use this SQL signature:

```sql
public.apply_story_graph_patch(
  p_library_id uuid,
  p_expected_snapshot jsonb,
  p_new_fields jsonb,
  p_asset_inserts jsonb,
  p_asset_updates jsonb,
  p_plot_plan jsonb
) returns jsonb
```

Declare the function `LANGUAGE plpgsql SECURITY INVOKER SET search_path = public`. `p_asset_updates` contains only changed existing rows with `id`, `name`, `rowIndex`, and field-id-keyed `values`. `p_asset_inserts` uses caller-generated UUIDs with the same shape. For `p_new_fields`, insert `data_type = 'string'`, `required = false`, `section = '__keco_flat_fields__'`, and `section_id = p_library_id::text || ':keco-flat-fields'`. The function rejects any asset or field outside the target library, checks the final `plot_plan` is an object, performs all inserts/upserts/order changes in one transaction, updates `libraries.updated_at`, and returns `{ "libraryId": ..., "updatedAt": ... }`.

- [ ] **Step 4: Write failing TypeScript writer tests**

Mock `supabase.rpc` and assert `applyStoryGraphMutation` passes the exact snake-case RPC keys, maps a snapshot mismatch to `STORY_GRAPH_CONFLICT`, maps SQLSTATE `42501` to `STORY_GRAPH_PERMISSION_DENIED`, and returns the new timestamp.

- [ ] **Step 5: Implement `atomicWriter.ts`**

Export:

```ts
export type StoryGraphAssetMutation = {
  id: string;
  name: string;
  rowIndex: number;
  values: Record<string, string>;
};

export type StoryGraphMutation = {
  expectedSnapshot: StoryGraphExpectedSnapshot;
  newFields: Array<{ id: string; label: string; orderIndex: number }>;
  assetInserts: StoryGraphAssetMutation[];
  assetUpdates: StoryGraphAssetMutation[];
  plotPlan: StoryPlotPlan;
};

export async function applyStoryGraphMutation(
  supabase: SupabaseClient,
  libraryId: string,
  mutation: StoryGraphMutation
): Promise<{ libraryId: string; updatedAt: string }>;
```

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/database/agent-story-graph-patch-migration.test.ts src/lib/story-graph/atomicWriter.test.ts`

Expected: PASS.

Run: `git add supabase/migrations/20260805120000_agent_story_graph_patch.sql tests/unit/database/agent-story-graph-patch-migration.test.ts src/lib/story-graph/atomicWriter.ts src/lib/story-graph/atomicWriter.test.ts && git commit -m "feat: add atomic story graph patch RPC"`

---

### Task 7: Add The Post-Preview Agent Write Tool

**Files:**
- Create: `src/lib/agent/tools/propose-story-graph-edit.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Test: `tests/unit/agent/propose-story-graph-edit.test.ts`

- [ ] **Step 1: Write failing tool metadata and preview tests**

Assert the tool is registered with:

```ts
expect(proposeStoryGraphEdit).toMatchObject({
  name: 'propose_story_graph_edit',
  category: 'write',
  confirmationMode: 'post_preview',
  confirmationPolicy: 'mode',
  requiredPermission: 'editor',
});
```

Assert `execute` loads a snapshot, applies all operations, updates the plot plan, validates the result, builds `type: 'story_graph_edit'` preview data, and performs no RPC call.

- [ ] **Step 2: Write failing sealed-confirmation tests**

Cover changed params, changed internal payload, unsigned preview, stale snapshot, permission denial, and successful application. On success assert one Library invalidation:

```ts
expect(result.invalidations).toEqual([
  { type: 'library', id: libraryId, projectId: ctx.projectId },
]);
```

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/agent/propose-story-graph-edit.test.ts`

Expected: FAIL because the write tool does not exist.

- [ ] **Step 4: Implement preview execution**

Follow `propose-document-edit.ts`: validate the selector plus `StoryGraphPatchSchema`, load the current snapshot, apply and normalize the patch, update the plot plan, validate, encode only changed rows/new fields, and return public preview data plus signed `internalData` containing the canonical selector, normalized patch, and expected snapshot.

Use `getAgentConfirmationSigningSecret()` and HMAC-SHA256 over user ID, conversation ID, project ID, library ID, normalized patch, and expected snapshot.

- [ ] **Step 5: Implement confirmed execution**

In `executeImport`, parse params and internal data, verify the signature, reload the snapshot, compare it exactly, reapply the normalized patch, revalidate, reconstruct the same mutation, and call `applyStoryGraphMutation`. Return counts and warnings plus the Library invalidation. Map stale state to `STORY_GRAPH_CONFLICT` and never retry automatically.

- [ ] **Step 6: Run tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/agent/propose-story-graph-edit.test.ts tests/unit/agent/conversation-meta.test.ts tests/unit/agent/resume-confirmation-core.test.ts`

Expected: PASS.

Run: `git add src/lib/agent/tools/propose-story-graph-edit.ts src/lib/agent/tools/index.ts tests/unit/agent/propose-story-graph-edit.test.ts && git commit -m "feat: add Agent story graph edit tool"`

---

### Task 8: Teach The Agent To Route Story Graph Requests Safely

**Files:**
- Modify: `src/lib/agent/prompts.ts`
- Modify: `src/lib/agent/tool-result-for-llm.ts`
- Test: `tests/unit/agent/system-prompt.test.ts`
- Test: `tests/unit/agent/tool-result-for-llm.test.ts`

- [ ] **Step 1: Write failing system prompt tests**

Assert the prompt says:

- use `read_story_graph` before any graph write;
- target stable labels returned by the latest read;
- use `propose_story_graph_edit` for branch/node/jump/merge/ending changes;
- do not use `update_asset` or `update_row` for multi-row graph changes; and
- do not claim disconnected nodes were deleted.

- [ ] **Step 2: Write failing compaction tests**

Build a large `read_story_graph` result and assert `compactToolContentForLlm` keeps entry, summary, warnings, and the first bounded node set with an explicit truncation note. Build a write preview and assert internal mutation rows and signatures never reach the LLM.

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/agent/system-prompt.test.ts tests/unit/agent/tool-result-for-llm.test.ts`

Expected: FAIL because graph routing and compaction are absent.

- [ ] **Step 4: Implement routing and bounded result compaction**

Add a `STORY GRAPH EDITS` prompt section after document-derived generation. Add a `compactReadStoryGraphPayload` branch that keeps at most 80 nodes within `MAX_TOOL_CONTENT_CHARS`, reports `visibleNodeCount`/`nodeCount`, and instructs the model to narrow by label if truncated. Add a `propose_story_graph_edit` branch that keeps only public diff/summary data.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/agent/system-prompt.test.ts tests/unit/agent/tool-result-for-llm.test.ts`

Expected: PASS.

Run: `git add src/lib/agent/prompts.ts src/lib/agent/tool-result-for-llm.ts tests/unit/agent/system-prompt.test.ts tests/unit/agent/tool-result-for-llm.test.ts && git commit -m "feat: route Agent story graph edits"`

---

### Task 9: Render Story Graph Diffs In The Confirmation Card

**Files:**
- Modify: `src/components/agent/ConfirmationCard.tsx`
- Modify: `src/components/agent/ChatPanel.module.css`
- Test: `tests/unit/agent/document-confirmation-ui.test.tsx`

- [ ] **Step 1: Write failing static-render tests**

Render a `propose_story_graph_edit` confirmation with created nodes, added/redirected/removed edges, summary counts, and an unreachable warning. Assert visible labels and semantic sections, and assert raw JSON/UUID mutation payloads are absent:

```ts
expect(markup).toContain('Confirm: Modify story graph');
expect(markup).toContain('EscapeRoute');
expect(markup).toContain('MainChoice');
expect(markup).toContain('Unreachable after this edit');
expect(markup).not.toContain('expectedSnapshot');
expect(markup).not.toContain('assetUpdates');
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm run test:unit -- --runInBand tests/unit/agent/document-confirmation-ui.test.tsx`

Expected: FAIL because the generic confirmation card does not render graph diffs.

- [ ] **Step 3: Add a typed graph preview branch**

Define a local `StoryGraphEditPreview` guard, detect `preview.type === 'story_graph_edit'`, and render compact unframed sections for nodes, edge changes, counts, and warnings. Reuse existing confirmation action buttons and resolved states. Do not render a nested card or a second SVG graph.

- [ ] **Step 4: Add restrained styles**

Add selectors for a dense change list, monospace labels, added/removed change markers, summary grid, and warning text. Keep the existing card radius and color tokens; ensure long labels wrap with `overflow-wrap: anywhere`.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:unit -- --runInBand tests/unit/agent/document-confirmation-ui.test.tsx tests/unit/agent/assistant-message.test.tsx`

Expected: PASS.

Run: `git add src/components/agent/ConfirmationCard.tsx src/components/agent/ChatPanel.module.css tests/unit/agent/document-confirmation-ui.test.tsx && git commit -m "feat: preview Agent story graph edits"`

---

### Task 10: Add Database Behavior Coverage And Verify End To End

**Files:**
- Create: `tests/unit/database/agent-story-graph-tools.rls.behavior.test.ts`
- Modify: `tests/e2e/specs/agent-chat.spec.ts`
- Verify: all files changed by Tasks 1-9

- [ ] **Step 1: Write live-database behavior tests**

Following `document-agent-tools.rls.behavior.test.ts`, create a generated Script fixture and test:

- owner and editor can read and apply a confirmed node-plus-choice patch;
- viewer can read but confirmed write fails;
- outsider and cross-project actors cannot read or write;
- a second edit between preview and confirmation produces `STORY_GRAPH_CONFLICT`; and
- a deliberately invalid payload leaves fields, rows, values, and `plot_plan` unchanged.

Gate the suite with `RLS_DB_TESTS_ENABLED` and clean every fixture in `afterAll`.

- [ ] **Step 2: Run the database behavior test**

Run: `npm run test:unit -- --runInBand tests/unit/database/agent-story-graph-tools.rls.behavior.test.ts`

Expected without DB test credentials: suite is skipped cleanly. Expected with credentials: all cases pass.

- [ ] **Step 3: Add the Agent browser flow**

In `agent-chat.spec.ts`, seed a document-derived Script, open its Agent conversation, request `Add an EscapeRoute ending and add "Escape" as a choice from MainChoice`, assert `read_story_graph` runs before `propose_story_graph_edit`, approve the preview, and assert the refreshed flow chart contains `EscapeRoute` and an `Escape` edge label.

- [ ] **Step 4: Run all focused unit tests**

Run:

```bash
npm run test:unit -- --runInBand \
  src/lib/story-graph \
  src/lib/script-system/buildPersistedPlotGraph.test.ts \
  src/components/script-system/FlowChartPanel.test.tsx \
  tests/unit/agent/read-story-graph.test.ts \
  tests/unit/agent/propose-story-graph-edit.test.ts \
  tests/unit/agent/system-prompt.test.ts \
  tests/unit/agent/tool-result-for-llm.test.ts \
  tests/unit/agent/document-confirmation-ui.test.tsx \
  tests/unit/database/agent-story-graph-patch-migration.test.ts
```

Expected: zero failed suites and zero failed tests.

These existing Script tests prove the updated persisted plan still maps to row indexes and that `FlowChartPanel` renders branches/merges without requiring production changes to the visualization component.

- [ ] **Step 5: Run type checks and lint**

Run: `npm run typecheck && npm run typecheck:api`

Expected: both exit with code 0.

Run:

```bash
npx eslint \
  src/lib/story-graph \
  src/lib/agent/tools/read-story-graph.ts \
  src/lib/agent/tools/propose-story-graph-edit.ts \
  src/lib/agent/tools/index.ts \
  src/lib/agent/prompts.ts \
  src/lib/agent/tool-result-for-llm.ts \
  src/components/agent/ConfirmationCard.tsx \
  tests/unit/agent/read-story-graph.test.ts \
  tests/unit/agent/propose-story-graph-edit.test.ts
```

Expected: no ESLint errors.

- [ ] **Step 6: Run the targeted browser test**

Run: `npm run test:e2e -- tests/e2e/specs/agent-chat.spec.ts --grep "edit story graph"`

Expected with the configured local test environment: PASS and the new node/edge are visible after confirmation.

- [ ] **Step 7: Check the final diff and commit verification coverage**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intended story-graph implementation/test files plus any pre-existing user changes.

Run: `git add tests/unit/database/agent-story-graph-tools.rls.behavior.test.ts tests/e2e/specs/agent-chat.spec.ts && git commit -m "test: cover Agent story graph editing"`
