# AI Semantic Lineage Story Graph Design

> **Notation:** Chinese screenplay markers appear as `\uXXXX` escapes so tracked files stay free of Chinese characters, as the CI `only-english-characters` check requires.

## Status

Approved direction: use AI semantic understanding for broad document compatibility, while compiling Script rows and graph edges deterministically. Left-side Script content and right-side plot nodes must share one canonical node-to-row mapping.

## Problem

The current Branch Planner asks the model to decide both semantic ownership and low-level graph transitions. Complex stories may share a later scene, present history-specific variants such as inner monologues, and then share a final suffix. If the model merges at the shared scene, the graph loses the earlier choice history and cannot select the correct later variant. If it keeps units on the wrong ancestor or sibling route, Script content leaks across branches.

There is also a separate presentation mapping defect. Persisted plot graphs currently infer Script row indexes from `plotPlan.nodes.flatMap(storyNodeIds)`. Plot-node order is not guaranteed to match `StoryDocument.nodes` order, so selecting a right-side node can display rows belonging to another plot node on the left.

## Goals

- Use AI semantics rather than format-specific regex rules to support varied prose and screenplay formats.
- Represent nested leaf histories such as `A -> A1`, `A -> A2`, `B -> B1`, and `B -> B2` explicitly.
- Support shared content followed by history-specific content without prematurely merging paths.
- Merge paths only at a suffix that no longer has history-specific variants.
- Compile graph transitions, replay copies, Script rows, and plot edges deterministically.
- Guarantee that every left-side Script row belongs to exactly one right-side plot node.
- Keep strict reachability, source coverage, sibling isolation, and traceability validation.

## Non-Goals

- Adding article-specific parsers for phrases such as `\u6765\u81ea A1` or `\u5185\u5fc3\u72ec\u767d`.
- Adding runtime variables or conditional jumps based on remembered choices.
- Allowing AI to generate the persisted PlotPlan independently from the Script graph.
- Weakening validation to accept unreachable or cross-branch content.

## Approaches Considered

### Prompt-only repair

Strengthening the existing route prompt is small, but the model still has to coordinate semantic ownership, replay, merge placement, and graph transitions in one response. A valid-looking early merge can still erase path history.

### Runtime history conditions

A shared node could branch later based on stored choice history. This avoids replay copies but requires changes to the Script table protocol, runtime, editor, preview engine, and flow chart semantics. It is outside the importer's current graph model.

### Semantic lineage plus deterministic compilation

The model labels which complete histories can play each source unit. The server derives safe replay and merge behavior. This retains AI's semantic flexibility while removing low-level edge construction from the model. This is the selected approach.

## Semantic Lineage Contract

The Branch Planner returns a versioned semantic structure with four parts:

```ts
type SemanticBranchStructure = {
  version: 3;
  structuralUnitIds: string[];
  decisions: Array<{
    id: string;
    ownerUnitId: string;
    options: Array<{
      id: string;
      sourceUnitId: string;
      text: string;
    }>;
  }>;
  histories: Array<{
    id: string;
    optionIds: string[];
  }>;
  unitClaims: Array<{
    sourceUnitId: string;
    historyIds: string[];
  }>;
};
```

Decision and option IDs are unique semantic references. They do not rely on `sourceUnitId` being unique because one source row may contain multiple selectable options.

Each history identifies one complete playable leaf path. Each visible source unit is assigned to every history on which it plays:

- Prelude content claims all histories.
- Parent-branch content claims all descendant histories of that parent option.
- A1-only content claims only the A1 history.
- A shared ceremony before later variants claims all histories.
- Each history-specific inner monologue claims only its matching history.
- A final shared caption claims all histories.

The model does not decide whether a multi-history unit is a shared node, a replay copy, or a merge. The deterministic compiler derives that from the surrounding history sequences.

## Deterministic Graph Compilation

### Validate the semantic model

Before graph construction, the server rejects:

- Unknown or duplicate decision, option, history, or source-unit references.
- A history that selects incompatible sibling options.
- A nested option without its required ancestor option.
- A visible source unit with no history claim.
- A structural unit that is also visible or claimed.
- Claims that contradict hard source evidence when explicit branch markers are available.

Explicit markers remain optional evidence. They improve validation but are not required for semantic planning.

### Build per-history playback sequences

For each history, the compiler builds the ordered sequence of visible source units and encountered decisions. Source order is used only after filtering by the AI-provided history claims, so discontiguous later continuations remain on the correct path and sibling sections are skipped.

### Build the graph

The compiler constructs playable paths from the per-history sequences:

