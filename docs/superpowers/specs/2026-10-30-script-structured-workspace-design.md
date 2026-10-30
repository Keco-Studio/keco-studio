# Script Structured Workspace Design

**Date:** 2026-10-30
**Status:** Approved for implementation
**Scope:** Script workspace only

## Goal

Make Script structure immediately understandable without requiring authors to
read or write `O1`, `branch`, `merge`, or `Jump` syntax. Preserve the existing
dialogue editor and Flow chart while adding a structural outline, explicit
workspace actions, structure validation, and reusable personal structure
templates.

## Product decisions

The Script library remains the source of truth. This slice does not modify the
Document editor, document import format, Script conversion pipeline, or any
animation-generation service.

The workspace uses three synchronized regions:

1. **Structure outline** — a compact, ordered list of entry, scene, choice,
   branch, merge, and ending nodes.
2. **Script editor** — the existing visual-novel dialogue view and inline
   dialogue editing behavior.
3. **Branch map** — the existing Flow chart, retitled and visually integrated
   with the workspace.

Selecting a node in either the outline or branch map selects the same plot node
in the Script editor. No new graph mutation behavior is introduced in this
slice.

## Workspace header

The Script page adds an in-workspace header below the global product toolbar.
It contains:

- `Story Script / <library name>` as the stable context label;
- `Templates` to open the personal structure-template library;
- `Save as Template` to store the current structure locally;
- `Structure Check` with a visible issue count;
- `Save` to commit the currently active dialogue draft through the existing
  dialogue-save path.

There is no `Generate Animation` button in this slice. Animation tags and generation are
explicitly deferred.

## Structure outline

The outline is deterministically derived from the current `FlowGraph`.

Node classification uses graph topology:

- first graph node: `entry`;
- node with two or more choice edges: `choice`;
- node with multiple incoming edges: `merge`;
- node reached by a choice edge: `branch`;
- node with no outgoing edges: `ending`;
- otherwise: `scene`.

When classifications overlap, priority is `entry`, `choice`, `merge`,
`ending`, `branch`, then `scene`. Every outline row shows its type, title, and a
small structural summary. The active row has the same blue selection treatment
as the Branch map.

The panel summary shows node, choice, and ending counts. The outline is a
navigation surface, not a second graph editor.

## Structure validation

Validation is local and read-only. It reports:

- missing or unknown edge endpoints as errors;
- cycles as errors;
- nodes unreachable from the entry as warnings;
- no reachable ending as a warning;
- an empty Script graph as an error.

The structure-check dialog displays a summary and evidence-backed issues.
Clicking an issue with a node target closes the dialog and selects that node in
the workspace.

Validation never repairs or writes the graph.

## Personal structure templates

Templates are stored in browser `localStorage` under a versioned Script-only
key. A template contains:

- stable template ID;
- name and optional description;
- creation timestamp;
- a cloned `FlowGraph` snapshot;
- derived node, choice, merge, and ending counts.

The template library includes three built-in references:

- linear scene;
- two-way branch with merge;
- two-way branch with independent endings.

Authors can save the current graph as a personal template, inspect saved or
built-in templates, use one as a temporary structure reference, and delete
personal templates. Using a reference never overwrites the current Script.
Team-synced templates and applying a template as executable graph mutations are
future work because they require a durable server contract and conflict UX.

When a template is active as a reference, the workspace shows a clear banner
and the Branch map renders the reference graph in preview styling. The current
Script remains selected and editable.

## Save behavior

Existing dialogue blocks keep their current autosave and keyboard behavior.
The workspace `Save` button provides an explicit author action:

- if a dialogue draft is active, it requests that block to run its existing
  validation and persistence callback;
- if no draft is active and no mutation is pending, it confirms that the
  Script is already saved;
- while a mutation is pending, the button is disabled and shows a saving state.

The button does not introduce a second write API.

## Layout and visual language

The interface uses the existing Script blue (`#0b99ff`) as the only strong
accent. Type badges use quiet semantic tints; structure is communicated by
labels, connectors, and typography rather than many branch colors.

Desktop layout:

```text
workspace header
structure outline | script editor | branch map
```

At narrower widths the outline becomes horizontally compact before the editor
or Branch map loses its minimum readable width. The existing Branch map collapse
control remains available.

All new buttons have visible focus states and accessible names. Outline rows use
native buttons. Dialogs trap focus through the existing Ant Design modal.

## Error handling

- Invalid or unavailable local template data is ignored rather than breaking
  the Script page.
- Template names are trimmed, required, and capped at 80 characters.
- Duplicate template names are allowed because IDs are authoritative.
- Template save and delete failures show the existing toast treatment.
- Structure validation is always recomputed from the latest rendered graph.

## Non-goals

- no Document editor or Document schema changes;
- no changes to Document-to-Script conversion;
- no animation tags, animation timeline, or animation generation;
- no database migration;
- no team template sharing;
- no template-driven graph mutation;
- no replacement of the existing dialogue editor or Flow chart.

## Verification

- Unit tests cover outline classification and ordering.
- Unit tests cover validation errors, warnings, and healthy graphs.
- Unit tests cover template parsing, persistence, deletion, and corrupt storage.
- Component tests cover synchronized outline selection, workspace actions, save
  requests, template reference state, and structure-check navigation.
- Existing Script workspace tests remain green.
- TypeScript type checking passes for all touched files.
