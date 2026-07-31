# Keco Script Workspace — Design

**Date:** 2026-07-31  
**Status:** Approved  
**Scope:** Independent LeftNav product mode for script documentation import, document preview, Generate conversation, and script split view (dialogue + Flow chart).

## Summary

Add a **Keco Script** product mode on the far-left LeftNav (speech-bubble icon between Simulation and the existing coming-soon slots). Users pick an existing **Studio Document** via Import Documentation, add it to a per-project Script workspace reference list (no document copy), edit it in place, then run **Generate conversation** to create a derived `script` child. Opening that child shows a resizable split: left Visual Novel dialogue, right Flow chart built from Story IR / compiled script table edges (`Label` + `OptionN_Next`).

## Goals

- LeftNav entry into an independent Script shell (sidebar title **Keco Script**).
- Import Documentation UI: Select form → choose Studio Document → Import → editable document preview.
- Script sidebar lists only workspace-imported documents and their `document_export_type === 'script'` children.
- Script-mode document RMB: Generate conversation, Rename, Delete (workspace reference); **no Generate table**; no Move to in v1.
- Script child view: left `VisualNovelScriptView`, right Flow chart, movable divider.
- Reuse existing document collaboration editor, `runDocumentDerivedImport` / `/api/import-script`, and derived-library nesting under documents.

## Non-Goals (v1)

- Copying or forking document bodies into a separate Script store.
- Flow chart node editing / manual graph authoring.
- Agent ChatPanel inside the Script shell.
- Script-mode folder tree or Move to.
- Showing table-derived libraries in the Script tree.
- Removing Generate table from Studio RMB or disabling Agent `exportType: 'table'` globally.
- Persisting a separate StoryDocument blob table (graph is derived from imported script rows).

## Confirmed Product Decisions

| Topic | Decision |
|-------|----------|
| Product shape | Independent mode like Simulation (not Studio-only UI) |
| Select form source | Current project Studio Documents |
| Left pane after generate | Visual Novel dialogue (`VisualNovelScriptView`) |
| Flow chart data | Story IR / script table `Label` + `OptionN_Next` (linear `next` is compiled into option jump cells; see `tableCompiler`) |
| Import vs generate | Two-step: Import opens editable doc; RMB Generate conversation creates script child |
| Generate table | Hidden only in Script-mode document menu; Studio keeps it |

## Architecture

### Shell layout

```
[LeftNav] | [Script Sidebar] | [main: TopBar + content]
```

- Studio project-tree Sidebar and Agent ChatPanel are **hidden** on Script routes.
- TopBar may remain for breadcrumbs / search / share consistency with Studio chrome.

### Routes

| Path | Content |
|------|---------|
| `/script-system` | Resolve preferred project (localStorage, same pattern as Simulation) or project picker |
| `/script-system/[projectId]` | Default main: Import Documentation |
| `/script-system/[projectId]/doc/[documentId]` | Editable document (reuse DocumentEditor / collab) |
| `/script-system/[projectId]/script/[libraryId]` | Split view: VN + Flow chart |

Guard: `doc` and `script` routes require the document (or script’s `source_document_id`) to be in that project’s Script workspace references.

### LeftNav

Insert speech-bubble icon **after Lightning (Simulation)** and **before** the coming-soon icons.

| Slot | Behavior |
|------|----------|
| Grid | Studio (unchanged; active when not simulation and not script) |
| Lightning | `/simulation-system` |
| **Speech** | `/script-system` — active when path starts with `/script-system` |
| Coming soon ×2 | Unchanged |
| Collapse | Unchanged |

Studio active rule updates: active when pathname is not under `/simulation-system` **and** not under `/script-system`.

## Import Documentation

### UI (default main for project workspace)

- Title: **Import Documentation** + short helper copy (product-accurate; do not reuse Simulation port-mapping copy from mock if incorrect).
- Left: **Select form** card + **Import documentation** button.
- Right: **STUDIO SOURCE DOCUMENTATION** preview of the selected document (read-only until Import succeeds).
- Sidebar **Import** button focuses the same Import Documentation main view / Select form.

### Select form

- Modal or drawer listing Studio Documents in the current `projectId` (optional name / folder filter).
- Single select; card shows selected title.

### Import action

1. Validate document exists and user can read it.
2. Upsert workspace reference `(project_id, document_id)`.
3. Navigate to `/script-system/[projectId]/doc/[documentId]`.
4. Repeat import of same document is **idempotent** (no duplicate sidebar rows; navigate to existing).

Does **not** run Generate conversation automatically.

## Data model: workspace references

New table (name may be adjusted in implementation plan):

```sql
script_workspace_documents (
  project_id uuid not null references projects(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id),
  primary key (project_id, document_id)
)
```

- RLS: project members can read; editors/admins can insert/delete (align with existing project document write rules).
- Deleting the Studio document cascades the reference away.
- **Delete** in Script document menu removes the **reference only**, not the Studio document.

