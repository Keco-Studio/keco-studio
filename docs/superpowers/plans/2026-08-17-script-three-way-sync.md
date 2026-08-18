# Script Three-Way Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Script table rows, source-document blocks, and the persisted/right-side conversion graph synchronized without rerunning AI conversion.

**Architecture:** Add pure incremental graph and reorder transforms, then route Script mutations through the existing serialized synchronization boundary. Extend the atomic server/RPC payload to carry row order and a validated next `plot_plan`; document collaboration reuses the same pure reconciliation after its existing debounced compaction.

**Tech Stack:** Next.js, React Query, TypeScript, Supabase PostgreSQL RPC, Yjs/MDX document codec, Jest.

---

### Task 1: Stable Flow Graph Projection

**Files:**
- Create: `src/lib/script-system/reconcileScriptFlowGraph.ts`
- Create: `src/lib/script-system/reconcileScriptFlowGraph.test.ts`
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`

- [ ] **Step 1: Write failing tests for stable row identity**

Test a persisted two-node graph against previous/current asset rows. Insert, delete, content edit, and reorder rows while asserting node IDs and edges stay unchanged and `rowIndexes` follow row IDs:

```ts
expect(reconcileScriptFlowGraph({
  graph,
  previousRows: [row('a'), row('b'), row('c')],
  rows: [row('a'), row('new'), row('b'), row('c')],
})).toMatchObject({
  nodes: [
    { id: 'first', rowIndexes: [0, 1, 2] },
    { id: 'second', rowIndexes: [3] },
  ],
  edges: graph.edges,
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx jest src/lib/script-system/reconcileScriptFlowGraph.test.ts src/components/script-system/ScriptSplitView.test.tsx --runInBand`

Expected: FAIL because `reconcileScriptFlowGraph` and stable projection wiring do not exist.

- [ ] **Step 3: Implement the minimal pure reconciler**

Export:

```ts
export function reconcileScriptFlowGraph(input: {
  graph: FlowGraph;
  previousRows: readonly Pick<AssetRow, 'id'>[];
  rows: readonly Pick<AssetRow, 'id'>[];
}): FlowGraph
```

Map old node indexes to old row IDs, resolve those IDs in the current rows, and assign newly inserted IDs to the closest surrounding node. Preserve node IDs, labels, and edges. Drop empty nodes only when all of their prior rows were deleted.

- [ ] **Step 4: Wire `ScriptSplitView` to keep one graph identity**

Initialize graph state from `persistedGraph ?? buildScriptFlowGraph(flowRows)`. On row changes, call the pure reconciler using a previous-rows ref. Do not switch graph implementations based only on row count. Keep selection resolution by node ID and anchor row ID.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx jest src/lib/script-system/reconcileScriptFlowGraph.test.ts src/components/script-system/ScriptSplitView.test.tsx --runInBand`

Expected: PASS.

### Task 2: Document Reorder Command

**Files:**
- Modify: `src/lib/script-system/scriptDialogueDocumentSync.ts`
- Modify: `src/lib/script-system/scriptDialogueDocumentSync.test.ts`
- Modify: `src/lib/script-system/scriptDialogueDerivedTableSync.ts`
- Modify: `src/lib/script-system/scriptDialogueDerivedTableSync.test.ts`

- [ ] **Step 1: Write failing reorder tests**

Add a command:

```ts
{
  type: 'reorder',
  movingTexts: ['Ben：Wait'],
  targetText: 'Ada：Hello',
  edge: 'before',
}
```

Assert `applyScriptDialogueCommand` calls the existing AST move semantics, moving only uniquely matched dialogue blocks and leaving intervening narration in place. Assert ambiguous repeated text throws `SOURCE_MAPPING_AMBIGUOUS`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/lib/script-system/scriptDialogueDocumentSync.test.ts src/lib/script-system/scriptDialogueDerivedTableSync.test.ts --runInBand`

Expected: FAIL because `ScriptDialogueDocumentCommand` does not accept `reorder`.

- [ ] **Step 3: Implement reorder resolution**

Extend the command union with:

```ts
| {
    type: 'reorder';
    movingTexts: string[];
    targetText: string;
    edge: 'before' | 'after';
  }
```

Resolve each moving and target block by normalized unique text, reject overlap/ambiguity, then call `moveScriptSourceBlocks`. Extend derived-table planning with a reorder operation containing `expectedOrderIds` and `nextOrderIds`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx jest src/lib/script-system/scriptDialogueDocumentSync.test.ts src/lib/script-system/scriptDialogueDerivedTableSync.test.ts --runInBand`

Expected: PASS.

### Task 3: Incremental Plot Plan Patching

**Files:**
- Create: `src/lib/script-system/scriptPlotPlanSync.ts`
- Create: `src/lib/script-system/scriptPlotPlanSync.test.ts`
- Modify: `src/lib/server/scriptDialogueDocumentSyncService.ts`
- Modify: `src/lib/server/scriptDialogueDocumentSyncService.test.ts`

- [ ] **Step 1: Write failing plot-plan tests**

Cover edit preserving plan identity, insert assigning generated stable Story labels beside its anchor, delete removing labels and empty nodes, and reorder updating `storyNodeOrder` plus node `storyNodeIds` without altering unaffected edges.

```ts
expect(patchScriptPlotPlan(plan, {
  type: 'reorder',
  movingStoryNodeIds: ['LineB'],
  targetStoryNodeId: 'LineA',
  edge: 'before',
}).storyNodeOrder).toEqual(['LineB', 'LineA']);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/lib/script-system/scriptPlotPlanSync.test.ts src/lib/server/scriptDialogueDocumentSyncService.test.ts --runInBand`

Expected: FAIL because the plot-plan patcher does not exist.

- [ ] **Step 3: Implement and validate the patcher**

Export a discriminated command type and `patchScriptPlotPlan(plan, command)`. Validate the result with `parseStoryPlotPlan` and `validateStoryPlotPlan(..., result.storyNodeOrder, { allowUnreachable: true })`. Generate inserted IDs from the dialogue block UUID by stripping separators and prefixing `Line`, keeping IDs within the existing label pattern.

- [ ] **Step 4: Add plot plan to server synchronization**

Load the Script library `plot_plan`, build the next plan beside the document/table transforms, and pass it to `replaceDocumentAsAgent` only when a plan exists. Return the updated plan to the client response.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx jest src/lib/script-system/scriptPlotPlanSync.test.ts src/lib/server/scriptDialogueDocumentSyncService.test.ts --runInBand`

Expected: PASS.

### Task 4: Atomic Database Contract

**Files:**
- Create: `supabase/migrations/20260817170000_script_three_way_sync.sql`
- Create: `tests/unit/database/script-three-way-sync-migration.test.ts`
- Modify: `src/lib/server/documentAgentEditService.ts`
- Modify: `tests/unit/documents/document-agent-edit-service.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

Assert the new RPC accepts `p_plot_plan jsonb`, validates it is an object, locks the target Script library, updates `libraries.plot_plan` in the same transaction as document/table operations, supports `reorder`, validates expected/current row orders, and retains service-role-only grants.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest tests/unit/database/script-three-way-sync-migration.test.ts tests/unit/documents/document-agent-edit-service.test.ts --runInBand`

Expected: FAIL because the RPC overload and service payload do not exist.

- [ ] **Step 3: Add the RPC overload**

Replace the atomic sync function with an overload containing `p_script_library_id uuid`, `p_plot_plan jsonb`, and reorder fields. Validate library/document/project relationships before writes. Apply row-index updates using one `unnest(nextOrderIds) with ordinality` update, then update `plot_plan` before returning.

- [ ] **Step 4: Extend `replaceDocumentAsAgent`**

Accept:

```ts
scriptConversion?: {
  libraryId: string;
  plotPlan: StoryPlotPlan;
}
```

Select the three-way RPC only when derived operations or script conversion are present; otherwise preserve the plain replacement RPC.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npx jest tests/unit/database/script-three-way-sync-migration.test.ts tests/unit/documents/document-agent-edit-service.test.ts --runInBand`

Expected: PASS.

### Task 5: Client Reorder And Cache Synchronization

**Files:**
- Modify: `src/components/script-system/useScriptDialogueEditor.ts`
- Modify: `src/components/script-system/useScriptDialogueEditor.test.ts`
- Modify: `src/lib/script-system/scriptDialogueDocumentSyncClient.ts`
- Modify: `src/lib/script-system/scriptDialogueDocumentSyncClient.test.ts`
- Modify: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`

- [ ] **Step 1: Write failing client tests**

Assert reorder sends the document command before committing visible cache order, returns `plotPlan`, updates `queryKeys.libraryAssets(libraryId)` with `applyRowOrder` semantics, updates `queryKeys.library(libraryId)`, and invalidates document state in the background.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/components/script-system/useScriptDialogueEditor.test.ts src/lib/script-system/scriptDialogueDocumentSyncClient.test.ts --runInBand`

Expected: FAIL on missing reorder command/result fields and cache updates.

- [ ] **Step 3: Wire reorder through the synchronization boundary**

Build moving text from `sourceTextForDialogueBlock`, choose the adjacent target after applying the requested block order, call `syncSource({ type: 'reorder', ... })`, then apply returned row order and plot plan to query caches. Keep generic table-only reorder for libraries without a source document.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx jest src/components/script-system/useScriptDialogueEditor.test.ts src/lib/script-system/scriptDialogueDocumentSyncClient.test.ts src/components/script-system/ScriptSplitView.test.tsx --runInBand`

Expected: PASS.

### Task 6: Debounced Document-Originated Reconciliation

**Files:**
- Create: `src/lib/script-system/scriptDocumentReconciliation.ts`
- Create: `src/lib/script-system/scriptDocumentReconciliation.test.ts`
- Create: `src/app/api/script-document-reconcile/route.ts`
- Create: `tests/unit/script-system/script-document-reconcile-route.test.ts`
- Modify: `src/components/documents/useDocumentCollaboration.ts`
- Modify: `src/components/documents/useDocumentCollaboration.test.ts`

- [ ] **Step 1: Write failing anchored-diff tests**

Compare previous/current `listScriptSourceBlocks` results and return a command only for one unambiguous edit, insert, delete, or reorder. Return `{ type: 'ambiguous' }` for multiple unrelated free-text changes.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx jest src/lib/script-system/scriptDocumentReconciliation.test.ts tests/unit/script-system/script-document-reconcile-route.test.ts --runInBand`

Expected: FAIL because reconciliation does not exist.

- [ ] **Step 3: Implement reconciliation route**

Authenticate with `withAuth`, read the previous synchronized snapshot and current compacted state, derive one safe command, prepare Script table and plot-plan changes, and execute the guarded atomic RPC. A no-op returns 204; ambiguity returns 409 without changing table/plan.

- [ ] **Step 4: Hook the existing compaction callback**

After `onCompacted`, schedule one reconciliation request for linked documents. Reuse the existing two-second compaction debounce and coalesce overlapping requests by document ID. Do not block editor input or the existing embedding reindex request.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npx jest src/lib/script-system/scriptDocumentReconciliation.test.ts tests/unit/script-system/script-document-reconcile-route.test.ts src/components/documents/useDocumentCollaboration.test.ts --runInBand`

Expected: PASS.

### Task 7: Regression Verification

**Files:**
- No additional production files.

- [ ] **Step 1: Run Script and document synchronization suites**

Run: `npx jest src/components/script-system src/lib/script-system src/lib/server/scriptDialogueDocumentSyncService.test.ts tests/unit/documents/document-agent-edit-service.test.ts tests/unit/database/script-three-way-sync-migration.test.ts --runInBand`

Expected: PASS with zero failures.

- [ ] **Step 2: Run type and lint checks**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npx eslint src/components/script-system src/lib/script-system src/lib/server/scriptDialogueDocumentSyncService.ts src/components/documents/useDocumentCollaboration.ts`

Expected: exit code 0.

- [ ] **Step 3: Verify scope and whitespace**

Run: `git diff --check`

Expected: no whitespace errors. Inspect `git diff --stat` and preserve unrelated user changes.
