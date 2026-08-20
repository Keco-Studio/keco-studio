# GDD Dialogue Snapshot Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** After a GDD-derived dialogue conversion succeeds, update the source GDD chapter with an idempotent dialogue summary and branch-tree snapshot linking to the Dialogue Document and Script FlowChart.

**Architecture:** Add a pure snapshot renderer that consumes the resolved `StoryDocument`, optional `StoryPlotPlan`, and conversion IDs. Add a server-side document replacement function that locates a chapter by key/title and performs one CAS Markdown replacement. Invoke it from `dialogueWorker.ts` after fresh import and existing-Script recovery; snapshot failures are warnings and never roll back completed Script persistence.

**Tech Stack:** TypeScript, Zod story IR/plot types, Jest, Supabase document CAS RPC, Markdown markers.

---

### Task 1: Define snapshot rendering contract and tests

**Files:**
- Create: `src/lib/gdd-generation/dialogueSnapshots.ts`
- Test: `src/lib/gdd-generation/dialogueSnapshots.test.ts`

- [ ] **Step 1: Write failing renderer tests** for dialogue excerpts, bounded/escaped text, choice summaries, deterministic tree output, linear scenes, stable marker metadata, and both named links.
- [ ] **Step 2: Run `npx jest src/lib/gdd-generation/dialogueSnapshots.test.ts --runInBand`** and verify the new tests fail because the renderer is absent.
- [ ] **Step 3: Implement pure functions** `renderDialogueSnapshot(input)`, `renderStoryBranchTree(document, plotPlan)`, and `escapeSnapshotText(text)` with a typed input containing `dialogueJobId`, `chapterKey`, `title`, `projectId`, `dialogueDocumentId`, `scriptLibraryId`, `document`, and optional `plotPlan`. Limit excerpt lines and branch depth/count; omit choice sections for genuinely linear documents.
- [ ] **Step 4: Re-run the focused Jest file** and verify all renderer assertions pass.

### Task 2: Add idempotent GDD chapter replacement

**Files:**
- Modify: `src/lib/documents/serverDocumentReplacement.ts`
- Test: `src/lib/documents/serverDocumentReplacement.test.ts`

- [ ] **Step 1: Add failing tests** for exact `chapterKey` matching, title fallback, replacement of an existing `dialogueJobId` block without duplicates, preservation of unrelated chapters/content, partial marker handling, and missing chapter returning a structured non-throwing result.
- [ ] **Step 2: Run `npx jest src/lib/documents/serverDocumentReplacement.test.ts --runInBand`** and confirm failures.
- [ ] **Step 3: Implement `replaceGddDialogueSnapshot(serviceClient, input)`**. Read the document through `documentStateGateway`, verify project ownership and collaborative state, locate a chapter heading/marker by key then normalized title, remove any complete prior snapshot block for the job, insert the newly rendered Markdown at the chapter end, and persist with the existing `replace_document_with_markdown` CAS payload. Return `{ updated: boolean; reason?: 'missing-chapter' | 'missing-state' }` and preserve unrelated content.
- [ ] **Step 4: Re-run the replacement test file** and verify all cases pass, including PT409 propagation.

### Task 3: Wire snapshot synchronization into the dialogue worker

**Files:**
- Modify: `src/lib/gdd-generation/dialogueWorker.ts`
- Modify: `src/lib/gdd-generation/dialogueWorker.test.ts`

- [ ] **Step 1: Extend dependency tests** to assert snapshot synchronization receives resolved story data, plot plan, source GDD document ID, chapter metadata, and imported/recovered library IDs on both paths.
- [ ] **Step 2: Run the focused worker tests** and verify the new expectations fail.
- [ ] **Step 3: Add an injectable `updateSnapshot` dependency** backed by `replaceGddDialogueSnapshot`. Resolve the source GDD owner/output document metadata once, call snapshot update after `complete` for existing Script recovery and after fresh import/reference update, and catch/log snapshot errors without changing the completed status. Pass the resolved document and plot plan from `resolve` to the snapshot renderer.
- [ ] **Step 4: Re-run `npx jest src/lib/gdd-generation/dialogueWorker.test.ts --runInBand`** and verify completion, retry, and failure behavior remains green.

### Task 4: Add integration coverage and verify the full affected surface

**Files:**
- Modify: `src/lib/gdd-generation/dialogueResources.test.ts` (only if link/path assertions need alignment)
- Create or modify: `tests/unit/gdd-dialogue-snapshot-integration.test.ts`

- [ ] **Step 1: Write an integration-style test** that feeds a generated scene plus resolved branch graph through the worker boundary and asserts the persisted GDD Markdown contains one dialogue snapshot, one branch tree, and links to the expected Dialogue Document and Script FlowChart URLs.
- [ ] **Step 2: Run focused suites:** `npx jest src/lib/gdd-generation/dialogueSnapshots.test.ts src/lib/documents/serverDocumentReplacement.test.ts src/lib/gdd-generation/dialogueWorker.test.ts tests/unit/gdd-dialogue-snapshot-integration.test.ts --runInBand`.
- [ ] **Step 3: Run `npm run typecheck`, targeted ESLint for changed files, and `git diff --check`**; fix only issues caused by this feature.
- [ ] **Step 4: Run the broader GDD/dialogue Jest subset and record any unrelated pre-existing failures separately.**

### Task 5: Review and hand off

- [ ] **Step 1: Inspect the final diff** to ensure only snapshot files and directly related tests changed beyond the user’s existing worktree edits.
- [ ] **Step 2: Verify no duplicate snapshot markers are emitted for retries and that snapshot failures cannot transition a completed Script job to failed.**
- [ ] **Step 3: Report the implementation, focused test results, and any unrelated test gap with links to the changed files.**

