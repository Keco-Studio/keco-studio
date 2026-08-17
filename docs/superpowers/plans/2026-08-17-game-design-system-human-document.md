# Game Design System Human Document Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Open Design-style human-readable design document to every generated Game Design System while preserving structured rules as the Agent execution contract.

**Architecture:** DeepSeek will return a validated JSON envelope containing a `document` object and the existing `rules` object. The server will persist both on immutable versions and deterministically render `rendered_markdown`; the workspace will default to the document view and retain the Rules editor as the structured authoring surface.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Supabase/Postgres migrations, React Query, React Markdown, Jest, Playwright.

## Global Constraints

- `rules` remains the authoritative Agent policy contract; Markdown is a human-readable projection.
- The model returns JSON only; the server owns schema validation and Markdown rendering.
- Existing generation jobs, idempotency, retry, source redaction, project pinning, and legacy migration behavior remain intact.
- Existing versions without a document must remain readable through deterministic compatibility derivation.
- The primary generated result must not be raw JSON.
- Preserve unrelated dirty-worktree changes and stage only files listed in each task.

---

### Task 1: Add Document Contract and Deterministic Renderer

**Files:**
- Modify: `src/lib/game-design-system/ruleSchema.ts`
- Modify: `src/lib/game-design-system/ruleMarkdown.ts`
- Test: `src/lib/game-design-system/ruleSchema.test.ts`
- Test: `src/lib/game-design-system/ruleMarkdown.test.ts` (create if absent)

**Interfaces:**
- Produce `GameDesignDocument`, `gameDesignDocumentSchema`, `generatedGameDesignSystemSchema`, `parseGameDesignDocument`, and `buildCompatibilityGameDesignDocument`.
- Update `renderRuleSetMarkdown(ruleSet, metadata)` to accept `{ document?: GameDesignDocument | null }` and render document sections before rule sections.

- [ ] **Step 1: Write failing schema and renderer tests.**

  Add a valid document fixture with the nine fields from the approved spec. Assert that `parseGameDesignDocument` accepts it, rejects missing/empty fields and overlong fields, and that `renderRuleSetMarkdown` includes `## Design Intent & Player Fantasy`, `## Core Loop`, and the document text before `## Principles`. Add a compatibility test proving a rules-only version yields a non-empty document with a sentence derived from metadata and rules.

- [ ] **Step 2: Run the focused tests and verify they fail.**

  Run:

  ```bash
  npx jest src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/ruleMarkdown.test.ts --runInBand
  ```

  Expected: FAIL because the document schema, compatibility helper, and renderer argument do not exist.

- [ ] **Step 3: Implement the contract and renderer.**

  Use bounded trimmed strings for each document section, enforce the existing 64 KiB rule-set budget against the combined generated envelope, and keep the renderer deterministic. Render these headings in this order: `Design Intent & Player Fantasy`, `Core Loop`, `Decision Structure`, `Rules & System Boundaries`, `Progression & Economy`, `Content Model`, `Difficulty & Balance`, `Experience & Presentation`, then the existing grouped rule sections and `Keco Table Guidance`.

- [ ] **Step 4: Run the focused tests and verify they pass.**

  Run the same Jest command. Expected: PASS.

- [ ] **Step 5: Commit the contract slice.**

  ```bash
  git add src/lib/game-design-system/ruleSchema.ts src/lib/game-design-system/ruleMarkdown.ts src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/ruleMarkdown.test.ts
  git commit -m "feat: add human game design document contract"
  ```

### Task 2: Generate Document and Rules Together

**Files:**
- Modify: `src/lib/gameDesignSystemGeneration.ts`
- Modify: `src/lib/game-design-system/worker.ts`
- Test: `src/lib/gameDesignSystemGeneration.test.ts`
- Test: `src/lib/game-design-system/worker.test.ts`

**Interfaces:**
- Produce `GeneratedGameDesignSystem = { document: GameDesignDocument; rules: GameDesignRuleSet }`.
- Add `generateGameDesignSystemOutput(input, complete?)` and keep `generateGameDesignRuleSet` as a compatibility wrapper returning `.rules` for callers that still need only rules.
- Extend `ResolvedGameDesignGenerationInput` with optional `baseDocument`.

