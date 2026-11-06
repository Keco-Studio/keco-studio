# KECO-1173 Phase 1: Script Saving, Template Reuse, and Partial Copy

Date: 2026-11-03. Status: Design pending confirmation, not yet implemented.

## Goals and Boundaries

The user has chosen in-project cloud templates, as well as partial copy-paste within the same project. This phase enables complete Scripts and selected fragments to be persistently saved, generate independent copies, and be inserted into existing Scripts. Full bidirectional text and flowchart editing, shot templates, and scene animation belong to subsequent phases.

Ordinary selected text still performs text copy. The structured Script selection in this phase is based on complete dialogue blocks as units; a dialogue block composed of action and dialogue cannot be split into half a block. The user can select multiple blocks. The flowchart supports multi-selecting nodes and copying all associated data rows, deduplicating when rows overlap.

## Existing Code and Limitations

- `scriptStructureTemplates.ts` currently only saves FlowGraph and statistics in localStorage; graph nodes only reference row indexes and cannot independently restore dialogue.
- `ScriptSplitView.tsx` links dialogue and flowchart; `FlowChartPanel.tsx` currently only supports single-node selection.
- `VisualNovelScriptView.tsx` has a plot-node edit mode and a player playback mode.
- Script content is already saved in library data rows and may be associated with the source document, dialogue sources, and plot plan via source_document_id.
- `scriptImportService.ts` and `scriptDialogueRpc.ts` already have import and modification mechanisms, but it cannot be assumed that calling them one by one guarantees atomicity of batch paste.
- The old ScriptLine has a fixed three options; other pipelines already have dynamic options; snapshots must not be downgraded to the old three-option format.

## Solution Selection

1. Selected: Supabase in-project cloud templates. Accessible across devices, follows project collaboration permissions, requires database migration and atomic write interfaces.
2. Not selected: extending browser-local templates. Lower cost, but cannot satisfy cross-device persistent saving and reuse by project members.

Keep the old local structure templates as read-only references, clearly marked "structure reference only"; they lack dialogue, are not automatically migrated to complete templates, and do not offer operations that pretend to be fully reusable.

## User Flows

### Saving and Template Management

Continue to use the current Script save/autosave mechanism. Before saving a template, first commit the current editing draft and wait for completion; abort on failure. Read a server-consistent snapshot before saving; do not treat a stale client graph as authoritative content.

The toolbar provides "Save as Template", supporting the entire Script or the currently selected portion. Fill in a required name and optional description. The template library lists name, creator, update time, and scene/dialogue/option statistics, and supports preview, rename, and delete.

A template is a content snapshot at creation time; subsequent changes to the original Script do not modify the template. In this version, re-saving creates a new template; content overwrite and version history are not provided; names may be duplicated, and stable IDs distinguish entries.

### Reuse

"Create New Script": creates an independent Script within the current project that is accessible in the Script sidebar, and opens it. The contents of the template and source Script are not modified.

"Insert into Current Script": select a node/dialogue block as the insertion position, preview the insertion amount and boundary connections, and commit after confirmation. What is selected is the current position; existing branches are not automatically rewired to the new fragment. An empty Script can be inserted into directly; a non-empty Script must explicitly select an insertion point.

When inserting between dialogue blocks, only the sequential path at that location is rewired. If the selected node's exit is an option branch or an explicit jump, the preview must select the specific exit to rewire, or choose "add as unconnected fragment"; it must not redirect all exits of that node. Unconnected fragments must show an unreachable warning, and the user can explicitly connect them later.

### Partial Copy

The flowchart toggles multi-selection via Ctrl/Cmd+click; Shift+click may be left to the implementer to choose a reasonable extension; the first version does not mandate box selection. The Script editor provides an explicit "Select Fragment" mode and block-level multi-selection, avoiding conflicts with text selection and editing shortcuts.

After selection, provide "Copy Fragment" and "Save Selected Portion as Template". The copy is temporarily stored in a project-scoped clipboard for the current tab and can be pasted between different Scripts in the same project; page refresh clears it, and long-term saving should use templates. The first version does not promise cross-tab or OS structured clipboard interoperability.

Non-contiguous selections are preserved in source Script row order; new sequential connections must not be produced by array concatenation. Selection actions do not modify content; multi-selection state and the currently viewed node state are saved separately.

## Snapshot and Copy Semantics

Adopt a verifiable snapshot with version=1, saving field semantic descriptions, complete row values, stable fragment-internal row IDs, dialogue block mappings, node groupings and explicit connections, entry/exit points, variable references, resource references, and source notes. Field mapping uses semantic keys and types, and does not carry field UUIDs that the target library must reuse. Preserve current actual columns and dynamic options; unknown/incompatible columns report errors in the preview and are not silently discarded.

Node grouping also saves verifiable row ID associations; rowIndexes are only UI-derived values. The copied Script data is the content source; FlowGraph is a projection, and a second independent editable body is not maintained.

