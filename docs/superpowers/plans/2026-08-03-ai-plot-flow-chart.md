# AI Plot Flow Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and persist plot-level script graphs, render choices as edge labels, and show only the selected plot node's script rows in the left pane.

**Architecture:** Add a validated `StoryPlotPlan` beside existing Story IR. Structured scripts build it deterministically; unstructured scripts return grouping in the existing Graph Planner call. Persist plot nodes, row memberships, and edges atomically with generated script rows, then render the persisted graph with a deterministic legacy fallback.

**Tech Stack:** TypeScript, Zod, Jest, Next.js 16, React 19, TanStack Query, Supabase/PostgreSQL RLS, SVG/CSS.

---

## File Map

- Create `src/lib/story-plot/schema.ts`: plot-plan contracts and parsing.
- Create `src/lib/story-plot/validator.ts`: complete membership, edge, and reachability validation.
- Create `src/lib/story-plot/deterministicBuilder.ts`: heading/branch-based zero-LLM grouping.
- Create `src/lib/story-plot/legacyBuilder.ts`: compatibility graph from existing table rows.
- Create `src/lib/services/scriptPlotGraphService.ts`: persisted graph reads and client DTOs.
- Create `src/lib/server/scriptStoryPublishService.ts`: atomic server publication boundary.
- Create `supabase/migrations/20260803100000_script_plot_graph.sql`: graph tables, RLS, and transaction RPC.
- Modify `src/lib/story-extraction/pipeline.ts` and `prompts.ts`: include plot grouping in the existing Graph Planner result.
- Modify `src/lib/story-plan/conversion.ts`: return validated `plotPlan` with every resolved story.
- Modify `src/lib/services/scriptImportService.ts`, the import route, and the agent import tool: publish plot plans.
- Replace row-label graph construction in `FlowChartPanel.tsx` with plot graph rendering.
- Modify `ScriptSplitView.tsx`, `VisualNovelScriptView.tsx`, and the script page: selection and row filtering.

### Task 1: Story Plot Domain

**Files:**
- Create: `src/lib/story-plot/schema.ts`
- Create: `src/lib/story-plot/validator.ts`
- Create: `src/lib/story-plot/schema.test.ts`
- Create: `src/lib/story-plot/validator.test.ts`

- [ ] **Step 1: Write failing schema and validation tests**

```ts
const plan = {
  version: 1,
  entryPlotNodeId: 'Opening',
  nodes: [
    { id: 'Opening', title: 'Opening', storyNodeIds: ['N1', 'N2'] },
    { id: 'Decision', title: 'Empress Decision', storyNodeIds: ['N3'] },
  ],
  edges: [{ fromPlotNodeId: 'Opening', toPlotNodeId: 'Decision', optionText: null, optionIndex: null }],
};
expect(parseStoryPlotPlan(plan)).toEqual(plan);
expect(() => validateStoryPlotPlan(plan, ['N1', 'N2', 'N3'])).not.toThrow();
expect(() => validateStoryPlotPlan({ ...plan, nodes: [plan.nodes[0]] }, ['N1', 'N2', 'N3']))
  .toThrow(/exactly one plot node/i);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest --runInBand src/lib/story-plot/schema.test.ts src/lib/story-plot/validator.test.ts`  
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the contracts and validator**

```ts
export type StoryPlotPlan = {
  version: 1;
  entryPlotNodeId: string;
  nodes: Array<{ id: string; title: string; storyNodeIds: string[] }>;
  edges: Array<{
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: string | null;
    optionIndex: number | null;
  }>;
};

export function validateStoryPlotPlan(plan: StoryPlotPlan, storyNodeIds: string[]): StoryPlotPlan {
  const knownPlots = new Set(plan.nodes.map((node) => node.id));
  if (!knownPlots.has(plan.entryPlotNodeId)) throw new Error('Unknown entry plot node');
  const owners = plan.nodes.flatMap((node) => node.storyNodeIds);
  if (owners.length !== new Set(owners).size) throw new Error('Story node belongs to more than one plot node');
  if (owners.length !== storyNodeIds.length || storyNodeIds.some((id) => !owners.includes(id))) {
    throw new Error('Every story node must belong to exactly one plot node');
  }
  if (plan.edges.some((edge) => !knownPlots.has(edge.fromPlotNodeId) || !knownPlots.has(edge.toPlotNodeId))) {
    throw new Error('Plot edge references an unknown plot node');
  }
  return plan;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx jest --runInBand src/lib/story-plot/schema.test.ts src/lib/story-plot/validator.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plot/schema.ts src/lib/story-plot/validator.ts src/lib/story-plot/*.test.ts
git commit -m "feat: add story plot plan contracts"
```

