# Script Structured Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Script-only three-region workspace with synchronized structure navigation, local structure validation, personal templates, and an explicit save action.

**Architecture:** Derive read-only workspace metadata from the existing `FlowGraph`, keeping the Script library and current dialogue mutation hook authoritative. Add focused pure modules for outline/validation and template persistence, then compose them through small Script workspace components around the existing visual-novel editor and Flow chart.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS modules, Ant Design Modal, Jest, Testing Library

**Spec:** `docs/superpowers/specs/2026-10-30-script-structured-workspace-design.md`

## Global Constraints

- Modify only the Script workspace; do not change Document editing or conversion.
- Do not implement animation tags or animation generation.
- Do not add database migrations or server persistence for templates.
- Keep the Script library and existing dialogue mutation hook authoritative.
- Templates are read-only structure references and never mutate the current graph.
- Reuse `#0b99ff` as the only strong visual accent.

---

### Task 1: Structure outline and validation model

**Files:**
- Create: `src/lib/script-system/scriptWorkspaceStructure.ts`
- Test: `src/lib/script-system/scriptWorkspaceStructure.test.ts`

**Interfaces:**
- Consumes: `FlowGraph` from `buildScriptFlowGraph.ts`.
- Produces: `deriveScriptWorkspaceStructure(graph)`, `validateScriptWorkspaceStructure(graph)`, `ScriptStructureItem`, and `ScriptStructureValidation`.

- [ ] **Step 1: Write failing tests for classification and validation**

Cover a healthy two-way merge graph, independent endings, an unreachable node,
a cycle, and an edge with an unknown endpoint. Assert classification priority,
counts, issues, and deterministic graph-order output.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/script-system/scriptWorkspaceStructure.test.ts`

Expected: FAIL because `scriptWorkspaceStructure.ts` does not exist.

- [ ] **Step 3: Implement the pure graph model**

Build topology maps, ordered classification, counts, DFS reachability,
three-color cycle detection, ending detection, and evidence-bearing issues.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:unit -- --runInBand src/lib/script-system/scriptWorkspaceStructure.test.ts`

Expected: PASS.

### Task 2: Personal structure-template persistence

**Files:**
- Create: `src/lib/script-system/scriptStructureTemplates.ts`
- Test: `src/lib/script-system/scriptStructureTemplates.test.ts`

**Interfaces:**
- Consumes: `FlowGraph` and structure counts from Task 1.
- Produces: `ScriptStructureTemplate`, `BUILT_IN_SCRIPT_TEMPLATES`, `readScriptStructureTemplates(storage)`, `saveScriptStructureTemplate(storage, input)`, and `deleteScriptStructureTemplate(storage, id)`.

- [ ] **Step 1: Write failing tests for built-ins and persistence**

Use an in-memory `Storage` double. Assert clone safety, trimmed and capped names,
save/read/delete, corrupt storage recovery, and immutable built-in references.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- --runInBand src/lib/script-system/scriptStructureTemplates.test.ts`

Expected: FAIL because the template module does not exist.

- [ ] **Step 3: Implement versioned local persistence and built-ins**

Use key `keco.script.structureTemplates.v1`, schema version `1`, defensive
parsing, generated IDs, and cloned graphs.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:unit -- --runInBand src/lib/script-system/scriptStructureTemplates.test.ts`

Expected: PASS.

### Task 3: Structure outline, checks, and template UI

**Files:**
- Create: `src/components/script-system/ScriptStructurePanel.tsx`
- Create: `src/components/script-system/ScriptStructurePanel.module.css`
- Create: `src/components/script-system/ScriptWorkspaceToolbar.tsx`
- Create: `src/components/script-system/ScriptWorkspaceToolbar.module.css`
- Create: `src/components/script-system/ScriptStructureCheckModal.tsx`
- Create: `src/components/script-system/ScriptTemplateModal.tsx`
- Create: `src/components/script-system/ScriptTemplateModal.module.css`
- Test: `src/components/script-system/ScriptWorkspaceChrome.test.tsx`

**Interfaces:**
- Consumes: structure and validation outputs from Task 1; templates from Task 2.
- Produces: accessible presentational components with callback-only mutations.

