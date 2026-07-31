# Sidebar Table ↔ Document Attach/Detach (P2)

> **For agentic workers:** Implement task-by-task.

**Goal:** Drag independent tables onto documents (attach) and drag derived tables onto folder/root (detach + move). Overrides 2026-07-20 immutability for ownership columns.

**Architecture:** Migration relaxes trigger; `attachLibraryToDocument` / `detachLibraryFromDocument` in `libraryService`; unified `resolveSidebarDrop` for folder + document targets; Sidebar `onDrop` wires both.

---

### Task 1: Migration + services + drop resolver tests
### Task 2: Wire Tree allowDrop/onDrop + Sidebar handler
