# Sidebar Tree Interaction Redesign

**Date:** 2026-07-22  
**Status:** Draft (awaiting user review)  
**Scope:** `keco-studio` project-tree Sidebar only (Libraries / Folder / Document / derived children).

## Summary

Redesign sidebar discovery and context actions so first-time users can find create/import/generate flows without relying on opaque left-clicks. Libraries and Folder `+` buttons open explicit menus. Document left-click remains select/navigate; right-click gains generate conversation (script) / generate table plus delete/rename. Derived children under a document get a slim right-click menu. Rename is unified to double-click inline edit + Enter.

This builds on the existing document-derived libraries model (`source_document_id` + `document_export_type`) and does not introduce a new conversation tree-node type.

## Goals

- Make Libraries `+` and Folder `+` discoverable action menus (left-click).
- Replace Folder `+`’s previous “immediately create library” behavior with a menu.
- Expose Document → table / script generation from the sidebar context menu.
- Keep Document and derived-child left-click as select + navigate.
- Unify rename UX to inline edit (double-click or menu “Rename” → same editor; Enter saves).

## Non-Goals

- New agent-conversation tree nodes under documents.
- Nested folders (`create new folder` under a Folder).
- Delete / rename on the Libraries section `+` menu.
- Redesigning LeftNav / TopBar / ChatPanel.
- Changing derived-library ownership, move, or cascade-delete rules (see `2026-07-20-document-derived-libraries-design.md`).

## Confirmed Product Rules

### Libraries header `+` (left-click menu)

1. Create new folder  
2. Create new table (= former “Create new library” / `NewLibraryModal`)  
3. Create new document  
4. Import document  
5. Import table (Excel → library via `ImportLibraryModal`, project root / no folder)  
6. **No** delete / rename on this menu  

### Folder row `+` (left-click menu; replaces immediate new-library)

1. Create new table (scoped to this folder)  
2. Create new document (scoped to this folder)  
3. Import document (scoped to this folder)  
4. Import table (Excel, scoped to this folder)  
5. Delete (this folder)  
6. Rename (start inline rename on this folder)  
7. Duplicate (this folder)  
8. **No** create new folder (no nesting in this iteration)

### Document row

- Left-click: select and navigate to `/{projectId}/doc/{id}`.  
- Right-click menu:
  1. Generate conversation (= existing script export path / `document_export_type: 'script'`)  
  2. Generate table (= existing tables export / design-upload handoff path / `document_export_type: 'table'`)  
  3. Delete  
  4. Rename (inline)  
- After a successful generate, the document shows an expand/collapse arrow; children nest under it and can be collapsed.

### Document children (derived libraries: table / script)

- Left-click: select and navigate to the library route.  
- Right-click: **only** Delete / Rename (inline).  
- Hide Export, Version history, Library info, Duplicate, Move to… for derived children in this slim menu.

### Rename (all tree entities in scope)

- Double-click the name → inline input → Enter saves, Esc cancels.  
- Menu “Rename” starts the same inline editor (no name-only modal).  
- Empty / unchanged names cancel; name conflicts use existing error handling.  
- “Library info” / “Project info” modals (if retained elsewhere) are for non-name fields only, not the primary rename path for tree rows.

## Terminology Mapping

| UI label | Existing concept |
|----------|------------------|
| Table | Library (`libraries` row); create = `NewLibraryModal`; import = Excel `ImportLibraryModal` |
| Conversation (under document) | Derived library with `document_export_type === 'script'` |
| Table (under document) | Derived library with `document_export_type === 'table'` |
| Generate conversation | Same pipeline as Document editor “Export as script” |
| Generate table | Same pipeline as Document editor “Export as tables” |

## Architecture / Data Flow

Unchanged data model:

- Folders, documents, libraries queried as today (`useSidebarFoldersLibraries`, `useSidebarDocuments`).  
- Derived children: libraries with `source_document_id` nested under `document-{id}` in `useSidebarTree`.  
- Selection: URL + `NavigationContext`.  
- Expand-on-create: `notifyDocumentDerivedLibraryCreated` → expand `document-{id}`.

