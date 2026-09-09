# GDS Refresh Recovery and Translation Isolation Implementation Plan

> **For agentic workers:** Implement task-by-task and request a review after the complete diff.

**Goal:** Preserve Game Design System creation state across refreshes and isolate editable document/library surfaces from browser translation mutations.

**Architecture:** A versioned, owner-scoped `sessionStorage` helper stores raw form state plus submitted/retry request metadata. The creation page hydrates once after auth readiness, resumes jobs or replays idempotent requests, and clears records only on terminal success or abandonment. Editable DOM boundaries receive `translate="no"`, while cell editing rejects external DOM changes that did not produce an input event.

**Tech Stack:** Next.js React, TypeScript, React Testing Library, Jest, Playwright, sessionStorage.

## Global Constraints

- Recovery records expire after 24 hours and are limited to 256 KiB UTF-8.
- Recovery is scoped to the authenticated `ownerId`; no credentials or server-resolved snapshots are stored.
- No Supabase migration changes.
- Newly tracked files contain no literal Chinese characters.
- Do not use TDD; add focused regression coverage after implementation.

### Task 1: Recovery Storage Module

**Files:** Create `src/lib/game-design-system/generationRecovery.ts`; test `src/lib/game-design-system/generationRecovery.test.ts`.

- Define versioned `GdsGenerationRecoveryRecord` with raw form, normalized request, owner, submit/retry keys, job id, and timestamp.
- Implement safe read/write/clear using UTF-8 byte size, TTL, timestamp, schema, and owner validation. Preserve records for transient errors; clear only invalid records.
- Cover malformed, stale, future timestamp, oversized, user mismatch, and round-trip cases.

### Task 2: Creation Page Recovery

**Files:** Modify `src/components/game-design-system/GameDesignSystemCreatePage.tsx`; test `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`.

- Serialize every raw form field and stage into the recovery record after edits, gated by authenticated profile readiness.
- Hydrate once per owner, restore draft fields/stage, fetch submitted jobs, replay pending initial POSTs with the same key, and resume polling.
- Persist retry key and parent job before retry; promote returned replacement job and clear retry metadata.
- Clear on completion/abandonment, retain failed jobs, and avoid duplicate Strict Mode requests.

### Task 3: Idempotency Lookup Ordering

**Files:** Modify `src/app/api/game-design-systems/generation-jobs/route.ts`; test the existing generation route/service suite.

- Add an owner-scoped lookup by idempotency key before source/base resolution.
- Return the existing job when the key and stored request hash match; return conflict for a mismatched payload.
- Keep normal source snapshot resolution and insertion behavior unchanged for new keys.

### Task 4: Translation Isolation

**Files:** Modify `src/components/documents/MdxDocumentEditor.tsx`, `src/components/libraries/components/CellEditor.tsx`, `src/components/libraries/components/AddNewRowForm.tsx`, `src/app/layout.tsx`; add focused DOM tests alongside existing suites.

- Mark editor frames, contenteditable cells, and add-row text inputs with `translate="no"`; retain document-level `notranslate` metadata.
- Track the last value produced by an input event in `CellEditor`; on blur, do not save externally mutated DOM content.
- Assert DOM attributes and synthetic external mutation behavior without relying on nondeterministic Chrome translation automation.

### Task 5: Verification and Review

- Run focused Jest and Playwright suites, `npm run typecheck`, `npm run lint`, `npm run build`, and the Chinese-character gate.
- Dispatch a child-agent review of the complete diff, fix all Critical/Important findings, rerun affected checks, then create and monitor the PR.
