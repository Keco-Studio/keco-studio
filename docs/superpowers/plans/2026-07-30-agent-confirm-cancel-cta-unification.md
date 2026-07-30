# Agent Confirm/Cancel CTA Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Confirm + Cancel CTAs on all Agent confirmation / preview cards.

**Architecture:** Keep card bodies and titles; only align unresolved action buttons to the shared ConfirmationCard pill contract (`✓ Confirm` / `Cancel`, test ids, aria-labels). Fix insert-ref Cancel class typo.

**Tech Stack:** React, Jest `renderToStaticMarkup`, existing ChatPanel CSS pill classes.

## Global Constraints

- English-only source (CI CJK check)
- Do not add Confirm/Cancel to assistant text bubbles
- Keep ScriptPreview "Edit in Import Modal" tertiary action
- Do not change approve/reject API or resume behavior

---

### Task 1: Failing tests for unified CTAs

**Files:**
- Modify: `tests/unit/agent/document-confirmation-ui.test.tsx`

- [x] Add test: setup_library preview shows `✓ Confirm`, `Cancel`, `agent-confirm`, `agent-reject`, Approve/Reject aria-labels; does not show `Create library` as button label
- [x] Add test: script import preview shows same Confirm/Cancel contract and still shows `Edit in Import Modal`; does not show `Import Directly`
- [x] Assert insert_resource_reference Cancel uses consistent `Cancel` label (no requirement on ✕)
- [x] Run `npm run test:unit -- tests/unit/agent/document-confirmation-ui.test.tsx --no-coverage` and confirm new tests fail

### Task 2: Unify preview card buttons + ConfirmationCard polish

**Files:**
- Modify: `src/components/agent/SetupLibraryPreviewCard.tsx`
- Modify: `src/components/agent/ScriptPreviewCard.tsx`
- Modify: `src/components/agent/ConfirmationCard.tsx`

- [x] SetupLibrary: primary `✓ Confirm` with pill styles + test ids / aria-labels; Cancel as `btnPillGhost`
- [x] ScriptPreview: `Import Directly` → `✓ Confirm` with same contract; keep Edit in Import Modal; Cancel pill
- [x] ConfirmationCard insert-ref: `btnPill` → `btnPillGhost`; plain `Cancel` (drop ✕ if present); ensure `agent-reject` on generate variant
- [x] Re-run unit test file; all green

### Task 3: Verify

- [x] `npm run test:unit -- tests/unit/agent/document-confirmation-ui.test.tsx --no-coverage`
- [x] Spot-check no Chinese characters in touched files
