# Sidebar Folder DnD (P1) Implementation Plan

> **For agentic workers:** Implement task-by-task.

**Goal:** Drag documents and non-derived tables onto folders (or to project root) in the sidebar tree.

**Architecture:** Pure `resolveSidebarFolderDrop` helper + Ant Tree `draggable`/`allowDrop`/`onDrop` wired through `SidebarTreeView` → `Sidebar` move + query invalidation.

**Tech Stack:** Ant Design Tree, existing `moveDocument` / `moveLibraryToFolder`.

---

### Task 1: Drop-target helper + tests

- Create `src/components/layout/sidebarTreeDnD.ts`
- Create `tests/unit/layout/sidebar-tree-dnd.test.ts`

### Task 2: Enable tree DnD + Sidebar handler

- Modify `useSidebarTree` node meta (`_isDerived`)
- Modify `SidebarTreeView` / `SidebarLibrariesSection` / `Sidebar.tsx`
