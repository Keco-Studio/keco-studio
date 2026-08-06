# Agent Story Graph Edit Tooling Design

Date: 2026-08-05
Status: Approved

## Summary

Add Agent tooling that can inspect and safely modify the real story structure of an existing document-derived Script library. The write tool uses structured patch operations, produces a graph diff for confirmation, and atomically updates both executable script rows and the persisted `plot_plan`.

The feature does not edit an arbitrary visual layout. Script row control fields remain authoritative for executable edges. `plot_plan` supplies stable story-node identity, plot grouping, titles, and a derived view of the same edges.

## Goals

- Let the Agent read a compact story graph with stable node labels.
- Let the Agent create story nodes and change choices, jumps, merges, and endings.
- Show an accurate structural preview before applying edits.
- Keep script rows and `libraries.plot_plan` consistent in one transaction.
- Detect concurrent edits between preview and confirmation.
- Preserve all content when a branch is disconnected unless deletion is explicitly introduced in a later feature.
- Reuse the existing Script flow chart renderer.

## Non-Goals

- Direct manipulation of node positions or other presentation-only layout.
- Arbitrary replacement of the complete graph.
- Editing the source Studio Document and rerunning full conversion.
- Node deletion or arbitrary row reordering in the first release.
- Editing Script libraries without a valid persisted `plot_plan`.
- Supporting newly introduced cycles.

## Supported Libraries

The first release accepts only a library that:

- belongs to the current project;
- has `document_export_type = 'script'`;
- has a valid `plot_plan`; and
- has a `plot_plan.storyNodeOrder` whose length matches the ordered script row count.

Invalid or legacy libraries return a read-only diagnostic and are not modified. They must be regenerated or repaired through a separate workflow.

## Chosen Approach

Use a structured graph patch rather than complete-graph replacement or source-document regeneration.

A patch is compact, auditable, and deterministic. The server applies it to the latest canonical snapshot, validates the result, previews the exact structural difference, and applies the same normalized patch again during confirmation.

Rejected alternatives:

1. Complete graph replacement makes omission equivalent to deletion and produces large, fragile Agent arguments.
2. Editing the source Document and rerunning conversion can change unrelated wording, labels, grouping, and row identity.

## Data Authority

The graph snapshot combines two existing representations:

- Script rows own executable content and control flow: `Type`, `Name`, `Content`, `Commands`, `OptionN`, `OptionN_Next`, and optional `OptionN_Commands`.
- `plot_plan` owns stable story-node order, plot-node membership, and plot titles.

The write path never accepts independent edge edits to `plot_plan`. It derives plot edges from the patched executable graph. This prevents a flow chart from claiming a route that the script rows do not execute.

Ordinary sequential rows may have an empty visible `Label` cell. Their stable labels come from `plot_plan.storyNodeOrder`, aligned with rows by canonical `row_index` order.

## Architecture

### Agent Tools

Add two tools:

- `read_story_graph`: read-only compact graph inspection.
- `propose_story_graph_edit`: post-preview structured graph mutation.

Both resolve a library by `libraryId` first, exact `libraryName` second, and the active Script library last. Exact-title node lookup is a fallback only. An ambiguous title returns candidates and performs no write.

### Story Graph Modules

Add focused modules under `src/lib/story-graph/`:

- `editableGraph.ts`: normalized editable graph types and row/graph conversion.
- `snapshotReader.ts`: project-scoped library, fields, ordered rows, and plot-plan loading.
- `patchSchema.ts`: Zod and JSON Schema definitions for operations.
- `patchEngine.ts`: pure ordered patch application.
- `validator.ts`: final graph validation, path analysis, and warnings.
- `plotPlanUpdater.ts`: plot membership preservation, affected-group splitting, and edge derivation.
- `preview.ts`: stable before/after diff construction.

The patch engine and validator do not access the database.

### Atomic Writer

Add a security-invoker Supabase RPC, `apply_story_graph_patch`, through a migration. The RPC:

1. verifies project membership and editor-or-admin permission;
2. locks the target library and relevant field/asset rows;
3. compares the expected snapshot with current library, field, asset, and plot-plan state;
4. inserts or updates fields, assets, and cell values;
5. updates row ordering and `plot_plan`;
6. returns the new snapshot identity; and
7. rolls back the entire operation on any failure.

The expected snapshot includes the target library state, ordered field identities and update tokens, ordered asset identities and update tokens, and the canonical `plot_plan` value. A mismatch returns `STORY_GRAPH_CONFLICT`.

## Read Tool Contract

`read_story_graph` returns a compact structure suitable for a later patch:

```json
{
  "libraryId": "uuid",
  "entryLabel": "Intro",
  "nodes": [
    {
      "label": "MainChoice",
      "title": "Choose a route",
      "rowIndex": 4,
      "outgoing": [
        {
          "kind": "choice",
          "optionIndex": 0,
          "text": "Go to the attic",
          "target": "Attic"
        }
      ]
    }
  ],
  "warnings": []
}
```

The tool description instructs the model to call this tool before proposing an edit and to use returned stable labels.

## Write Tool Contract

`propose_story_graph_edit` accepts a library selector and one or more operations. Operations apply in array order but commit as one unit.

### `create_node`

Creates a new story row and a new standalone plot node.

Required node properties:

- `label`
- `nodeType`: `dialogue`, `narration`, `scene`, or `system`
- `content`

Optional properties:

- `speaker`
- `plotTitle`
- `nextLabel`

`insertAfterLabel` is an optional operation-level property, separate from the nested `node` object. Without it, the row is appended. Without `nextLabel`, the new node is terminal. The server compiles the required `Jump` or `End` representation based on final physical order.

### `add_choice`