### Task 2: Deterministic Plot Grouping

**Files:**
- Create: `src/lib/story-plot/deterministicBuilder.ts`
- Create: `src/lib/story-plot/deterministicBuilder.test.ts`
- Modify: `src/lib/story-plan/conversion.ts`

- [ ] **Step 1: Write failing tests for headings, branches, and named actions**

```ts
const plan = buildDeterministicStoryPlotPlan(document);
expect(plan.nodes.map((node) => node.title)).toEqual(['Opening Dialogue', 'Empress Decision', 'Night Talk']);
expect(plan.edges.filter((edge) => edge.optionText).map((edge) => edge.optionText)).toEqual([
  'Answer defense -- stable route', 'Reply to empress -- loyal route', 'Reply to general -- alliance route',
]);
expect(plan.nodes.flatMap((node) => node.storyNodeIds)).toHaveLength(document.nodes.length);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/lib/story-plot/deterministicBuilder.test.ts`  
Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement deterministic grouping**

Create plot boundaries from `scene` nodes whose content matches opening/plot/ending headings, plus branch targets. Assign every Story IR node once in document order. Collapse story-node links into plot-node edges; preserve option text and option index on branch edges. Use `Plot 1`, `Plot 2`, etc. only when no explicit title exists.

```ts
export function buildDeterministicStoryPlotPlan(document: StoryDocument): StoryPlotPlan {
  const boundaries = collectPlotBoundaries(document);
  const nodes = groupStoryNodes(document.nodes, boundaries);
  return validateStoryPlotPlan({
    version: 1,
    entryPlotNodeId: plotForStoryNode(nodes, document.entryLabel),
    nodes,
    edges: collapseStoryEdges(document, nodes),
  }, document.nodes.map((node) => node.label));
}
```

- [ ] **Step 4: Attach `plotPlan` to deterministic conversion results and run tests**

Modify `ResolvedAuditedStory` to require `plotPlan: StoryPlotPlan`; build it immediately after materialization.  
Run: `npx jest --runInBand src/lib/story-plot/deterministicBuilder.test.ts src/lib/story-plan`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plot src/lib/story-plan/conversion.ts
git commit -m "feat: build deterministic plot graphs"
```

### Task 3: Reuse the Existing Graph Planner for Unstructured Sources

**Files:**
- Modify: `src/lib/story-extraction/pipeline.ts`
- Modify: `src/lib/story-extraction/prompts.ts`
- Modify: `src/lib/story-extraction/pipeline.test.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`

- [ ] **Step 1: Write failing structured-output tests**

```ts
const graph = parseStoryGraphExtraction({
  version: 3,
  entryNodeId: 'N1',
  nodeLinks: ['N1->N2', 'N2->'], choiceLinks: [], commandLinks: [],
  entryPlotNodeId: 'Plot1',
  plotNodes: [{ id: 'Plot1', title: 'Opening', storyNodeIds: ['N1', 'N2'] }],
  plotEdges: [],
});
expect(graph.plotNodes[0].storyNodeIds).toEqual(['N1', 'N2']);
```

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/lib/story-extraction/pipeline.test.ts src/lib/story-plan/conversion.test.ts`  
Expected: FAIL because strict parsing rejects plot fields.

- [ ] **Step 3: Extend the Graph Planner schema and prompt**

Add `entryPlotNodeId`, `plotNodes`, and `plotEdges` to both Zod and OpenAI tool schemas. In the prompt require complete one-to-one story-node membership, existing choice text/order, no content changes, and concise titles. Expose `storyPlotPlanFromGraph(graph)` and validate it against the combined StoryExtraction.

