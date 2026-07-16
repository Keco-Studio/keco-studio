# Document Phase 2A and 2B Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every confirmed gap between the current Phase 2A/2B implementation and the updated realtime collaboration and version-history specifications.

**Architecture:** Preserve the existing `DocumentCollaborationSession` and `DocumentStateGateway` boundaries. Normalize Lexical awareness at the React boundary, serialize durable reload/reset work inside the session, apply same-epoch compacted snapshots before advancing tokens, and rebuild only the Realtime channel during transport recovery while retaining the active Y.Doc. Extend existing Jest and Playwright release gates around observable behavior.

**Tech Stack:** TypeScript, React 19, Next.js 16, Yjs, Lexical/MDXEditor, Supabase Realtime/Postgres, Jest, Playwright.

## Global Constraints

- Preserve the current dirty worktree and all Phase 2C-2F changes.
- Do not commit.
- Ordinary concurrent edits merge through Yjs; never restore Phase 1 autosave or stale-copy prompts.
- A provider or append failure keeps the editor read-only until durable recovery succeeds.
- A higher epoch replaces the Y.Doc exactly once; same-epoch revision catch-up applies the compacted snapshot before advancing the token.
- Viewer sessions receive updates but never publish awareness or durable updates.
- Existing database transaction and RLS contracts remain unchanged unless a failing acceptance test proves a defect.

---

### Task 1: Presence Identity and Avatar Stack

**Files:**
- Modify: `src/components/documents/useDocumentCollaboration.ts`
- Test: `tests/unit/documents/document-collaboration-wiring.test.ts`
- Test: `tests/e2e/specs/document-collaboration.spec.ts`

**Interfaces:**
- Consumes: Lexical awareness state `{ name, color, focusing, awarenessData: { userId } }`.
- Produces: `getDocumentCollaborators(states, localUserId)` returning deduplicated remote `{ id, name, color }` entries.

- [x] Add a failing unit test proving top-level Lexical awareness fields produce one remote collaborator, exclude the local user, and reject incomplete states.
- [x] Run `npm run test:unit -- --runInBand tests/unit/documents/document-collaboration-wiring.test.ts` and confirm the new test fails because `state.user` is absent.
- [x] Extract the pure collaborator mapper and make the hook consume the real Lexical awareness shape.
- [x] Rerun the focused unit test and confirm it passes.
- [x] Extend collaboration Playwright coverage to assert the header avatar/name tooltip appears for the other editor.

### Task 2: Durable Snapshot Catch-up and Exactly-once Reset

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Test: `tests/unit/documents/document-collaboration-session.test.ts`

**Interfaces:**
- Produces: serialized `reloadDurableState(minimumToken?)` behavior shared by reset, heartbeat, focus, reconnect, and restore conflict recovery.

- [x] Add a failing test where a missed update has been compacted into a same-epoch higher-revision snapshot with an empty tail; assert the current Y.Doc receives it before the token advances.
- [x] Add a failing test that emits two concurrent higher-epoch reset signals while the durable read is pending; assert immediate read-only hydration state, one database read, one Y.Doc replacement, and one reload notification.
- [x] Add a failing test proving a valid reset whose durable read rejects enters `degraded` instead of being swallowed as a malformed signal.
- [x] Run the three focused tests and verify RED for the intended causes.
- [x] Serialize reloads with one in-flight promise and a queued rerun marker; parse reset payloads separately from durable read errors.
- [x] Apply a changed same-epoch snapshot with remote origin before missing tail rows and only then advance `currentToken`.
- [x] Freeze higher-epoch resets immediately and replace the active document once after the authoritative read succeeds.
- [x] Rerun the collaboration session suite and confirm GREEN.

### Task 3: Realtime Failure, Automatic Reconnect, and Manual Retry

**Files:**
- Modify: `src/lib/documents/documentCollaborationSession.ts`
- Test: `tests/unit/documents/document-collaboration-session.test.ts`