Adds a choice to `fromLabel` with `text`, `targetLabel`, and optional commands. It uses the first free option slot and reports the assigned `optionIndex` in the preview.

If the source currently has an ordinary successor, the patch must first include `set_end` for that source. `add_choice` does not silently discard an existing route. A node with one or more choices cannot also have an ordinary successor in the final graph.

### `redirect_choice`

Changes an existing choice target. It identifies the edge by `fromLabel` and `optionIndex`. The normalized operation also seals the expected old text and target so confirmation cannot silently redirect a different choice.

### `remove_choice`

Removes one choice edge by `fromLabel` and `optionIndex`. It does not delete the target or any downstream node. Newly unreachable nodes are warnings.

### `set_next`

Sets a node's ordinary successor. Targeting an existing node supports jumps and merge creation. The compiler emits fallthrough or `Jump` according to physical row order.

### `set_end`

Clears the ordinary successor and emits terminal behavior. It is rejected while the node still has choices.

## Plot Plan Update Rules

- Preserve unaffected plot-node titles and memberships.
- Give a created story node its own plot node, using `plotTitle` when provided and a deterministic compact title otherwise.
- Split a newly exposed choice target out of an existing multi-row plot group when required to keep the choice visible.
- Split an affected decision boundary when keeping it grouped would hide an edge.
- Remove empty plot groups created by a split.
- Derive all final plot edges from the patched executable graph.
- Keep every stable story label exactly once in `storyNodeOrder` and one plot membership.

## Validation

Before returning a preview and again before commit, validate:

- stable labels match the existing label pattern and are unique;
- the entry node exists;
- all ordinary and choice targets exist;
- all plot memberships refer to known story nodes;
- every story node appears exactly once in canonical order and plot membership;
- each node has at most 10 choices, matching current flow-chart parsing capacity;
- a node with choices has no ordinary successor;
- the patch does not introduce a cycle;
- `set_end` is not applied to a node with choices;
- generated script fields and row values are compatible with the Script schema; and
- final rows can be converted back to the same normalized graph.

Unreachable nodes do not fail validation. They appear as warnings and remain stored.

## Preview And Confirmation

The write tool uses:

```text
category: write
confirmationMode: post_preview
confirmationPolicy: mode
requiredPermission: editor
```

Editors and admins can write; viewers can only read. Conversation auto-execute mode may apply a valid preview without a manual click.

The preview shows:

- created nodes and short content summaries;
- added, removed, and redirected choices;
- changed ordinary successors and endings;
- new option fields;
- affected row numbers;
- unreachable-node warnings; and
- before/after counts for nodes, edges, endings, unreachable nodes, and entry-to-ending paths.

The public preview is display data only. Internal preview state contains the normalized patch and snapshot identity. Confirmation reloads and locks current state, verifies the snapshot, reapplies the patch, and revalidates it. It never trusts a client-provided final graph or database payload.

## UI Integration

Extend the existing Agent confirmation UI with a `story_graph_edit` preview renderer. It presents compact node and edge changes without embedding another flow-chart editor.

After success, return a Library invalidation for the edited library. Existing Script data queries reload the rows and `plot_plan`, and `FlowChartPanel` renders the updated graph. Realtime events may refresh other open clients, but cache invalidation is required for the initiating client.

## Errors

Use stable error codes where the UI or Agent should react differently:

- `STORY_GRAPH_UNSUPPORTED_LIBRARY`
- `STORY_GRAPH_INVALID_SNAPSHOT`
- `STORY_GRAPH_AMBIGUOUS_NODE`
- `STORY_GRAPH_INVALID_PATCH`
- `STORY_GRAPH_CONFLICT`
- `STORY_GRAPH_PERMISSION_DENIED`

Validation errors include operation index, affected label, and a concise corrective message. No failure path may leave a partial row, field, or plot-plan update.

## Testing

### Unit Tests

- Every patch operation in isolation.
- Ordered multi-operation application.
- Batch rollback behavior at the service boundary.
- Stable-label and exact-title resolution, including ambiguous titles.
- New-node insertion and option-field expansion.
- Choice redirection and removal without node deletion.
- Merge creation through a shared target.
- Unreachable-node warnings.
- Cycle rejection, invalid target rejection, duplicate-label rejection, and 10-choice enforcement.
- Affected plot-group splitting and preservation of unaffected titles and memberships.
- Row-to-graph round-trip equivalence.
- Preview diff counts and summaries.

### Tool Tests

- Read tool project scoping and viewer access.
- Write preview performs no mutation.
- Editor/admin access and viewer rejection.
- Confirmation uses the sealed normalized patch.
- Concurrent modification returns `STORY_GRAPH_CONFLICT`.
- Non-Script and invalid-plot-plan libraries are rejected.
- Success returns the expected Library invalidation.

### Database And Integration Tests

- RPC applies fields, rows, values, order, and `plot_plan` atomically.
- A forced mid-operation error rolls back every change.
- Snapshot mismatch rejects without writes.
- RLS prevents cross-project and viewer writes.

### UI And End-To-End Tests

- Confirmation card renders node, edge, count, and warning changes.
- Agent reads a graph, creates a node, adds a choice, previews, confirms, and sees the refreshed flow chart.
- Existing document conversion and manually generated Script flow charts do not regress.

## Acceptance Criteria

1. A user can ask the Agent in natural language to add or adjust a branch in an existing generated Script.
2. The Agent reads the graph and targets stable labels before writing.
3. The confirmation card accurately describes structural changes and unreachable-node warnings.
4. The confirmed write updates executable rows and `plot_plan` together.
5. The refreshed script table and flow chart express the same graph.
6. Permission, validation, concurrency, or database failures produce no partial writes.
7. Existing manual conversion and flow-chart behavior remain unchanged.