- [ ] **Step 4: Prove no extra LLM request is added**

Update conversion tests to expect the same Extractor and Graph Planner tool call list as before, with the plot plan returned by `submit_story_graph`.  
Run: `npx jest --runInBand src/lib/story-extraction src/lib/story-plan/conversion.test.ts`  
Expected: PASS and exactly two LLM calls on the document validation path for unstructured prose.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-extraction src/lib/story-plan/conversion.test.ts
git commit -m "feat: include plot grouping in graph planner"
```

### Task 4: Plot Graph Database Schema and Atomic Publish RPC

**Files:**
- Create: `supabase/migrations/20260803100000_script_plot_graph.sql`
- Create: `tests/unit/database/script-plot-graph-migration.test.ts`

- [ ] **Step 1: Write failing migration contract tests**

Assert the migration creates `script_plot_nodes`, `script_plot_node_rows`, and `script_plot_edges`; enables RLS; cascades on library/asset deletion; enforces unique `asset_id`; and revokes the publish RPC from public/anon/authenticated while granting service role.

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand tests/unit/database/script-plot-graph-migration.test.ts`  
Expected: FAIL because the migration is missing.

- [ ] **Step 3: Create tables, constraints, indexes, and RLS**

```sql
create table public.script_plot_nodes (
  id uuid primary key, library_id uuid not null references public.libraries(id) on delete cascade,
  stable_key text not null, title text not null, order_index integer not null,
  is_entry boolean not null default false,
  unique (library_id, stable_key), unique (library_id, order_index)
);
create table public.script_plot_node_rows (
  plot_node_id uuid not null references public.script_plot_nodes(id) on delete cascade,
  asset_id uuid not null unique references public.library_assets(id) on delete cascade,
  order_index integer not null, primary key (plot_node_id, asset_id),
  unique (plot_node_id, order_index)
);
create table public.script_plot_edges (
  id uuid primary key, library_id uuid not null references public.libraries(id) on delete cascade,
  from_plot_node_id uuid not null references public.script_plot_nodes(id) on delete cascade,
  to_plot_node_id uuid not null references public.script_plot_nodes(id) on delete cascade,
  option_text text, option_index integer, order_index integer not null
);
```

Add SELECT policies using the same project owner/accepted collaborator checks as libraries.

- [ ] **Step 4: Add `publish_script_story` transaction RPC**

The service-role-only function accepts actor/project/placement metadata plus JSONB columns, rows, and plot plan. It verifies the actor is an admin, creates the library/fields/assets/values, maps plot `storyNodeIds` by source row ordinal to inserted asset IDs, inserts graph records, and returns `{library_id,row_count,field_count}`. Any raised exception rolls back all writes.

- [ ] **Step 5: Run tests and commit**

Run: `npx jest --runInBand tests/unit/database/script-plot-graph-migration.test.ts`  
Expected: PASS.

```bash
git add supabase/migrations/20260803100000_script_plot_graph.sql tests/unit/database/script-plot-graph-migration.test.ts
git commit -m "feat: persist script plot graphs atomically"
```

### Task 5: Server Publication and Graph Reads

**Files:**
- Create: `src/lib/server/scriptStoryPublishService.ts`
- Create: `src/lib/services/scriptPlotGraphService.ts`
- Create: `src/lib/services/scriptPlotGraphService.test.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/agent/tools/import-script.ts`
- Modify: `src/lib/utils/queryKeys.ts`

- [ ] **Step 1: Write failing publication/read tests**