- [ ] **Step 1: Write failing generation tests.**

  Assert the system Prompt requires `document` and `rules`, includes all document field names, and still requires JSON-only output. Add a valid combined response fixture and assert both layers are returned. Add invalid-document coverage that triggers the existing one-shot repair path and a second-invalid response that throws `RuleSetGenerationValidationError`. Update the worker fixture so the generated output includes document and assert `createSystem` receives both.

- [ ] **Step 2: Run focused generation tests and verify the new assertions fail.**

  ```bash
  npx jest src/lib/gameDesignSystemGeneration.test.ts src/lib/game-design-system/worker.test.ts --runInBand
  ```

- [ ] **Step 3: Implement the combined output path.**

  Add the document example and contract instructions to `buildStructuredGenerationMessages`. Parse the response with `generatedGameDesignSystemSchema`, validate the combined size, and preserve the existing repair prompt with the full envelope. Update the worker to pass `generated.document` to `createGameDesignSystem` and use `generated.rules` for metadata fields.

- [ ] **Step 4: Run the focused tests and verify they pass.**

  Run the same Jest command. Expected: PASS.

- [ ] **Step 5: Commit the generation slice.**

  ```bash
  git add src/lib/gameDesignSystemGeneration.ts src/lib/game-design-system/worker.ts src/lib/gameDesignSystemGeneration.test.ts src/lib/game-design-system/worker.test.ts
  git commit -m "feat: generate design document with game rules"
  ```

### Task 3: Persist Document on Immutable Versions

**Files:**
- Create: `supabase/migrations/20260817130000_game_design_system_document.sql`
- Modify: `src/lib/services/gameDesignSystemService.ts`
- Modify: `src/app/api/game-design-systems/[id]/versions/route.ts`
- Test: `src/lib/services/gameDesignSystemService.test.ts`
- Test: `tests/unit/game-design-system-routes.test.ts`

**Interfaces:**
- Add nullable legacy-compatible `document jsonb` to `game_design_system_versions`; new versions always write a validated document.
- Extend `GameDesignSystemVersion` with `document: GameDesignDocument` after service-level compatibility hydration.
- Extend `createGameDesignSystemVersion` input with `document?: GameDesignDocument | null`.
- Extend version POST payload to accept `{ document, rules, parentVersionId }` and derive a compatibility document when omitted.

- [ ] **Step 1: Write failing service and route tests.**

  Assert the service RPC receives `p_document`, the rendered Markdown contains the document sections, and `content_hash` is calculated from both document and rules. Assert a version row with `document: null` is returned with a compatibility document. Assert the route rejects an invalid document and accepts a valid document plus rules.

- [ ] **Step 2: Run focused tests and verify they fail.**

  ```bash
  npx jest src/lib/services/gameDesignSystemService.test.ts tests/unit/game-design-system-routes.test.ts --runInBand
  ```

- [ ] **Step 3: Add the migration and service wiring.**

  Add the nullable column, replace the version RPC with a `p_document jsonb` argument, insert it atomically, and keep the existing version-number and generation-job idempotency logic. Update service selects, parsing, rendering, parent hydration, copy behavior, and content hashing. Use `buildCompatibilityGameDesignDocument` for old rows and omitted POST documents.

- [ ] **Step 4: Run focused tests and migration-aware route tests.**

  Run the same Jest command plus the existing game-design-system route suite. Expected: PASS.

- [ ] **Step 5: Commit the persistence slice.**

  ```bash
  git add supabase/migrations/20260817130000_game_design_system_document.sql src/lib/services/gameDesignSystemService.ts src/app/api/game-design-systems/[id]/versions/route.ts src/lib/services/gameDesignSystemService.test.ts tests/unit/game-design-system-routes.test.ts
  git commit -m "feat: persist game design documents with versions"
  ```

