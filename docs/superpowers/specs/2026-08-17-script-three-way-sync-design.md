# Script Document, Table, And Conversion Synchronization

Date: 2026-08-17
Status: Approved design

## Summary

Keep the Script source document, derived table, and conversion result (`libraries.plot_plan` and the right-side Flow chart) synchronized through incremental updates. Normal Script edits and reorders use one synchronization command. Document collaboration saves reconcile anchored source blocks at the existing debounced compaction boundary. Neither path invokes the AI conversion pipeline.

## Goals

- Prevent the Flow chart from abruptly switching between a stale persisted plan and a newly rebuilt graph.
- Persist Script table edits, source-document block edits, row order, and conversion metadata together whenever one mutation originates in the Script editor.
- Propagate safe document edits to the derived Script table and conversion result.
- Preserve stable plot-node IDs and edge choices whenever the affected data still identifies the same node.
- Keep ordinary edits responsive by using local incremental transforms, React Query cache updates, and one database write per mutation.
- Leave ambiguous free-text mappings unchanged rather than guessing and corrupting another row.

## Non-Goals

- Re-running Story IR or any LLM conversion for ordinary edits.
- Reconstructing arbitrary document prose that has no stable BlockAnchor or unique Script mapping.
- Moving unrelated headings, narration, or notes during a dialogue reorder.
- Changing the visual style or layout controls of the Flow chart.

## Current Gaps

The Script page currently prefers `library.plot_plan` whenever it validates against the current row count. Content edits therefore remain hidden by the old plan, while a row-count change causes a sudden fallback to `buildScriptFlowGraph`. Reorder currently changes only `library_assets.row_index`; it does not issue a source-document reorder or update `plot_plan`. Document collaboration compaction persists Markdown/Yjs independently of derived Script data.

## Architecture

### Canonical incremental state

Introduce a pure synchronization reducer that accepts the authoritative current table rows, anchored document Markdown, mappings, and the persisted plot plan. It returns a validated next table projection, next document Markdown, mapping changes, and a patched plot plan. The reducer preserves existing plot-node IDs and edge definitions when possible, updates `storyNodeOrder` for row moves, and derives labels/titles from changed rows without rebuilding unrelated nodes.

### Script-originated mutations

Edits, inserts, deletes, speaker changes, and drag reorders in `useScriptDialogueEditor` are serialized through the existing command queue. A command prepares the document block transform and the table mutation before calling one server synchronization boundary. The transaction updates:

1. affected `library_assets` and `library_asset_values` rows;
2. source-document Markdown/Yjs state and collaboration token;
3. block mappings;
4. `libraries.plot_plan` and ancestor timestamps.

The response contains updated rows, the new document token, mappings, and the patched plot plan. The client applies these to query caches immediately and schedules reconciliation in the background.

### Document-originated mutations

The collaboration session keeps its current two-second debounce. At compaction, only documents linked to Script-derived libraries run the incremental reconciliation. The server compares the previous anchored Markdown with the new Markdown, resolves safe edit/insert/delete/reorder commands, and applies derived table plus plot-plan changes in one follow-up transaction guarded by the document token. A document edit that cannot be mapped uniquely is retained in the document and reported as a non-blocking synchronization warning; it does not rewrite an unrelated table row.

### Flow chart projection

`ScriptSplitView` consumes a stable effective graph derived from the latest rows and patched plot plan. It never chooses a graph solely because row count changed. When a plan is missing or invalid, the fallback graph is used once and its result is treated as the new projection; subsequent edits patch the same graph identity. Selection is retained by plot-node ID, then by its stable row anchor.

## Reorder Semantics

Dragging a dialogue card moves its mapped action and speech blocks as an ordered group. The target boundary is the first or last mapped block of the target card. Unmapped document blocks stay in place. Table order, `storyNodeOrder`, and document block order must agree before the command is accepted. The operation is rejected on stale document tokens, changed mapped text, missing mappings, or a stale expected row order.

## Conflict And Error Handling

- Document epoch, revision, and update-tail changes return a conflict and leave table and conversion unchanged.
- A missing or ambiguous block mapping returns a stable mapping error; no table or plot-plan mutation is attempted.
- Permission failures remain non-mutating and refresh workspace membership.
- Any transaction failure rolls back all table, document, mapping, and plot-plan writes.
- Cache updates happen only after the synchronization boundary succeeds; background invalidation is best effort.

## Performance

- No AI call is made for edits, deletes, speaker changes, or reorders.
- The normal path performs one local reducer pass and one database transaction.
- Document-originated reconciliation is debounced with existing compaction and limited to affected derived libraries.
- Large tables use maps keyed by row/block ID; no repeated full-table scans inside per-row loops.

## Testing

Unit tests cover stable graph projection across content and row-count changes, plot-plan patching, document/table reorder with intervening narration, ambiguous mapping rejection, and cache updates. Server tests cover atomic table/document/plot-plan writes, stale-token rejection, and rollback. Collaboration tests cover debounced document reconciliation and no-op behavior for unlinked documents. An end-to-end test edits a source document, edits the Script table, drags a dialogue, reloads all three views, and verifies identical order/content without invoking conversion.

## Acceptance Criteria

- Editing a Script row updates its source block and Flow chart without a visible graph reset.
- Editing a mapped source block updates the corresponding table row and Flow chart after the normal document save debounce.
- Dragging a dialogue changes table order, document block order, and Flow chart order together.
- `libraries.plot_plan` remains current after edits and reloads.
- Unrelated document blocks never move with a dragged dialogue.
- Ambiguous mappings do not silently modify another row.
- Normal edits do not invoke the AI conversion pipeline and remain responsive.