Optional: `keco.script.projectPreference` localStorage mirror of Simulation’s project preference for `/script-system` landing.

## Script Sidebar

### Header

- Title: **Keco Script**
- Subtitle: Manage and config game assets for game designers. (match mock)
- Project dropdown: switch `projectId` within Script mode
- **Import** button → Import Documentation view

### Tree

```
{document name}
  └ {script derived library name}   -- speech icon; only document_export_type = 'script'
```

- Parent click → doc route  
- Child click → script split route  
- Do not list `document_export_type = 'table'` children  
- Naming of derived libs: existing Studio rules (`script - …`)

### Context menus (Script mode only)

**Document**

| Item | Behavior |
|------|----------|
| Generate conversation | Same pipeline as Studio: `fetchDocumentExportSource` + `runDocumentDerivedImport` with `exportType: 'script'` (admin) |
| Generate table | **Omitted** |
| Rename | Existing document rename |
| Move to | **Omitted** in v1 |
| Delete | Remove workspace reference only |

**Script child**

- Rename / Delete derived library only (existing derived-library rules). No generate actions.

On successful Generate conversation: expand parent, select new child, navigate to script split route. Progress banner reuses `documentDerivedImportProgress`.

Studio context menus are unchanged (Generate table remains).

## Script split view

### Layout

```
Header: {library name} · sync/status if applicable
[ VisualNovelScriptView (~65–70%) ] | drag handle | [ Flow chart (~30–35%) ]
```

- Resizable divider; clamp min ~240px per pane; persist ratio in `localStorage` (e.g. `keco.script.splitRatio`).
- Flow chart panel title **Flow chart** with close (X) to collapse; reopen via control in header or sidebar affordance.
- No Agent ChatPanel on this route in v1.

### Left: dialogue

Reuse `VisualNovelScriptView` with the script library’s asset rows and column mapping (same as Studio library script mode).

### Right: Flow chart

- Build graph from compiled script table rows (same columns as `STORY_BASE_COLUMNS` / `compileStoryTable`):
  - Node id/text: `Label` (optional secondary speaker from `Name`).
  - Edges: parse `Option0_Next` … `OptionN_Next` targets (including `Jump {Label}` forms produced for linear `StoryNode.next`).
- There is **no** standalone `Next` column in the exported table; do not look for one.
- Read-only auto layout (tree / layered); no edit.
- Selected / current node: blue outline (match mock).
- Optional: click node scrolls left pane to matching row when Label→row mapping exists.
- Empty / missing Label column: empty-state copy, not a hard crash.

## Error handling

| Case | Behavior |
|------|----------|
| Select / Import without permission | Toast; no reference write |
| Document deleted after import | Reference gone; tree updates; open routes redirect to Import |
| Generate conversation failure | Existing error + progress bus failure path |
| Invalid library on script route | 404 / redirect to project Import |
| Flow chart build failure | Empty state in panel; dialogue still usable |

## Testing

### Unit

- LeftNav Script icon placement and active path
- Workspace reference upsert idempotency; delete reference does not delete document
- Script document menu includes Generate conversation, excludes Generate table; Studio still includes Generate table
- Flow chart builder: Label + OptionN_Next (incl. Jump targets) → nodes/edges; missing Label → empty

### Component / integration

- Select form lists only current project documents
- Import adds sidebar entry and opens doc route
- Generate conversation adds script child and opens split route
- Divider drag persists ratio

### E2E smoke

LeftNav → Import Documentation → Select form → Import → open doc → RMB Generate conversation → open script → both panes visible

## Component / file plan (indicative)

| Piece | Likely location |
|-------|-----------------|
| LeftNav speech item | `src/components/layout/LeftNav.tsx` |
| Script routes / layout | `src/app/(dashboard)/script-system/...` |
| Script shell + sidebar | `src/components/script-system/` (new) |
| Import Documentation page | same feature folder |
| Document picker | same |
| Workspace API / service | `src/lib/script-system/` + migration |
| Split view + Flow chart | `src/components/script-system/ScriptSplitView.tsx`, `FlowChartPanel.tsx`, graph builder util |
| Context menu Script variant | `ContextMenu.tsx` / Script sidebar hook (mode flag) |

## Related specs

- `2026-07-20-leftnav-design.md`
- `2026-07-20-document-derived-libraries-design.md`
- `2026-07-22-sidebar-tree-interaction-design.md`
- `2026-07-29-agent-generate-from-document-design.md`

## Open points for implementation plan (not blocking design)

1. Exact helper copy under Import Documentation title (replace Simulation-like mock text).
2. Whether DocumentEditor is embedded in Script layout or navigates with a thin Script chrome wrapper.
3. Flow chart layout library choice (custom SVG vs small graph layout helper) — pick in plan for complexity/bundle size.