- Identical prefixes before a decision remain shared.
- Common content after paths have diverged is replayed per history when a later unit differs by history.
- History-specific runs remain exclusive to their histories.
- Identical terminal suffixes merge once only after no later history-specific difference remains.
- Replay units receive unique internal Story node IDs but retain source references to the original authoritative unit.

For the weekly-report example, the award ceremony is replayed internally on A1, A2, B1, and B2. Each replay flows only to its matching inner monologue. The four paths merge at the final shared freeze-frame/caption suffix.

### Validate compiled paths

The server enumerates every compiled leaf path and compares it with the expected semantic history:

- Every claimed unit appears exactly once on that history unless replay is explicitly compiled.
- No unit appears on a history that did not claim it.
- Every choice reaches the option's expected history set.
- Every Story node is reachable.
- Sibling paths do not enter each other's exclusive nodes.
- All node, jump, command, and source references remain valid.

## Repair Attempt

Attempt one returns the complete semantic lineage structure. When validation reports concrete source units, attempt two uses a constrained semantic patch rather than a graph patch.

Supported patch operations are limited to:

- `set_unit_histories`
- `set_structural`
- `add_history`
- `remove_history`
- `set_history_options`

The patch prompt includes affected source text, neighboring units, current history claims, decision/option definitions, and allowed history IDs. The server applies the patch to a clone, recompiles the complete graph, and validates again. Unknown references, unrelated unit changes, duplicate operations, and conflicting operations are rejected.

## Script And Plot Mapping

`StoryDocument` remains the canonical playable graph. `compileStoryTable` emits one Script row per `StoryDocument.nodes` entry in the same order.

Persisted plot metadata moves to a version that records canonical Story row order:

```ts
type StoryPlotPlanV2 = {
  version: 2;
  entryPlotNodeId: string;
  storyNodeOrder: string[];
  nodes: Array<{
    id: string;
    title: string;
    storyNodeIds: string[];
  }>;
  edges: StoryPlotEdge[];
};
```

`storyNodeOrder` is exactly `document.nodes.map(node => node.label)`. The persisted graph maps each `storyNodeId` to its index in `storyNodeOrder`; it never derives row indexes from plot-node order.

Validation requires:

- `storyNodeOrder.length` equals the Script row count.
- Every Story node appears exactly once in `storyNodeOrder`.
- Every Story node belongs to exactly one plot node.
- Every plot node's `rowIndexes` are resolved through `storyNodeOrder`.
- Selecting a right-side node returns only the left-side rows listed by that node.

Version 1 plans remain readable through the current compatibility path. New imports always write version 2. An invalid version 2 mapping fails closed instead of falling back to positional guessing.

## Plot Construction

The plot tree continues to be derived from the validated `StoryDocument`, not from AI plot groups. Boundaries include decisions, option targets, scene headings, endings, replay-path variants, and final merges. Plot edges are projected from canonical `next` and option targets.

Replay plot titles may include a concise history suffix when needed to distinguish visually identical shared scenes on different paths. The suffix comes from semantic history IDs, not source-format parsing.

## Error Handling

- Malformed first output retains the existing full semantic retry behavior.
- Validation issues with source IDs trigger the constrained semantic patch.
- Failure after the second attempt reports the affected source alias and text.
- A graph or row mapping that cannot be proven consistent is not persisted.
- Conversion cache version and import variant are bumped when the new contract ships.

## Testing

- A shared award scene followed by A1/A2/B1/B2 inner monologues stays on four distinct histories and merges only at the final caption.
- Each inner monologue appears only on its matching enumerated path.
- Common pre-variant content is replayed and source-traceable.
- Nested parent content appears on all descendant histories without leaking into siblings.
- Natural-language branches without explicit A/B labels work from AI-provided semantic claims.
- Invalid and conflicting semantic patches fail closed.
- Every compiled Script row maps to exactly one persisted plot node.
- Selecting each right-side plot node returns precisely its `storyNodeIds` rows on the left.
- Plot node order differing from Script row order does not change the row mapping.
- Existing deterministic, Branch Planner, conversion, Script compiler, plot validator, persisted graph, and split-view suites remain green.

## Rollout

1. Add the semantic lineage schema and focused compiler tests alongside the current planner.
2. Compile version 3 semantic structures into the existing `StoryDocument` contract.
3. Switch Branch Planner attempt one and patch repair to semantic lineage.
4. Add PlotPlan version 2 canonical row order and update persisted graph loading.
5. Bump conversion cache keys.
6. Remove the old low-level route patch path after migration tests prove parity.
