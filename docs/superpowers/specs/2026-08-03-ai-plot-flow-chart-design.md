# AI Plot Flow Chart

**Date:** 2026-08-03  
**Status:** Approved design, pending written-spec review

## Goal

Make the Keco Script flow chart a plot-level navigation tree. The chart displays only plot nodes. Choices are labels on outgoing edges rather than standalone nodes. Selecting a plot node filters the left script pane to the dialogue, action, narration, and scene rows assigned to that plot node.

The plot structure is produced while the script is generated. Opening or selecting the chart must not make an LLM request.

## Current State

`buildScriptFlowGraph` reads the generated script table directly. It creates chart nodes only for non-empty `Label` cells and creates edges only from `OptionN_Next` cells. It does not model semantic plot groups, ordinary continuation edges, or the membership of script rows in a plot node. `FlowChartPanel` renders these labels as SVG nodes, and selecting a node currently changes only the node style. The left `VisualNovelScriptView` continues to show the complete script.

This row-level graph cannot support the requested interaction because script rows and plot nodes have different granularity.

## Product Behavior

### Chart

- Render only plot nodes, such as `Opening Dialogue`, `Empress Decision`, and `Night Talk`.
- Render ordinary plot progression as an unlabeled edge.
- Render each branch choice as an edge whose label is the option text.
- Multiple options from one plot node produce multiple labeled outgoing edges.
- Never create a standalone option node.
- Use the persisted entry plot node as the initial selection.
- Keep selected-node styling and keyboard activation.
- A node title must fit within its node; long titles use bounded wrapping or truncation with a tooltip.

### Script pane

- Selecting a plot node replaces the left pane contents with only that node's assigned script rows.
- Preserve original row order.
- Include dialogue, named action nodes, narration, and scene text assigned to the plot node.
- Preserve existing visual-novel presentation rules, including protagonist dialogue on the right and supporting dialogue on the left.
- Do not show rows from sibling or unselected plot branches.
- Render all assigned rows immediately in plot-node mode; do not execute cross-node jumps or render choices as left-pane buttons.
- The chart owns plot navigation. Changing the graph selection resets left-pane scroll and transient state.

### Empty and invalid states

- A script with no persisted plot graph uses the legacy compatibility builder described below.
- A plot node with no remaining rows after a source row is deleted remains visible but shows an empty-node message in the left pane.
- An edge with a missing target is omitted and reported as a non-blocking graph warning.
- If the entry node is missing, select the first valid plot node in stored order.

## Data Model

Persist plot data separately from visible script table fields so internal graph metadata does not appear as user columns.

### `script_plot_nodes`

- `id uuid primary key`
- `library_id uuid not null references libraries(id) on delete cascade`
- `stable_key text not null`
- `title text not null`
- `order_index integer not null`
- `is_entry boolean not null default false`
- unique `(library_id, stable_key)` and `(library_id, order_index)`

### `script_plot_node_rows`

- `plot_node_id uuid not null references script_plot_nodes(id) on delete cascade`
- `asset_id uuid not null references library_assets(id) on delete cascade`
- `order_index integer not null`
- primary key `(plot_node_id, asset_id)`
- unique `(plot_node_id, order_index)`
- unique `(asset_id)`

One script row belongs to exactly one plot node for generated plot graphs. Database validation must reject duplicate membership within the same library.

### `script_plot_edges`

- `id uuid primary key`
- `library_id uuid not null references libraries(id) on delete cascade`
- `from_plot_node_id uuid not null references script_plot_nodes(id) on delete cascade`
- `to_plot_node_id uuid not null references script_plot_nodes(id) on delete cascade`
- `option_text text null`
- `option_index integer null`
- `order_index integer not null`

`option_text = null` represents ordinary progression. A non-null option text represents a labeled choice edge. Choice edges from the same node retain option order.

All three tables use library/project membership RLS consistent with script-library reads. Only project admins may create a generated script, while existing library read permissions govern graph reads.

## Generation Pipeline

Introduce a versioned `StoryPlotPlan` sidecar:

```ts
type StoryPlotPlan = {
  version: 1;
  entryPlotNodeId: string;
  nodes: Array<{
    id: string;
    title: string;
    storyNodeIds: string[];
  }>;
  edges: Array<{
    fromPlotNodeId: string;
    toPlotNodeId: string;
    optionText: string | null;
    optionIndex: number | null;
  }>;
};
```

### Deterministic sources

When the source includes explicit headings such as `Opening`, `Plot Node`, `Ending`, or equivalent scene headings:

1. Start a plot node at each explicit heading.
2. Assign following story nodes to that plot node until the next plot heading or branch boundary.
3. Use branch option text for labeled edges.
4. Use normal story continuation for unlabeled edges.
5. Keep action and dialogue rows from one source line in the same plot node.

