# Document Branch Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add folder-level Document Branch Structure with optional named directed document links while preserving document-internal Branch Structure.

**Architecture:** Store folder-scoped document edges in Supabase, expose authenticated folder graph and edge mutation APIs, and render a route-backed graph from the Script sidebar. Reuse existing document routes/internal graph behavior for node navigation.

**Tech Stack:** Next.js App Router, React, Supabase, Jest, TypeScript, existing CSS modules.

**Spec:** `docs/superpowers/specs/2026-11-06-document-branch-structure-design.md`

## Global Constraints

- Folder-level edges are directed and limited to Script documents in the same folder.
- Branch names are optional; empty names render as unlabeled edges.
- Self-links, duplicate edges, and cycles are rejected.
- Existing Libraries/Script sidebar visual conventions remain unchanged.

### Task 1: Relation domain and database contract

**Files:**
- Create: `supabase/migrations/20261106000000_script_document_edges.sql`
- Create: `src/lib/script-system/scriptDocumentEdgeService.ts`
- Test: `tests/unit/script-system/script-document-edge-service.test.ts`

- [ ] Write failing tests for edge normalization and cycle detection.
- [ ] Run the focused test and confirm the expected failure.
- [ ] Add the migration, service types, cycle validator, and persistence helpers.
- [ ] Run the focused test and confirm it passes.

### Task 2: Authenticated folder graph API

**Files:**
- Create: `src/app/api/script-document-edges/[projectId]/[folderId]/route.ts`
- Test: `tests/unit/api/script-document-edges-route.test.ts`

- [ ] Write failing GET/POST/DELETE route tests for valid links and rejected invalid links.
- [ ] Run the focused tests and confirm failure.
- [ ] Implement authorization, same-folder validation, and stable JSON responses.
- [ ] Run focused API tests and then the existing API suite.

### Task 3: Folder graph rendering and navigation

**Files:**
- Create: `src/components/script-system/DocumentBranchStructure.tsx`
- Create: `src/components/script-system/DocumentBranchStructure.module.css`
- Create: `src/app/(dashboard)/script-system/[projectId]/folder/[folderId]/branch/page.tsx`
- Modify: `src/components/script-system/ScriptSidebar.tsx`
- Test: `tests/unit/script-system/document-branch-structure.test.tsx`

- [ ] Write failing tests for folder graph nodes, optional labels, and node navigation.
- [ ] Implement the graph and folder route using the existing Script workspace document list.
- [ ] Make folder selection expand the folder and navigate to the graph route.
- [ ] Run focused component tests.

### Task 4: Connection creation/editing and integration verification

**Files:**
- Modify: `src/components/script-system/DocumentBranchStructure.tsx`
- Create: `src/components/script-system/DocumentEdgeDialog.tsx`
- Test: `tests/unit/script-system/document-edge-dialog.test.tsx`

- [ ] Write failing tests for optional branch name submission and deletion.
- [ ] Implement the dialog and graph refresh behavior.
- [ ] Run all Script/document tests, TypeScript, ESLint, and `git diff --check`.