- [ ] **Step 1: Write failing rendering and interaction tests**

Assert node type labels, selected outline state, issue navigation, toolbar
callbacks, personal-template deletion, name validation, and structure-reference
selection.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptWorkspaceChrome.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the components and CSS modules**

Keep state ownership in the caller. Use native buttons for outline and toolbar,
Ant Design `Modal` for checks/templates, and quiet semantic type badges.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptWorkspaceChrome.test.tsx`

Expected: PASS.

### Task 4: Explicit save through the existing dialogue editor

**Files:**
- Modify: `src/components/libraries/components/VisualNovelScriptView.tsx`
- Modify: `src/components/script-system/ScriptEditableDialogBlock.tsx`
- Test: `src/components/script-system/ScriptEditableDialogBlock.test.tsx`

**Interfaces:**
- Consumes: monotonically increasing `saveRequestVersion` from the workspace.
- Produces: active draft commits through existing `onSaveBlock` and reports the result.

- [ ] **Step 1: Write a failing test for an external save request**

Render an editing block, change its dialogue, increment `saveRequestVersion`,
and assert `onSaveBlock` receives the draft once and completion reports success.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptEditableDialogBlock.test.tsx`

Expected: FAIL because save-request props are absent.

- [ ] **Step 3: Add idempotent save-request handling**

Track the last handled positive version. Only the active block handles a
request. Reuse `finishEditing()` so validation and persistence remain unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptEditableDialogBlock.test.tsx`

Expected: PASS.

### Task 5: Compose the three-region Script workspace

**Files:**
- Modify: `src/components/script-system/ScriptSplitView.tsx`
- Modify: `src/components/script-system/ScriptSplitView.module.css`
- Modify: `src/components/script-system/FlowChartPanel.tsx`
- Modify: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`
- Modify: `src/components/script-system/ScriptSplitView.test.tsx`
- Modify: `tests/unit/script-system/script-split-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 plus `libraryName` from the Script page.
- Produces: synchronized outline/editor/map selection, template reference preview, checks, and save state.

- [ ] **Step 1: Extend failing integration tests**

Assert the page passes `libraryName`, the split view renders workspace chrome,
outline/map selection share one path, a reference graph does not replace Script
rows, and save with no active edit reports an already-saved state.

- [ ] **Step 2: Run Script split tests and verify RED**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptSplitView.test.tsx tests/unit/script-system/script-split-wiring.test.ts`

Expected: FAIL on missing workspace composition.

- [ ] **Step 3: Compose state and interactions**

Add `libraryName`, derive structure and validation, own modal/template/save
state, centralize node selection, render three regions, and pass save requests
into `VisualNovelScriptView`. Allow `FlowChartPanel` to accept a title and
reference badge while preserving defaults.

- [ ] **Step 4: Implement responsive workspace CSS**

Add a 220px structure rail, retain the resizable editor/map behavior in the
remaining space, compact the rail below 1100px, and preserve map collapse.

- [ ] **Step 5: Run integration and existing Script tests**

Run: `npm run test:unit -- --runInBand src/components/script-system/ScriptSplitView.test.tsx src/components/script-system/FlowChartPanel.test.tsx tests/unit/script-system`

Expected: PASS.

### Task 6: Final verification and review

**Files:**
- Modify only files required by failures found in this task.

**Interfaces:**
- Consumes: completed workspace.
- Produces: verified delivery evidence.

- [ ] **Step 1: Run focused Script tests**

Run: `npm run test:unit -- --runInBand src/components/script-system tests/unit/script-system`

Expected: PASS.

- [ ] **Step 2: Run TypeScript checking**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint on touched source files**

Run: `npx eslint src/components/script-system src/lib/script-system/scriptWorkspaceStructure.ts src/lib/script-system/scriptStructureTemplates.ts 'src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx'`

Expected: PASS.

- [ ] **Step 4: Visually inspect a Script route when local data is available**

Check desktop hierarchy, compact behavior, selection sync, dialogs, keyboard
focus, reference badge, and save feedback. If runtime data is unavailable,
record the limitation and rely on component tests.

- [ ] **Step 5: Review final repository state**

```bash
git status --short
git diff --check
git diff --stat dev-ting...HEAD
```