**Interfaces:**
- Produces: channel-only reconnect that reuses the active Y.Doc/Awareness, refreshes auth, resubscribes privately, performs durable catch-up, and resumes ready state.

- [x] Extend the fake channel harness to create distinct channel instances and emit subscription status after initial readiness.
- [x] Add a failing test proving a post-ready `CHANNEL_ERROR` immediately freezes editing and schedules reconnect.
- [x] Add a failing test proving reconnect removes the failed channel, creates one replacement channel, reloads durable state, retains the same Y.Doc, and returns to ready.
- [x] Add a failing test proving automatic retries stop after five failed attempts while manual Retry can start a fresh attempt.
- [x] Run the focused tests and verify RED.
- [x] Keep the subscription callback active after initial subscribe, route late failures into a bounded jittered backoff state machine, and ignore callbacks from stale channels.
- [x] Make `retry()` rebuild the channel when transport is unavailable and retain append-only retry behavior when the channel is healthy.
- [x] Clear reconnect timers/promises during destroy and rerun the full session suite.

### Task 4: Version Service and Restore Modal Contract

**Files:**
- Modify: `src/lib/documents/documentVersionService.ts`
- Modify: `src/components/documents/RestoreDocumentVersionModal.tsx`
- Test: `tests/unit/documents/document-version-service.test.ts`
- Test: `tests/unit/documents/document-version-ui-wiring.test.ts`

**Interfaces:**
- Produces: hidden/missing history lists mapped to `DocumentAccessError`; restore modal cannot close or cancel during the committed restore operation.

- [x] Add a failing service test where the metadata list is empty and the document access probe is hidden; assert `DocumentAccessError`.
- [x] Add a failing UI wiring assertion for disabled cancel/close while `submitting`.
- [x] Run both focused suites and verify RED.
- [x] Use a metadata-only document existence/access probe only when the version list is empty, then map hidden/missing access to `DocumentAccessError`.
- [x] Set modal cancel controls and close behavior to disabled while restoring; preserve inline failure recovery.
- [x] Rerun both focused suites and confirm GREEN.

### Task 5: Phase 2A and 2B Release Gates

**Files:**
- Modify: `tests/e2e/specs/document-collaboration.spec.ts`
- Modify: `tests/e2e/specs/document-version-history.spec.ts`
- Modify only implementation defects proven by these gates.

**Interfaces:**
- Verifies: structural node collaboration, overlapping edits, cursor/avatar presence, durable navigation, concurrent pre-restore edits, audit history, old-epoch rejection, and exactly-once client rehydrate.

- [x] Extend the collaboration browser fixture with heading, list, quote, link, image, table, and code-block content, then edit representative nodes from two contexts and assert convergence after reload.
- [x] Add overlapping/same-location edits and adjacent cursor movement assertions.
- [x] Intercept append during navigation and prove navigation waits for durability.
- [x] In version history, make newer edits from both editor contexts before restore.
- [x] Count editor epoch/editor-root replacement signals and assert one rehydrate per restored epoch.
- [x] Assert `Before restore` and `Restored:` audit rows appear.
- [x] Capture the old epoch, attempt an old-epoch append after restore, assert conflict, and prove restored content remains after reload.
- [x] Run focused Playwright specs against the configured local environment.

### Task 6: Full Verification and Review

**Files:**
- Modify only defects found by verification or review.

- [x] Run focused 2A/2B Jest suites.
- [x] Run live RLS behavior tests with `RLS_DB_TESTS=1` when local Supabase is available.
- [x] Run `npm run lint`.
- [x] Run `npm run typecheck` and `npm run typecheck:api`.
- [x] Run `npm run test:unit -- --runInBand`.
- [x] Run `npm run build`.
- [x] Run the collaboration and version-history Playwright specs.
- [x] Run `git diff --check` and inspect `git status --short` without committing.
- [x] Request an independent spec and code-quality review; resolve every Critical or Important finding.
