# Stable AI Story Branching

**Date:** 2026-08-04
**Status:** Approved for implementation

## Goal

Make arbitrary screenplay imports stable without weakening source coverage or branch-isolation validation. AI decides semantic branch deviations; the server owns visible content, default sequencing, graph completion, and plot projection.

## Architecture

The existing `Branch Planner` becomes the only AI structure stage for non-deterministic screenplay imports. It receives server-owned source units and returns only structural units, choices, non-sequential jumps, and terminal breaks. The server constructs every visible node from source segmentation and fills every ordinary sequential edge.

The pipeline must not fall back to the Extractor plus full Graph Planner after Branch Planner exhaustion. That fallback reassigns source evidence and asks AI to reproduce every edge, causing duplicate source-unit ownership and random unreachable nodes. A second Branch Planner attempt receives the previous candidate and validation issues and repairs only the invalid relationships.

Explicit screenplay formats keep their zero-LLM deterministic parsers. A valid Branch Planner response with no choices uses the deterministic linear plan.

## Graph Validation

Validation remains fail-closed for unknown targets, unreachable visible nodes, cycles, choice owners with automatic successors, and sibling branch leakage. Server materialization guarantees each source unit is owned once because AI never creates content nodes.

## Plot Projection

Imported scripts use `buildDeterministicStoryPlotPlan` exclusively. Plot boundaries include scene headings, decision owners, choice targets, and merge targets. Plot edges are derived only from canonical Story IR options and `next` links. The import path makes no Plot Planner call, so the flow chart cannot reinterpret a correct branch graph as a linear sequence.

## Performance

- Explicit formats: zero structure LLM calls.
- Arbitrary formats: one Branch Planner call when valid, at most one targeted repair call.
- No Extractor, full Graph Planner, or Plot Planner calls on the import path.
- Existing conversion caching remains enabled with a new version.

## Error Handling

After two invalid Branch Planner candidates, return the final concrete validation issue. Do not spend additional time on the known-fragile full graph fallback. Failed conversions are not cached.

## Testing

- Verify arbitrary branch prose uses only `submit_branch_structure`.
- Verify a retry includes the previous structure and uses a repair task.
- Verify Branch Planner exhaustion never invokes Extractor or Graph Planner.
- Verify deterministic plot grouping creates separate decision, sibling target, and merge nodes with canonical choice edges.
- Verify the import route disables AI plot planning.
- Run all Story extraction/plan/plot tests, route tests, type checks, targeted ESLint, and `git diff --check`.

