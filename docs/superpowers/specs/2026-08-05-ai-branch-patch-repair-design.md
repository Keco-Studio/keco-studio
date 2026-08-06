# AI Branch Patch Repair

**Date:** 2026-08-05
**Status:** Approved for implementation

## Goal

Improve arbitrary screenplay compatibility without accumulating format-specific branch parsers. Keep the first Branch Planner semantic and make the second attempt a constrained patch over the validated first candidate.

## Decisions

- Revert broad exact-code route reassignment and default heuristic parser enablement introduced by the superseded explicit-canonicalization approach.
- Keep strict source coverage, reachability, cycle, and sibling-isolation validation.
- Keep deterministic plot projection from the validated Story Document.
- Keep the conversion cache bump so incorrect prior projections are not reused.
- Keep at most two Branch Planner calls.

## Initial Planning

The first call returns the existing grouped branch structure. The prompt remains format-agnostic and emphasizes semantic decisions, exclusive routes, shared continuations, and visible endings.

The server materializes and validates the candidate. It retains the parsed candidate even when materialization fails.

## Structured Repair Context

For each validation issue, the second request includes:

- issue code and message;
- affected source unit aliases and exact text;
- the previous and next visible source units;
- every option currently claiming each affected unit;
- nearby option routes and their terminal/continuation values;
- whether the unit is visible, an ending, a choice, structural, or currently unassigned.

This context is derived from source units and the previous candidate, not from screenplay naming conventions.

## Patch Contract

The second call uses a dedicated repair tool and returns only operations:

- `add_route_unit`: add one source unit to one identified option route at a source-order position;
- `remove_route_unit`: remove one unit from an incorrect option route;
- `set_next`: change one option continuation;
- `set_merge`: change one decision merge;
- `add_break` and `remove_break`: adjust terminal markers;
- `set_structural`: classify or unclassify a source unit as structural.

Options and decisions are identified by their source unit IDs, not array indexes. The server rejects unknown IDs, ambiguous option references, duplicate/conflicting operations, and patches unrelated to reported issue units or their immediate transitions.

The server applies valid operations to a clone of the first candidate, preserves all untouched relationships, materializes again, and runs the same strict validation. There is no third call and no fallback full-graph rewrite.

## Prompt Changes

Shorten the initial prompt by removing format-specific examples that duplicate server validation. Add an explicit final checklist for visible coverage, ending ownership, sibling isolation, and shared merges.

The repair prompt states that it must not return a new graph. It must fix only supplied issues using the allowed patch operations and must prefer assigning an isolated visible unit to the semantically matching nearby route over changing unrelated decisions.

## Plot Projection

Imported plots continue to use `buildDeterministicStoryPlotPlan(document)`. AI `plotGroups` are ignored so Story rows and Flow Chart branches cannot disagree.

## Error Handling

If the patch is invalid or the repaired candidate still fails validation, return the final concrete issue with source alias and text. Never silently attach an ambiguous node to a sibling route.

## Testing

- First candidate leaves the apology dialogue unassigned; repair context identifies its surrounding B2 route and the patch adds it without changing B1.
- First candidate leaves a code-less ending marker unassigned; repair context includes its adjacent route tail and the patch attaches it to that route.
- Patch operations cannot modify unrelated units or reference unknown decisions/options.
- Existing sibling mismatch, nested successor, shared replay, and merge tests remain green.
- Conversion performs one full plan call plus at most one patch call and never a second full rewrite.
- Imported plots remain deterministic and cache invalidation remains active.

## Non-Goals

- Recognizing every screenplay heading syntax with regex.
- Automatically repairing ambiguous ownership without AI evidence.
- Increasing retries or weakening validation.
- Changing Flow Chart layout.
