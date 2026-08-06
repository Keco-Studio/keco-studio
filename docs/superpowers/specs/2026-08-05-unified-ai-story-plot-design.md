# Unified AI Story And Plot Planning

**Date:** 2026-08-05
**Status:** Proposed

## Goal

Generate one canonical story plan for imported scripts. A single AI structure call must identify player decisions, branch ownership, merges, and human-readable plot-node titles. The server materializes visible Story IR nodes, validates relationships, derives plot edges, and persists one `plot_plan` used by both the left Script pane and the right Flow Chart.

## Problems Addressed

- Left Script rows and right Flow Chart can currently be grouped by different interpretations.
- The API import path and Agent import path can enable different plot-planning behavior.
- A second Plot Planner call can rename or regroup already-canonical story nodes.
- Plot-node titles are not consistently tied to the same branch structure that controls row membership.

## Non-Goals

- Adding manual editing of plot nodes or plot edges.
- Changing the Script table schema or Visual Novel row renderer.
- Rewriting legacy libraries that already contain a valid `plot_plan`.
- Generating new visible story prose that is absent from the source.

## Canonical Data Flow

```text
source text
  -> deterministic source segmentation only
  -> one Branch Planner call (one targeted repair retry)
       decisions, options, route ownership, merges, plot groups, titles
  -> server Story IR materialization
  -> graph and plot validation
  -> deterministic plot-edge projection
  -> persisted plot_plan
  -> left rows from selected plot storyNodeIds
  -> right Flow Chart from the same plot nodes and edges
```

## AI Contract

Extend the Branch Planner response with a `plotGroups` collection:

```ts
type PlotGroup = {
  title: string;
  sourceUnitIds: string[];
};
```

The existing decision fields remain source-unit based:

- `ownerUnitId` identifies the visible decision owner.
- Each option contains exact source choice text and exclusive `routeUnitIds`.
- Each option contains its own `nextUnitId`, allowing siblings to reach different endings or one option to rejoin another branch.
- `mergeUnitId` identifies the first shared visible unit, or `null` for terminal routes.
- `breakAfterUnitIds` identifies every independent terminal unit so source-order endings never link to each other.
- When paths share setup and later diverge by earlier history, the AI repeats those setup unit IDs in each affected route. The server creates exact, non-authoritative replay references so every path preserves source playback order without inventing conditional choices.
- `plotGroups` covers every visible source unit exactly once, excluding choice-only and structural units.
- Titles are concise summaries produced by the same AI response. The server may use a deterministic fallback title only when the title is blank after validation; it must not invoke a second naming model.

The retry request includes the previous parseable structure and concrete validation issues. A repair must preserve valid decisions, route ownership, and titles unless an issue names that relationship.

Branch Planner requests use compact `u0`, `u1`, ... aliases for source units. The server maps aliases back to canonical source IDs before materialization; compact IDs keep long route and Plot-group JSON below provider response-size limits.

## Server Responsibilities

The server remains authoritative for content and graph completion:

1. Map `plotGroups.sourceUnitIds` to the canonical Story node IDs created from source segmentation.
2. Assign each visible Story node to exactly one Plot node.
3. Assign stable Plot node IDs from the first mapped Story node; AI supplies titles, not database IDs.
4. Derive Plot edges only from Story IR `options` and `next` links. Preserve option text and option order.
5. Validate unknown units, omitted or duplicate visible ownership, unreachable nodes, automatic cycles, sibling leakage, hidden choice targets, incomplete plot coverage, and unreachable Plot nodes.
6. Reject Plot groups that contain disconnected Story nodes or content from more than one mutually exclusive sibling route.
7. Reject invalid candidates and send validation issues to the one repair retry. Do not cut edges, delete choices, infer merges, or attach orphan nodes to make a candidate pass.

Human-readable branch formats always use the Branch Planner. Only the strict machine-label format remains eligible for a zero-AI deterministic fast path; heuristic natural-language parsers are test-only compatibility helpers.

## Entry-Point Consistency

Document upload, Document-derived Generate conversation, and Agent `import_script` must all use the same Branch Planner contract and deterministic Plot projection. The standalone Plot Planner option is removed from these import paths. Existing `enableAiPlotPlanning` callers are either removed or forced to `false` for import conversion.

## Persistence And Compatibility

- Persist the resulting `plot_plan` with the generated Script library in the existing library column.
- Bump the conversion cache version and Plot plan version together.
- Continue reading valid legacy `plot_plan` values without migration.
- If an old or malformed plan cannot be validated, use the existing row-based graph fallback for display only; never use that fallback as the source of persisted canonical data.

## Left And Right Views

`ScriptSplitView` keeps its current selection behavior. Selecting a Plot node uses that node's persisted `storyNodeIds` to select rows in the left pane. `FlowChartPanel` renders the same Plot node IDs, titles, and persisted edges. Rendering changes may improve routing and merge junctions but must not alter membership or graph semantics.

## Error Handling

- After the initial Branch Planner response and one targeted repair response fail validation, return the final concrete issue to the import route.
- Failed conversions are not cached.
- A missing optional title uses a deterministic title based on a heading, option text, or ending marker; title fallback does not change branch ownership.

## Tests And Acceptance

- One successful arbitrary-story conversion calls Branch Planner once and never calls Plot Planner.
- A repair call includes the previous structure and validation issues.
- The final failed candidate is rejected rather than silently repaired.
- Plot groups cover all visible Story nodes exactly once and preserve AI titles.
- Canonical option edges and merge edges are projected without sibling leakage.
- API, Document-derived, and Agent imports produce the same plot-planning behavior.
- Selecting a persisted Plot node displays exactly its `storyNodeIds` on the left.
- Legacy valid plans still render; malformed plans fall back to display-only row graphs.
- Run Story extraction/plan/plot tests, Script UI tests, route tests, type checks, targeted lint, and `git diff --check`.
