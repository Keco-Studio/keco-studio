# Deterministic Branch Route Repair

**Date:** 2026-08-05
**Status:** Approved for implementation

## Goal

Prevent valid nested screenplay imports from failing when the Branch Planner assigns an explicitly owned child-part unit to its parent route or leaves contiguous option-preview dialogue outside the correct route. Preserve strict sibling isolation and reject ambiguous ownership instead of guessing.

## Scope

The change is limited to `version: 2` grouped branch decisions with explicit `nextUnitId` fields. It operates before Story relationship materialization and does not weaken graph validation, increase LLM retries, or enable the legacy generic unreachable-node repair.

## Normalization

### Descendant Ownership

Build source-unit ownership from existing explicit branch-part markers. When an ancestor option contains a unit owned by one of its descendants, remove the unit from the ancestor route and insert it into the unique matching descendant option route in source order.

For example, option `A` may contain common setup owned by part `A`, but content owned by part `A1` belongs to option `A1`. The repair applies only when the owner code is a strict descendant of the claiming option code and exactly one option matches that owner code. Sibling mismatches such as option `A` claiming part `B` remain validation errors.

### Contiguous Option Previews

For each decision, derive the visible source range after an option marker and before its next sibling option marker or the first later explicit branch-body marker. These rows are direct option-preview evidence.

Remove preview units from any other option route in the same structure, then add them to the owning option route in source order. Choice units, decision owners, structural units, and non-visible units remain excluded. This rule handles the final option in a decision, including multi-line dialogue immediately before later `子分支 ... 结局` sections.

### Validation

Run the existing explicit branch-part ownership assertion after normalization. If a misplaced unit has no unique descendant destination, if it crosses sibling parts, or if source markers do not provide an unambiguous preview interval, retain the existing concrete error. The final unreachable-node, cycle, and sibling-leak validations remain unchanged.

## Data Flow

1. Parse the Branch Planner candidate and expand source aliases.
2. Normalize contiguous option previews using source order.
3. Normalize ancestor/descendant route overlap.
4. Repair uniquely owned descendant units.
5. Normalize incompatible continuation and merge targets.
6. Assert explicit ownership and materialize the graph.
7. Run the existing Story extraction validation.

The second Branch Planner attempt continues to receive the previous candidate and validation issue. Deterministic normalization applies equally to both attempts.

## Error Handling

Normalization must not invent a route when evidence is ambiguous. It should preserve the current error details, including compact source aliases, so a failed repair still identifies the exact unit and explicit part. No additional retry or silent content dropping is allowed.

## Testing

- Add a failing regression where option `A` claims a unit explicitly owned by `A1`, while the `A1` route omits it; verify the unit appears only on `A1`.
- Add a failing regression where the final nested option has consecutive preview dialogue that was claimed by another route; verify all preview lines appear only on the final option route.
- Preserve a rejection test for a true sibling mismatch such as option `A` claiming part `B`.
- Verify the materialized extraction has no unreachable nodes and no sibling branch leak.
- Run the complete Branch Planner and conversion test files, then targeted type checking and `git diff --check`.

## Non-Goals

- General graph completion for arbitrary unreachable nodes.
- More Branch Planner attempts or larger prompts.
- Heuristic reassignment without explicit markers or source-order evidence.
- Refactoring unrelated story extraction or plot projection code.