### Task 4: Make Overview the Human-Readable Workspace Entry

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Create: `src/components/game-design-system/GameDesignSystemDocumentEditor.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`
- Modify: `src/lib/services/gameDesignSystemClient.ts`
- Test: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`

**Interfaces:**
- `GameDesignSystemDocumentEditor` consumes `GameDesignDocument`, emits `onSave(document)` and `onCancel()`.
- `createGameDesignSystemVersion` sends `{ document, rules, parentVersionId }` while preserving the existing function call shape for rules-only callers.

- [ ] **Step 1: Write failing UI tests.**

  Assert a selected system opens with the `Overview` tab selected, displays the document heading and section copy, and does not show raw JSON. Assert the Rules tab still opens the rule editor. Assert an owner can edit document fields locally, review/save a new version, and the selected version updates.

- [ ] **Step 2: Run the page tests and verify the new assertions fail.**

  ```bash
  npx jest src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
  ```

- [ ] **Step 3: Implement the Overview document surface.**

  Change the workspace default state from `rules` to `overview`. Render the document as readable sections in Overview, including a visible “Design document” heading, design intent, player fantasy, loops, decisions, boundaries, progression, content, difficulty, and presentation. Add an owner-only edit mode using textareas and a review/save action that creates a new immutable version with the current rules and edited document. Keep the existing Rules editor and view tabs unchanged for non-owners and official systems.

- [ ] **Step 4: Add focused styling and client payload wiring.**

  Use the existing workspace typography, section-heading, and panel styles; add only document-specific prose, editor, and section spacing styles. Update the client version helper to include the document in the request body when provided.

- [ ] **Step 5: Run page tests and typecheck.**

  ```bash
  npx jest src/components/game-design-system/GameDesignSystemsPage.test.tsx --runInBand
  npx tsc --noEmit
  ```

  Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the workspace slice.**

  ```bash
  git add src/components/game-design-system/GameDesignSystemWorkspace.tsx src/components/game-design-system/GameDesignSystemDocumentEditor.tsx src/components/game-design-system/GameDesignSystemsPage.module.css src/lib/services/gameDesignSystemClient.ts src/components/game-design-system/GameDesignSystemsPage.test.tsx
  git commit -m "feat: show human-readable game design document first"
  ```

### Task 5: Version, Source, and End-to-End Regression Coverage

**Files:**
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Modify: `tests/unit/game-design-system-navigation.test.ts`
- Modify: `src/lib/game-design-system/sourceVisibility.server.ts` only if document redaction requires it

**Interfaces:**
- No new public interfaces. Tests consume the combined generation payload and version API from Tasks 2–4.

- [ ] **Step 1: Add creation-flow assertions.**

  Mock a completed job containing `document` and `rules`; assert completion selects the new system and the workspace opens on the readable Overview.

- [ ] **Step 2: Add Playwright coverage.**

  Extend the real-data flow to assert the generated document is visible before navigating to Rules, that Rules still supports Version 2 creation, and that the document remains readable at the mobile viewport without horizontal overflow.

- [ ] **Step 3: Run the scoped regression suite.**

  ```bash
  npx jest src/components/game-design-system src/lib/game-design-system src/lib/gameDesignSystemGeneration.test.ts src/lib/services/gameDesignSystemService.test.ts tests/unit/game-design-system-routes.test.ts --runInBand
  npx tsc --noEmit
  npx eslint src/components/game-design-system src/lib/game-design-system src/lib/gameDesignSystemGeneration.ts src/lib/services/gameDesignSystemService.ts src/app/api/game-design-systems --max-warnings=0
  npx playwright test tests/e2e/specs/game-design-system.spec.ts
  git diff --check
  ```

- [ ] **Step 4: Review generated output and migration state.**

  Verify a new generated version has non-empty document fields, readable `rendered_markdown`, valid rules, a stable combined hash, and unchanged project pinning. Verify an old rules-only version receives a compatibility document without mutating its immutable row.

- [ ] **Step 5: Commit the regression coverage.**

  ```bash
  git add src/components/game-design-system/GameDesignSystemCreatePage.test.tsx tests/e2e/specs/game-design-system.spec.ts tests/unit/game-design-system-navigation.test.ts src/lib/game-design-system/sourceVisibility.server.ts
  git commit -m "test: cover human-readable game design output"
  ```
