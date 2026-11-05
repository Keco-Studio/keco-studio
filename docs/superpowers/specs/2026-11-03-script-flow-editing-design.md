# Bidirectional Editing Design for Script and Flowchart

## User Decision and Current State

On 2026-11-03 the user explicitly chose the second step of the original requirement and selected "directly edit the flowchart and sync the Script." This phase delivers branch-structure editing and bidirectional synchronization for the existing Script. The first step, save/reuse, is not yet complete; its uncommitted changes are retained and are not listed as delivered or as a prerequisite for this phase. Shot scripts and scene animation belong to later phases.

The existing `buildScriptFlowGraph` generates a display graph from lines; it groups by chapter, merges title nodes, hides self-loops, and scans a fixed 10 options. `FlowChartPanel` only supports selecting nodes and cannot write back. `plot_plan` may take precedence over current line data, so the display graph cannot be used directly as reverse-compilation input. The current player supports dynamic options and has priority for End, options, Jump, and sequential execution. A Script derived from a source document also involves document synchronization and regeneration.

## Approach

The user has chosen: directly edit the flowchart and sync the Script. The alternative approach, "only do import/export conversion, use the flowchart for browsing," does not satisfy the selected interaction.

Implementation choices are left to the developer: continue using Next.js/React, the existing graph rendering, and Supabase; use complete line data plus stable line IDs as the authoritative content, with edit commands modifying only the specified exit. The display graph is only a projection; do not create another copy of the story text that can drift independently, and do not let an LLM infer graph-edit intent. Format conversion guarantees that semantics and all field values are preserved; it does not promise byte-identical formatting whitespace.

## User-Visible Operations

- Keep the existing layout and mutual positioning of Script on the left and flowchart on the right. Add a graph edit mode and an exit-editing panel for the selected node.
- Each exit displays the source dialogue/line, exit type, option text, target node, and target line; multiple branches within the same scene are listed separately, and the user's intended line to modify must not be guessed.
- An exit can be rewired to another node (defaulting to its entry line, with explicit selection of an internal line within the node allowed); options can be edited, added, and deleted; a normal exit can be set to jump, continue sequentially, or end. Deleting an option requires an explicit action; "end" must not be interpreted as a delete-option button.
- This phase uses controls that select the source exit and target to complete connection operations, and is keyboard-accessible; drag-line gestures, free-canvas layout persistence, adding/deleting entire story nodes, and a raw-text IDE are not acceptance criteria for this phase. Adding and deleting body text continues to use the existing Script editor.
- Changes are first kept in a draft, showing affected fields and diagnostics; clicking Save commits atomically, and Cancel discards; before committing, wait for the current dialogue draft to be saved. If saving fails, the draft is retained; version conflicts do not automatically overwrite others' changes.
- Viewers can only browse. Old local structure templates and reference graphs from the generation process remain read-only.

## Conversion Contract

The complete model contains field definitions, ordered line IDs/all values, optional scene grouping, and exits with source line IDs and option indices. Scene titles and layout must not determine execution order. When grouping is missing, generate it deterministically; jumping to an internal line within a scene must locate the real target line.

Scan the actual OptionN/OptionN_Next/OptionN_Commands fields, with no fixed limit of 3 or 10 options (retain the existing total-size/line-count safety limits). Parse independent control commands in Label and Commands and option targets. If, numeric commands, unknown non-control commands, resources, and custom columns are preserved as-is; do not expand conditional-execution capabilities that the player does not yet support. Nodes with conditions explicitly display the condition and must not imply that the condition has been evaluated by playtesting.

Unify the control-flow interpretation of the graph and the player: End first, then options, then Jump, and finally sequential lines. When multiple control intents coexist, labels are duplicated, targets are invalid, or control commands cannot be safely understood, display precise line/field diagnostics and block the relevant writes; do not silently repair. Preserve the original values of invalid input for correction. Display unreachable lines and cycles, do not discard self-loops; automatic looping follows the player's existing protection.

Graph editing modifies only the specified Label, Jump/End, or OptionN fields. When the target has no label, generate a unique label. Modifying control commands must preserve numeric commands and other tokens, and must not replace same-named strings in the body text. Sequential exits correspond to the real physical order and must not be compiled from canvas position. When an option is set to end, use a standalone termination line in the standard format, preserving the button and option commands; the new termination line is created in the same transaction as this save.

After a successful Script edit, rebuild the graph from the latest lines. plot_plan only provides validated grouping/titles and does not override real control edges; when the old plan is inconsistent, display diagnostics and derive edges from the Script. Structural edits also update the affected plan to prevent a refresh from restoring old edges.

## Persistence and Source Document