This path remains zero-LLM and preserves the current low-latency document conversion.

### Unstructured sources

For content that already requires the Extractor and Graph Planner, extend the existing structured Graph Planner result with plot grouping. Do not add a separate LLM round trip. The planner may create concise plot titles, but it may only group existing Story IR nodes and choices; it cannot add, omit, duplicate, or reorder visible story content.

The deterministic validator checks:

- every Story IR node belongs to exactly one plot node;
- every plot node contains at least one Story IR node;
- every edge references known plot nodes;
- choice edges preserve their source option text and order;
- entry and reachability are valid;
- sibling branches do not leak into each other's row membership.

The conversion cache version includes the `StoryPlotPlan` schema/prompt version. Cached plot plans remain isolated from older conversion results.

## Persistence

Extend script import so `StoryDocument` and `StoryPlotPlan` are published together.

1. Compile Story IR nodes to script rows as today.
2. Insert library fields and assets.
3. Retain the inserted asset IDs in source row order.
4. Resolve each `storyNodeId` in the plot plan to its inserted asset ID.
5. Insert plot nodes, row memberships, and edges.

The write must be atomic. Add a service-role-only transaction RPC or equivalent server transaction that creates the script library, rows, and plot graph together. On conflict or validation failure, no partial library or graph remains.

Ordinary table imports do not create plot graph records.

## Legacy Compatibility

Existing script libraries have no persisted plot graph. Build a read-only compatibility graph without calling AI:

- recognize scene/plot headings from Type 4 rows and known heading text;
- start additional plot nodes at branch targets;
- group intervening rows in physical order;
- derive labeled edges from `OptionN` and `OptionN_Next`;
- derive non-branch progression from physical order and `Commands` jump targets;
- generate stable fallback titles such as `Plot 1` only when no usable heading exists.

Compatibility data is not written automatically. A future explicit regenerate action may persist an AI-refined graph, but that action is outside this scope.

## Client Architecture

### Data loading

The script page loads plot nodes, memberships, and edges with the existing library rows. Convert memberships into:

- `rowsByPlotNodeId: Map<string, AssetRow[]>`
- `PlotFlowGraph` for layout and rendering

Keep plot graph query keys scoped by `libraryId`. Invalidate them with script-library regeneration or deletion.

### Selection ownership

`ScriptSplitView` owns `selectedPlotNodeId` because it coordinates both panes.

- `FlowChartPanel` receives the graph, selected ID, and `onSelectPlotNode`.
- `VisualNovelScriptView` receives only the selected node's filtered rows.
- Changing libraries resets selection to that graph's entry node.
- Collapsing and reopening the chart preserves selection during the current page session.

### Layout

Replace the current assumption that every labeled script row is a chart node. The layout input is the plot graph only. Edge paths carry optional option labels positioned near the first non-overlapping segment of the path. Normal edges render without labels.

The existing split-pane resize and top-bar collapse behavior remain unchanged.

## Error Handling

- Reject invalid AI plot plans before any database write.
- Treat missing graph records as a legacy script, not an import failure.
- Show a restrained warning inside the chart for omitted dangling edges.
- Do not expose raw model output, prompts, source text, or database errors in the UI.
- An unavailable plot graph must not prevent the script rows from opening.

## Performance

- Opening, selecting, collapsing, or laying out the chart makes zero LLM calls.
- Structured scripts retain the deterministic zero-LLM import path.
- Unstructured scripts reuse the existing Graph Planner request rather than adding another request.
- Filtering the left pane is an in-memory lookup by plot node ID.
- Memoize graph construction, layout, and selected row lists.

## Testing

- Plot-plan unit tests cover explicit headings, ordinary progression, multi-option branches, merges, entry selection, and branch isolation.
- Validation tests reject missing membership, duplicate membership, unknown targets, reordered choices, unreachable plot nodes, and branch leaks.
- Import service tests verify atomic plot graph persistence and cleanup on failure.
- RLS tests cover permitted library readers and denied cross-project access.
- Legacy builder tests cover Type 4 headings, branch targets, commands jumps, and fallback titles.
- Flow chart component tests verify plot-only nodes, edge labels, keyboard selection, long-title handling, and warnings.
- Split view tests verify that selection shows only the chosen plot node's rows and preserves row order.
- Telemetry/static tests verify that chart opening and selection never invoke the LLM client.
- Existing Story IR, script player, import-route, split-pane, typecheck, lint, and `git diff --check` suites must remain green.

## Out of Scope

- Dragging plot nodes to rewrite story structure.
- Editing option text or targets from the chart.
- Manually moving script rows between plot nodes.
- Automatically rewriting a legacy script graph in the database.
- Re-running AI when a chart node is selected or expanded.