On insert and create, assign new asset, block, node identifiers and Labels, and rewrite all recognized jumps within the selected content. Repeated pastes do not overwrite each other. Do not perform only global string replacement; text with the same name in the body is not rewritten.

Boundary handling:

- Internal explicit jumps and sequential connections are preserved and remapped.
- Connections pointing outside the selection (including implicit sequential exits) are listed as pending exits. Inbound edges are not copied and are only described in the preview.
- Each exit must specify an existing target in the paste preview or choose "end here". When an option chooses "end here", the option text is preserved and an independent end target is generated; an empty target must not be produced followed by unexpected sequential execution.
- By default there are no new connections between non-contiguous selections. The preview must explicitly complete boundary selection before writing is allowed.
- Disconnected multi-entry fragments are allowed to be stored as templates, showing entries and unconnected warnings; creating a new Script requires selecting an entry, and inserting requires explicit connections from the insertion point to the entry and from the exit. Unreachable nodes must not silently become sequential execution.
- Variable names are preserved by default; same-named variables may affect the target plot; the preview lists references and assignments and explicitly explains the semantics of shared names. This version does not provide automatic variable renaming.
- Resources retain same-project references; binary files are not copied. Copy content is independent but references the same resources; if a resource does not exist or is inaccessible, block application and list the problems.

## Persistence, Permissions, and Concurrency

Add a project-scoped template table (suggested `script_templates`): id, project_id, name, description, schema_version, snapshot, created_by, created_at, updated_at. Specific constraints, indexes, payload limits, and API paths are left to the implementation plan to determine, with consistent limits on frontend and backend.

Implement according to the actual role semantics of the current project authorization service: members with read permission can view templates; members with edit permission can create, rename, delete, and apply templates; read-only members cannot write. Validate both via API and RLS; cross-project application/resource references are prohibited. Do not reuse the overly broad authenticated policies from historical migrations.

Template saving reads consistent content from the server; the client passes source ID, selection ID, and version token, and the client-provided project ownership is not trusted. Validate source permissions when saving templates and copying temporary fragments, and re-check source access rights when applying temporary fragments. When applying a persistent template, validate the template's project ownership and read permission, target edit permission, template/target versions, and all resource references, without depending on whether the original Script exists or is still accessible; source notes are only for traceability.

Paste uses a single atomic operation to write new rows, field values, order, jumps, plot plan, and source information; roll back everything on failure. Use idempotent request IDs so network retries do not insert duplicates. When the target changes concurrently, return a conflict and require refreshing the preview; do not overwrite others' modifications.

When reuse generates a new Script, do not carry over the original document/block source relationships. If the current Script workspace requires a source document, an independent source document should be generated in the same creation flow and new mappings and workspace ownership established; do not fabricate references to the original document or generate a library that cannot be opened in the sidebar.

When inserting into a Script derived from an existing document, the new content must be consistent with the target source document, dialogue lineage, and plot plan. Before implementation, verify the existing document revision/Yjs save mechanism: the existing coordinated write mechanism must be used or the atomic coordination entry extended, to avoid the inserted table being overwritten by document regeneration. Do not downgrade to "document-derived Script not yet supported". If the existing storage cannot coordinate in a single transaction, the implementation plan must propose an operation protocol with recovery states and conflict detection and clearly communicate the limitations.

Template deletion does not affect already-created Scripts. Deletion requires UI confirmation. After a successful paste, refresh data and select the newly added fragment; on failure, retain the clipboard and preview. Batch paste is not mixed into the current per-block undo stack; this version handles subsequent editing through explicit selection of the newly added fragment and existing deletion capabilities, and does not claim to support batch undo.

## Acceptance and Verification

1. After a complete template is saved, it remains accessible after page refresh, and another member of the same project can access it according to permissions; non-members and read-only writes are rejected.
2. A new Script created from a template is visible and openable in the sidebar, with complete content, editable, and playable; the original template and source Script are unchanged.
3. Selecting nodes in the graph and selecting the corresponding blocks in the Script generate equivalent fragments; actions/dialogue, dynamic options, conditions, commands, and resource references are not lost.
4. Pasting the same fragment twice consecutively yields independent IDs and labels, correct internal jumps, and text in the body with the same name as a label is not replaced.
5. External jumps, implicit exits, and non-contiguous selections all require explicit handling, with no unexpected new paths; option endings can be played normally.
6. Deletion of the template source does not affect the content snapshot; invalid resources have clear warnings.
7. After pasting into a document-derived Script, reopening or regenerating does not lose content, and the new source relationships point to the target document.
8. Write failures leave no partial data, timeout retries do not insert duplicates, and collaboration conflicts do not overwrite others' modifications.

Tests include pure snapshot/remapping unit tests, selection and preview component tests, real local database permission/atomicity/idempotency tests, and full save—reuse—copy—reopen—play E2E. After implementation, run the repository's applicable type checks and verification gates; when external services are unavailable, truthfully mark unverified items.