```ts
expect(admin.rpc).toHaveBeenCalledWith('publish_script_story', expect.objectContaining({
  p_actor_user_id: userId,
  p_plot_plan: plotPlan,
}));
expect(await getScriptPlotGraph(client, libraryId)).toEqual({ entryPlotNodeId: 'Plot1', nodes, edges });
```

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/lib/services/scriptPlotGraphService.test.ts tests/unit/api-import-script-route.test.ts`  
Expected: FAIL because publisher/read service is missing.

- [ ] **Step 3: Implement the server boundary**

`publishScriptStoryAsActor` compiles the StoryDocument, calls the service-role RPC, parses its one-row result, and never performs partial client-side inserts. Pass both `resolved.document` and `resolved.plotPlan` from the route and agent tool.

- [ ] **Step 4: Implement graph loading and query key**

```ts
export const getScriptPlotGraph = async (client: SupabaseClient, libraryId: string) => {
  const [nodes, memberships, edges] = await Promise.all([
    client.from('script_plot_nodes').select('*').eq('library_id', libraryId).order('order_index'),
    client.from('script_plot_node_rows').select('*'),
    client.from('script_plot_edges').select('*').eq('library_id', libraryId).order('order_index'),
  ]);
  return assembleScriptPlotGraph(nodes.data ?? [], memberships.data ?? [], edges.data ?? []);
};
```

Add `queryKeys.scriptPlotGraph(libraryId)` and invalidate it with library regeneration/deletion.

- [ ] **Step 5: Run tests and commit**

Run: `npx jest --runInBand src/lib/services/scriptPlotGraphService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/agent`  
Expected: PASS.

```bash
git add src/lib/server/scriptStoryPublishService.ts src/lib/services/scriptPlotGraphService* src/app/api/import-script/route.ts src/lib/agent/tools/import-script.ts src/lib/utils/queryKeys.ts
git commit -m "feat: publish and load plot graphs"
```

### Task 6: Legacy Compatibility Builder

**Files:**
- Create: `src/lib/story-plot/legacyBuilder.ts`
- Create: `src/lib/story-plot/legacyBuilder.test.ts`

- [ ] **Step 1: Write failing legacy grouping tests**

Cover Type 4 headings, physical continuation, `Commands: Jump X`, branch targets, option labels, missing headings (`Plot 1`), and dangling-target warnings.

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/lib/story-plot/legacyBuilder.test.ts`  
Expected: FAIL because the builder is missing.

- [ ] **Step 3: Implement the read-only builder**

```ts
export function buildLegacyPlotGraph(rows: AssetRow[], columns: ScriptColumns): ScriptPlotGraph {
  const boundaries = collectLegacyBoundaries(rows, columns);
  const nodes = groupRowsByBoundary(rows, boundaries);
  return {
    source: 'legacy',
    entryPlotNodeId: nodes[0]?.id ?? '',
    nodes,
    edges: deriveLegacyEdges(rows, nodes, columns),
    warnings: collectDanglingWarnings(rows, nodes, columns),
  };
}
```

- [ ] **Step 4: Run and verify GREEN**

Run: `npx jest --runInBand src/lib/story-plot/legacyBuilder.test.ts`  
Expected: PASS with no LLM mocks or requests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/story-plot/legacyBuilder.ts src/lib/story-plot/legacyBuilder.test.ts
git commit -m "feat: derive plot graphs for legacy scripts"
```

### Task 7: Plot-Only SVG and Edge Labels

**Files:**
- Modify: `src/components/script-system/FlowChartPanel.tsx`
- Modify: `src/components/script-system/ScriptSplitView.module.css`
- Create: `src/components/script-system/FlowChartPanel.test.tsx`
- Delete after migration: `src/lib/script-system/buildScriptFlowGraph.ts`

- [ ] **Step 1: Write failing component tests**

Render a three-node graph with two choice edges. Assert only three plot node groups exist, no option node exists, both option texts render on paths, selection callback receives the plot ID, keyboard Enter works, and a warning appears for dangling edges.

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/components/script-system/FlowChartPanel.test.tsx`  
Expected: FAIL because the panel still accepts raw rows.

- [ ] **Step 3: Change the panel contract and render labels**

```ts
type FlowChartPanelProps = {
  graph: ScriptPlotGraph;
  selectedPlotNodeId: string;
  onSelectPlotNode: (plotNodeId: string) => void;
  onClose?: () => void;
};
```

Render `<textPath>` or positioned `<text>` for `edge.optionText`; ordinary edges have no label. Use stable node dimensions, maximum two title lines, ellipsis, and a native `<title>` tooltip. Keep node selection and close behavior.

