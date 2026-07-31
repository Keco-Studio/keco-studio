# Draggable Agent launcher + Sidebar tree DnD nesting

**Date:** 2026-07-31  
**Status:** Approved for phased implementation (user chose full P0→P3)  
**Scope:** Moveable Agent FAB; sidebar drag-and-drop so items can nest under folders/documents (and later nested folders/documents)

## Goals

1. **#5 Agent launcher** — Floating Agent icon must not permanently obscure content: user can drag it anywhere on the viewport; click still opens the panel.
2. **#9 Sidebar nesting via drag** — Users can drag tree items so one becomes a child of another, covering:
   - Document ↔ Folder (and root)
   - Table (library) ↔ Folder (and root)
   - Table → under Document (derived child) / out from Document
   - Folder → Folder (nested folders)
   - Document → Document (nested documents)

## Non-goals (this program)

- Redesigning Agent chat panel chrome beyond launcher position.
- Nested create-folder from Folder `+` menu (may follow once P3 lands).
- Arbitrary cross-project moves.
- Reordering siblings without a parent change (optional later; drops that only reorder may no-op in P1).

## Phases

### P0 — Draggable Agent launcher

**Behavior**

- Closed-state `.launcher` is `position: fixed`; default remains bottom-right.
- Pointer down + move beyond a small threshold (e.g. 4–6px) starts drag; otherwise click opens panel.
- While dragging, update `left`/`top` (or `right`/`bottom`) from pointer; clamp inside viewport (keep full button visible).
- Persist `{ x, y }` (viewport coordinates or `{ right, bottom }` offsets) in `localStorage` keyed per user or globally (`keco.agentLauncherPosition`).
- On load, restore if valid; if off-screen after resize, clamp again.
- Open panel behavior unchanged (panel can stay docked as today).

**Files (expected)**

- `src/components/agent/ChatPanel.tsx`
- `src/components/agent/ChatPanel.module.css`
- Small helper hook e.g. `useDraggableLauncherPosition.ts`

**Verification**

- Drag moves icon; refresh restores position; click without drag opens agent; content underneath can be cleared by moving icon.

---

### P1 — Drag into / out of Folder

**Behavior**

- Enable Ant Design Tree (or current sidebar tree) `draggable` for Document and non-derived Library nodes.
- Drop on Folder → set `folder_id` via existing `moveDocument` / `moveLibraryToFolder`.
- Drop on project Libraries root / empty root zone → `folder_id = null`.
- Reject illegal drops (viewer; derived library move rules already in `moveLibraryToFolder`).
- Expand target folder on successful drop; toast on failure.

**Files (expected)**

- `SidebarTreeView.tsx` / `useSidebarTree.tsx` / `Sidebar.tsx`
- Reuse `documentService.moveDocument`, `libraryService.moveLibraryToFolder`

**Verification**

- Drag document into folder and out to root; drag plain table into folder; UI updates without full reload.

---

### P2 — Table under Document (attach / detach derived)

**Behavior**

- Drag a **non-derived** table onto a Document → attach as derived child:
  - Set `source_document_id`, `document_export_type` (default `'table'` unless product specifies otherwise), and `folder_id` to match the document’s folder (existing integrity trigger).
- Drag a **derived** table onto Folder/root (or explicit “detach” drop) → clear `source_document_id` / `document_export_type` if product allows; otherwise block with message (align with current move guards).
- Must not break cascade-delete / move-with-document rules from `2026-07-20-document-derived-libraries-design.md`.

**Likely new/extended API**

- `attachLibraryToDocument` / `detachLibraryFromDocument` (or extend move helpers) with permission checks.

**Verification**

- Drop table under document → appears nested with expand arrow; move document folder → child follows; detach/move rules match spec.

---

### P3 — Nested Folders + Nested Documents

**Schema**

- `folders.parent_folder_id uuid null references folders(id) on delete …` (policy: restrict or cascade — prefer **restrict** delete if children exist, or cascade with explicit product copy).
- `documents.parent_document_id uuid null references documents(id) …` plus keep `folder_id` for placement in a folder tree; define integrity:
  - Child document’s `folder_id` must match parent document’s `folder_id` (or null together), similar to derived libraries.
- Indexes + RLS updates; prevent cycles (trigger or app-level path check).

**UI**

- Tree builds recursive folder children and document children.
- DnD: folder onto folder; document onto document; cycle prevention; max depth optional (recommend soft max e.g. 8).

**Verification**

- Nested folder expand/collapse; nested document under document; cycle drop rejected; delete/move semantics documented and tested.

---

## Cross-cutting DnD UX

- Drag ghost / drop highlight on valid targets; invalid targets show no-drop cursor.
- Admin (and editor where existing move APIs allow) only; viewers cannot drag.
- Optimistic tree update + invalidate React Query keys (`documents`, folders/libraries lists).
- Do not start drag from inline-rename input or `+` / menu buttons.

## Agent launcher vs panel

- Only the **closed** launcher is freely positioned in P0.
- When panel is open, existing docked layout remains (no requirement to float the open panel in this program).

## Rollout

| Phase | Ship as | Depends on |
|-------|---------|------------|
| P0 | Independent PR | — |
| P1 | PR | — |
| P2 | PR | P1 tree DnD plumbing preferred |
| P3 | PR(s) | Schema migration + P1 patterns |

## Success criteria

- Agent icon can be moved anywhere and no longer permanently blocks a fixed corner.
- Users can nest via drag for all four nesting modes above after P3.
- Existing derived-library and RLS invariants hold; no orphan cross-project links.