Generate from sidebar:

1. Context action resolves the target document id / latest content the same way the document editor export does.  
2. Table path: design handoff + agent generation; on success, invalidate folders/libraries and expand parent document.  
3. Script path: open `ImportScriptModal` with `documentSource` (or equivalent existing entry); on import success, notify derived-library created and expand.

Folder-scoped creates/imports set `selectedFolderId` (or modal `folderId` prop) before opening the corresponding modal.

## UI Component Plan

| Area | Approach |
|------|----------|
| Libraries `+` | Update `AddLibraryMenu` to the five items above; label create-library as “Create new table”; add Import table; **remove** the old “Generate tables from document” shortcut (generation lives on document RMB). |
| Folder `+` | Stop calling `openNewLibrary()` directly; open an anchored menu (reuse `AddLibraryMenu` pattern or shared small menu) with folder-scoped actions. |
| Document / child RMB | Update `ContextMenu` branches; detect derived library via `source_document_id` / `isDerivedLibrary` for slim menu. |
| Actions wiring | Extend `useSidebarContextMenuActions` (+ Sidebar modal openers) for generate table/script, folder menu actions, rename → `startInlineRename`. |
| Tree rendering | `useSidebarTree` / `SidebarTreeView`: folder `+` click opens menu; expand arrow already gated on children — keep that. |
| Folder duplicate | Implement usable duplicate in this iteration if feasible; otherwise disable the menu item with a clear reason — **no silent no-op**. |

Primary files (expected):

- `src/components/libraries/AddLibraryMenu.tsx`  
- `src/components/layout/Sidebar.tsx`  
- `src/components/layout/ContextMenu.tsx`  
- `src/components/layout/components/SidebarTreeView.tsx`  
- `src/components/layout/components/SidebarLibrariesSection.tsx`  
- `src/components/layout/hooks/useSidebarTree.tsx`  
- `src/components/layout/hooks/useSidebarContextMenuActions.ts`  
- `src/components/layout/hooks/useSidebarModals.ts`  
- Folder duplicate service/API if missing  

## Permissions

Reuse existing role helpers (`canCreateDocument`, `canEdit`, `canDelete`, `canDuplicate`, admin/editor gates on create library / import):

- **Admin:** full create/import/delete/rename/duplicate; generate table/script (aligned with derived-libraries rule: export/generate is admin).  
- **Editor:** document create/import and document rename where already allowed; folder/table destructive actions only if existing helpers allow.  
- **Viewer:** no write menu items.  

Menu items the user cannot perform are omitted (not shown disabled), matching current ContextMenu style unless an existing pattern already disables.

## Error Handling & Edge Cases

- No derived children → document is a leaf (no expand arrow).  
- Generate failure → existing toast/error; do not expand empty parent.  
- Import document into folder → `ImportDocumentModal` must accept folder scope (wire `folderId` if not already).  
- Folder delete confirms and uses existing cascade behavior.  
- Folder duplicate naming: append “Copy” / existing duplicate naming convention used by libraries.  
- Right-click on document while editor dirty → follow existing navigate/flush patterns if generation needs latest content; otherwise use the same flush the editor export uses.

## Testing / Acceptance

1. Libraries `+` shows exactly the five create/import items; no delete/rename.  
2. Folder `+` left-click opens menu; does **not** immediately create a library.  
3. Folder menu create/import targets that folder; delete/rename/duplicate act on that folder.  
4. Document LMB navigates; RMB shows generate conversation, generate table, delete, rename.  
5. After generate, document gains expand arrow and nested child; collapse works.  
6. Child LMB navigates; RMB only delete/rename.  
7. Double-click rename + Enter saves for folder, document, table/library, and derived child; menu Rename uses the same inline path.  
8. Role gating matches existing permissions (viewer sees no write actions).

## Out of Scope Follow-ups

- Nested folders.  
- Slimming Folder **right-click** to match Folder `+` exactly (optional consistency pass).  
- Removing Edit* name modals entirely if still used for description fields.