- [ ] **Step 4: Run component and wiring tests**

Run: `npx jest --runInBand src/components/script-system/FlowChartPanel.test.tsx tests/unit/script-system/script-split-wiring.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/script-system/FlowChartPanel* src/components/script-system/ScriptSplitView.module.css src/lib/script-system/buildScriptFlowGraph.ts
git commit -m "feat: render plot-only flow chart"
```

### Task 8: Selection Filters the Left Script Pane

**Files:**
- Modify: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `tests/unit/script-system/script-split-wiring.test.ts`
- Create: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Write failing selection tests**

Select `Plot2` and assert the left view receives only Plot2 assets in original order. Assert all selected rows render immediately, option buttons do not render, selection defaults to the entry node, changing libraries resets selection, and collapse/reopen preserves it.

- [ ] **Step 2: Run and verify RED**

Run: `npx jest --runInBand src/components/script-system/ScriptSplitView.test.tsx`  
Expected: FAIL because selection is local to `FlowChartPanel` and rows are unfiltered.

- [ ] **Step 3: Load persisted graph with legacy fallback**

The page queries `getScriptPlotGraph`; if no nodes exist, call `buildLegacyPlotGraph(flowRows, scriptColumns)`. Pass the resulting graph and asset rows into `ScriptSplitView`.

- [ ] **Step 4: Own selection in the split view**

```tsx
const [selectedPlotNodeId, setSelectedPlotNodeId] = useState(graph.entryPlotNodeId);
const selectedRows = useMemo(
  () => graph.nodes.find((node) => node.id === selectedPlotNodeId)?.assetIds
    .map((id) => rowsById.get(id)).filter(isDefined) ?? [],
  [graph, rowsById, selectedPlotNodeId]
);
<VisualNovelScriptView rows={selectedRows} scriptColumns={scriptColumns} mode="plot-node" />
<FlowChartPanel graph={graph} selectedPlotNodeId={selectedPlotNodeId} onSelectPlotNode={setSelectedPlotNodeId} />
```

In `mode="plot-node"`, render all supplied rows immediately, hide choice buttons/restart controls, do not execute commands or jumps, and reset the nearest scroll container on row-set change.

- [ ] **Step 5: Run tests and commit**

Run: `npx jest --runInBand src/components/script-system/ScriptSplitView.test.tsx tests/unit/script-system/script-split-wiring.test.ts src/components/libraries/components/scriptPlayer.test.ts`  
Expected: PASS.

```bash
git add src/app/'(dashboard)'/script-system/'[projectId]'/script/'[libraryId]'/page.tsx src/components/script-system src/components/libraries/components/VisualNovelScriptView.tsx tests/unit/script-system/script-split-wiring.test.ts
git commit -m "feat: filter script by selected plot node"
```

### Task 9: End-to-End Verification

**Files:**
- No planned production edits; any failure returns to the owning task before verification continues.

- [ ] **Step 1: Run exact source benchmark**

Run the existing complete document through `resolveStoryForImport` with the LLM key disabled. Verify one plot graph is returned, explicit plot titles are retained, all Story IR node IDs have one owner, options remain edge labels, and conversion stays on `validation_pass`.

- [ ] **Step 2: Run focused suites**

```bash
npx jest --runInBand src/lib/story-plot src/lib/story-plan src/lib/story-extraction src/lib/story-ir src/components/script-system tests/unit/api-import-script-route.test.ts tests/unit/script-system
```

Expected: all suites pass.

- [ ] **Step 3: Run static verification**

```bash
npm run typecheck
npm run typecheck:api
npx eslint src/lib/story-plot src/lib/server/scriptStoryPublishService.ts src/lib/services/scriptPlotGraphService.ts src/components/script-system src/components/libraries/components/VisualNovelScriptView.tsx
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Verify browser behavior at desktop and narrow widths**

Open the Script split page, confirm only plot nodes appear, option text stays on edges, selecting each node replaces the left contents, long titles do not overflow, and panes do not overlap.

- [ ] **Step 5: Commit final verification fixes**

```bash
git add -A
git commit -m "test: verify AI plot flow chart"
```
