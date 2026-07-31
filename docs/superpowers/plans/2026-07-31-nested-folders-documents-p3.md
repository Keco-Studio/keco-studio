# Nested Folders + Documents (P3) Implementation Plan

> Status: Implemented 2026-07-31

**Goal:** Nest folders under folders and documents under documents via sidebar DnD.

**Done:**
- Migration `20260731180000_nested_folders_documents.sql` (parent columns, uniqueness, cycle/depth triggers, sync nested doc folder)
- `moveFolderToParent`, recursive `deleteFolder`, `createFolder({ parentFolderId })`
- `moveDocument` / `nestDocumentUnderDocument` with `parent_document_id`
- Recursive sidebar tree + DnD resolver cycle/depth guards
- Unit tests for nesting helpers, DnD, migration SQL shape