Add a project/library-scoped structural editing API. The client submits edit commands, the expected content fingerprint, the document token (when applicable), and a requestId. The server obtains the actor from the session, re-reads the complete data, validates project role, library ownership, and operation, and generates the change; it does not accept arbitrary client SQL or authoritative whole-library replacement.

The transaction covers field/line values, necessary termination lines, plot_plan, structural metadata, and idempotent results. The fingerprint covers fields, line order, values, plan, and structural metadata. Replaying the same request returns the original result; the same key with a different request returns 409. Any step failing rolls back everything; do not rely on client-side compensation across multiple requests.

For libraries with a source_document_id, do not modify only the derived lines and then have them overwritten by regeneration. Add versioned, server-controlled structural override metadata bound to the source document, library, and stable source-block identity, recording the original control fields, the edited control fields, the target identity, and the source-block digest it depends on. It is a structural supplement to the source document and does not rewrite the complete source document into natural language. On save, validate the document version and update tail, and write atomically with the structural override metadata. This override belongs only to the edited Script and does not change the body text or structure of other derived tables from the same source.

Before regenerating that library, deterministically apply structural overrides that still match, preserving the corresponding line mapping for existing resource/custom values; unedited content continues along the original conversion path. If a source block is deleted, rewritten, or mapping is ambiguous such that the override cannot be applied, a conflict must be returned before replacing the existing library, and the existing library must be preserved. Do not silently discard overrides, and do not treat the target Label as a permanent line identity. For historical libraries without verifiable source-block mapping, block structural saves in the preview and explain that the mapping needs to be re-established; do not guess body-text positions.

### Implementation Decisions Clarified After Review

- When a historical library first opens structural editing, perform a read-only mapping pre-check: prefer reusing existing lineage and BlockAnchor; when missing, use the existing dialogue-block/source-block matching mechanism to perform unique matching on normalized speaker, action, body text, and complete block boundaries. Only unique, complete matches may establish the mapping atomically with the first save. When body text is duplicated or line ownership is ambiguous, return the specific conflicting items; do not automatically fuzzy-match, and do not substitute "disable all old libraries" for implementing migration. Libraries without a source document are edited directly using persistent line IDs.
- "Preserved after regeneration" specifically means replacing the same edited library. If the existing entry point actually creates a new library, explicitly distinguish "update current Script" from "create new Script": the update operation uses the current library's structural overrides and validates before replacement; new creation uses the source document structure by default and does not inherit another library's overrides. Do not pass off successful new-library creation as acceptance for regenerating the current library.
- When dialogue is modified normally through the existing dialogue editor, the document/derived-line synchronization transaction also updates the corresponding structural metadata digest, preserving determinable source-block identity, exits, and targets; do not permanently block regeneration just because one line of dialogue was changed. When direct source-document editing causes the digest to change, the regeneration pre-check validates by stable block identity and unique line mapping; determinable body-text changes update the digest, while ambiguity such as deleted targets or changed block structure returns a conflict, and silently using old labels is prohibited. The above paths need to be tested separately.

## Acceptance

1. Standard Script → edit graph → standard Script → re-read graph: body text, If, commands, resources, and custom fields are preserved; unedited content is unchanged.
2. Modifying option targets, text, adding/deleting options, setting end, and sequential continuation remain correct after refresh, and playtesting follows the actual new paths.
3. More than 10 options, multiple branches in the same scene, merges, self-loops, and jumps to internal lines across scenes all have clear representations.
4. Invalid targets, duplicate labels, and control ambiguity have located diagnostics and do not produce errors or partial saves.
5. Viewers/non-members cannot write; collaboration conflicts, duplicate submissions, and mid-transaction failures are all covered by real database tests.
6. Libraries bound to a source document retain edits after regeneration; when source-block changes cause ambiguity, abort replacement and preserve old content.
7. Existing Script/flowchart/player tests, type checking, and lint pass; verify save, cancel, errors, refresh, and keyboard operation in a local browser. Content that has not been verified must not be marked complete.

## Implementation Boundaries

This design has been confirmed by the user and has entered implementation. New code is placed independently under `script-system/flow-editing` and the corresponding service/API/UI, minimizing expansion of ScriptSplitView. Incomplete changes from the first step in the workspace are not reverted and are not conflated with this delivery. During implementation, do not expand scope to conditional playback, animation, or template management.

Design check: the independent builder check has been completed, and the three issues raised—historical mapping, regeneration entry point, and digest maintenance after body-text editing—have been decided by the developer above. The existing FlowChartPanel, ScriptSplitView, scriptPlayer, and buildPersistedPlotGraph baselines pass 4 suites/48 tests.
