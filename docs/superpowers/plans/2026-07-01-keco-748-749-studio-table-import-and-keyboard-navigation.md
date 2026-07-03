# KECO-748/749 Studio Table Import And Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `keco-studio` document-table generation boundaries and spreadsheet-style arrow-key cell navigation.

**Architecture:** KECO-748 is implemented as stricter agent/handoff instructions with unit coverage around generated prompt text. KECO-749 is implemented through a pure navigation helper called from `useCellSelection`, then wired into `LibraryAssetsTable` keydown handling.

**Tech Stack:** Next.js, React 18, TypeScript, Jest/ts-jest.

## Global Constraints

- Work only in `/home/hetu/project/keco-studio`.
- Keep code, API names, and comments in English.
- Preserve unrelated user changes.
- Use TDD: write failing tests before production code.

---

### Task 1: KECO-748 Prompt Quality Gate

**Files:**
- Modify: `tests/unit/design-message.test.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`
- Modify: `src/lib/design-message.ts`
- Modify: `src/lib/agent/prompts.ts`

**Interfaces:**
- Consumes: `buildDesignMessage(params: BuildDesignMessageParams): string`
- Produces: stricter table extraction/generation guidance in design handoff and system prompt.

- [x] **Step 1: Write failing tests**

Add assertions that design messages mention extraction mode, explicit generation, low-quality refusal, and preserving explicit tables.

- [x] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- tests/unit/design-message.test.ts tests/unit/agent/system-prompt.test.ts`

- [x] **Step 3: Implement prompt changes**

Update `buildDesignMessage` and rule 25 in `buildSystemPrompt`.

- [x] **Step 4: Run tests to verify pass**

Run: `npm run test:unit -- tests/unit/design-message.test.ts tests/unit/agent/system-prompt.test.ts`

### Task 2: KECO-749 Arrow-Key Navigation Helper

**Files:**
- Create: `src/components/libraries/hooks/cellNavigation.ts`
- Create: `tests/unit/cell-navigation.test.ts`
- Modify: `src/components/libraries/hooks/useCellSelection.ts`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`

**Interfaces:**
- Produces: `resolveArrowKeyCellSelection(args): Set<CellKey> | null`
- Produces: `shouldIgnoreCellNavigationTarget(target: EventTarget | null): boolean`
- Produces: `handleSelectedCellArrowNavigation(event: KeyboardEvent): boolean`

- [x] **Step 1: Write failing helper tests**

Cover arrow movement, clamping, multi-selection anchor, unsupported key, and editable target ignore behavior.

- [x] **Step 2: Run tests to verify failure**

Run: `npm run test:unit -- tests/unit/cell-navigation.test.ts`

- [x] **Step 3: Implement helper and hook wiring**

Add helper, expose handler from `useCellSelection`, and attach keydown listener in `LibraryAssetsTable`.

- [x] **Step 4: Run tests to verify pass**

Run: `npm run test:unit -- tests/unit/cell-navigation.test.ts`

### Task 3: Final Verification

**Files:**
- Review all modified files.

- [x] **Step 1: Run targeted tests**

Run: `npm run test:unit -- tests/unit/design-message.test.ts tests/unit/agent/system-prompt.test.ts tests/unit/cell-navigation.test.ts`

- [x] **Step 2: Run broader relevant tests**

Run: `npm run test:unit -- tests/unit/script-conversion-service.test.ts tests/unit/agent/list-field-types.test.ts`

- [x] **Step 3: Review changes against spec**

Check behavior boundaries, local naming, coupling, and existing feature impact.
