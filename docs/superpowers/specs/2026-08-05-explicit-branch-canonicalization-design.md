# Explicit Branch Canonicalization

**Date:** 2026-08-05
**Status:** Approved for implementation

## Goal

Make explicit screenplay branches accurate and stable across nested formats such as `选择 A`, `嵌套选择 A1`, `分支 A`, and `子分支 B1 结局`. Explicit source markers are hard ownership evidence that AI output cannot override. Natural-language prose without explicit markers continues to use the Branch Planner.

## Root Cause

Visible outcome markers currently serve two roles: story content and branch boundaries. Explicit part ownership starts after each marker, so the marker unit itself remains unowned. If the Branch Planner omits that unit from `routeUnitIds`, grouped materialization treats it as shared source-order content. This can connect sibling endings sequentially or leave an ending unreachable.

The import path also accepts Branch Planner `plotGroups` whenever present, even when AI plot planning is disabled. A valid Story graph can therefore be displayed with branch content grouped under the wrong plot node.

## Architecture

### Explicit Marker Classification

Classify recognized branch markers into:

- choice declarations, such as `选择 A` and `嵌套选择 A1`;
- pure structural body labels, such as `分支 A（...）`;
- visible outcomes, such as `子分支 B1 结局（...）`;
- common merge boundaries.

Visible outcomes remain Story content. Pure body labels remain structural. Both carry a normalized branch code.

### Canonical Route Ownership

Before graph materialization, build a source-unit ownership map from explicit body and outcome markers. A visible outcome marker owns itself. Following visible content belongs to that code until the next sibling/ancestor marker or common boundary.

For every unambiguously owned unit:

1. remove it from incompatible option routes;
2. assign it to the unique option whose code exactly matches the owner;
3. preserve source order within that route;
4. keep parent-owned setup available to descendant options only through existing replay rules.

If no unique matching option exists, retain the concrete validation failure. Do not guess a sibling or create a cross-branch edge.

Known deterministic parsers remain the first choice for formats they fully recognize. The Branch Planner plus canonical ownership handles mixed explicit prose. Unmarked prose remains AI-planned.

### Graph Completion

Unclaimed visible units inside an explicit branch region must not enter the global shared source-order chain. They must either be assigned by canonical ownership or fail validation with their source alias and text. Only units outside every explicit branch region may use ordinary shared sequencing.

### Deterministic Plot Projection

After Story extraction validation, always call `buildDeterministicStoryPlotPlan(document)` for imports. Ignore Branch Planner `plotGroups` on the import path. Plot nodes and edges therefore reflect only canonical Story `next` and choice relationships.

### Cache Invalidation

Bump the conversion cache version so previously mis-grouped Story/plot results are not reused.

## Data Flow

1. Segment exact source units and classify explicit markers.
2. Use a fully matching deterministic parser when available; otherwise request a Branch Planner candidate.
3. Canonicalize explicit ownership over the candidate.
4. Materialize and validate the Story graph fail-closed.
5. Build the plot plan deterministically from the validated Story Document.
6. Persist the Story table and plot projection under a new cache version.

## Validation

- Every visible source unit appears in exactly one canonical Story node unless explicitly replayed.
- Every visible outcome marker belongs to its coded route.
- Every Story node is reachable from the entry.
- Sibling routes cannot enter each other's targets or outcomes.
- A shared merge requires explicit common-boundary evidence or unanimous route continuation.
- Plot groups cover Story nodes exactly once and are derived without AI grouping.

## Testing

- Reproduce `子分支 B1 结局（接下银元，离开）` omitted from the AI route and verify it is assigned to B1 and reachable.
- Reproduce A1/A2 outcome markers omitted from both routes and verify they do not form `A1 -> A2 -> B` automatic edges.
- Verify selecting plot branch B cannot return branch A Story rows.
- Preserve natural-language Branch Planner coverage and strict sibling mismatch rejection.
- Verify the import route uses deterministic plot projection and the cache version changes.
- Run Branch Planner, conversion, deterministic plot, import wiring, type checks, targeted lint, and whitespace checks.

## Non-Goals

- Guessing branch ownership without explicit markers or a validated AI decision.
- Changing Flow Chart visual routing or layout.
- Increasing LLM retry counts.
- Weakening unreachable-node, cycle, source-coverage, or sibling-isolation validation.
