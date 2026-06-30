# Feature Specification: Bug Fix Batch — Studio & Simulation UX/Stability

**Feature Branch**: `002-bugfix-batch`
**Created**: 2026-06-30
**Status**: Draft
**Input**: User-reported bugs across keco-studio and keco-simulation:
1. Deleting a table in keco-studio redirects the user to the login page.
2. Import-script "View standard format" panel has broken visuals.
3. Switching the conversation while the agent is working fails the in-flight task with "signal is aborted without reason".
4. (keco-simulation) Configuring a skill without clicking "Add" before "Validate & apply" silently drops the configuration so the skill is never added.

## Overview

This batch fixes four independent defects. Each is a self-contained, reversible change with no shared blast radius. The work spans two apps: `keco-studio` (bugs 1–3) and `keco-simulation` (bug 4).

---

## User Scenarios & Testing *(mandatory)*

### Bug 1 — Deleting a table must not log the user out (Priority: P1)

As a signed-in user viewing a library (table), when I delete that library, I should be returned to the project page while remaining authenticated, not bounced to the login screen.

**Root cause**: `src/app/(dashboard)/[projectId]/[libraryId]/page.tsx` handles the `libraryDeleted` event with a full-page navigation `window.location.href = \`/${projectId}\``. A hard reload remounts `AuthProvider`, which starts with `isLoading=true / isAuthenticated=false` and re-derives the session from the tab-isolated hybrid storage adapter (sessionStorage + cookie). During that re-initialization window `DashboardLayout` renders `<AuthForm />` (the login screen). The redirect also discards the in-memory Supabase client and React Query cache. SPA navigation via the Next.js router avoids the remount entirely.

**Acceptance Scenarios**:
1. **Given** I am viewing a library I own, **When** I delete that library, **Then** I land on the project page and stay logged in (no login form flashes).
2. **Given** I delete a library I am NOT currently viewing, **When** the deletion completes, **Then** the sidebar updates and I remain on my current page, logged in.
3. **Given** deletion fails (e.g. permission error), **When** the error returns, **Then** I see an error message and am NOT navigated or logged out.

---

### Bug 2 — Import-script format guide renders cleanly (Priority: P2)

As a user importing a script, when I expand "View standard format", the guide should render inside the modal with a single, predictable scroll region and no clipped or overflowing content.

**Root cause**: In `ImportScriptModal.module.css`, `.modal` is `display:flex; flex-direction:column; overflow:hidden`, but `.content` (the scrollable middle region) lacks `flex: 1; min-height: 0`. The expandable `.formatGuideContent` carries its own `max-height: 280px; overflow-y: auto`, and `.textarea` also has a `max-height`. The result is nested scroll containers and content clipped by the modal's `overflow:hidden` when the guide is open, especially on shorter viewports.

**Acceptance Scenarios**:
1. **Given** the modal is open in text mode, **When** I click "View standard format", **Then** the guide expands and the modal body scrolls as one region without clipping the footer (Cancel/Import) buttons.
2. **Given** a short viewport, **When** the guide is expanded, **Then** all guide sections and tips are reachable by scrolling and nothing overflows the modal border.
3. **Given** the guide is collapsed again, **When** I view the textarea, **Then** layout returns to the prior compact state.

---

### Bug 3 — Switching conversations must not surface an abort error (Priority: P1)

As a user with the agent actively streaming, when I switch to another conversation (or start a new one), the previous stream should stop quietly. The newly selected conversation must load without an error bubble like "signal is aborted without reason".

**Root cause**: In `useAgentChat.ts`, `loadConversation` (line ~477) and `resetToEmpty` (line ~453) call `abortRef.current?.abort()` to cancel the in-flight request. The `fetch`/stream rejects with an `AbortError`, which is caught by the generic `catch` blocks in `send` (line ~442) and `confirm` (line ~459) and rendered as an `error` chat item via `appendItem`. Intentional aborts are being reported as failures.

**Acceptance Scenarios**:
1. **Given** the agent is streaming a response, **When** I click another conversation, **Then** the new conversation's history loads and NO error bubble appears.
2. **Given** the agent is streaming, **When** I start a new conversation, **Then** the chat clears with no error bubble.
3. **Given** a genuine network failure (not an abort), **When** it occurs, **Then** an error bubble still appears as before.

**Note (out of scope)**: The server (`sseResponse` in `sse.ts`) continues running the generator until completion; aborting the client fetch does not roll back already-applied writes. This fix only stops the spurious client-side error. Server-side cancellation/persistence is not changed.

---

### Bug 4 — Skill configuration is not silently dropped on apply (Priority: P1)

As a user configuring a skill in the battle simulator, when I have an in-progress skill configuration (bound attributes or selected ids) and click "Validate & apply", the app must not silently discard my work. It should either commit the in-progress configuration first, or clearly tell me to add it.

**Root cause**: The "Validate & apply" action (`BattleLocalTableSkillSourceModal.handleApply` → `panel.runValidate`) validates only the committed `drafts` array. Two creation flows hold work outside `drafts` until an explicit commit:
- **Create by attributes**: `pendingDraft` state, committed only by "Import all rows" (`confirmPendingCreate`).
- **Import by id**: `skillIdValues` selection inside `ImportSkillByIdBlock`, committed only by "Add skills" (`handleImportClick`).

If the user configures one of these and clicks "Validate & apply" (the prominent footer action) without first committing, their selection is ignored and nothing is added — perceived as "skill add failed".

**Acceptance Scenarios**:
1. **Given** I selected a table + id column + one or more skill ids in "Import by id" but have NOT clicked "Add skills", **When** I click "Validate & apply", **Then** the app either auto-commits the selection then validates, or blocks apply with a clear prompt to add first — it must NOT silently drop the selection.
2. **Given** I bound a Skill id column in "Create by attributes" but have NOT clicked "Import all rows", **When** I click "Validate & apply", **Then** the same protection applies.
3. **Given** I have committed drafts and no pending in-progress configuration, **When** I click "Validate & apply", **Then** behavior is unchanged (validate + apply committed drafts).
4. **Given** I am in a sub-view (createById / createAttributes) with no usable selection, **When** I attempt apply, **Then** I get actionable guidance rather than a no-op.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (Bug1): Library deletion navigation MUST use SPA routing (`router.push`) instead of `window.location.href`, preserving the authenticated session and in-memory caches.
- **FR-002** (Bug1): Navigation MUST only occur when the deleted library is the one currently being viewed; deletion failures MUST NOT navigate.
- **FR-003** (Bug2): The import-script modal body MUST be a single flex scroll region (`flex:1; min-height:0`) so expanding the format guide never clips the footer or overflows the modal.
- **FR-004** (Bug2): The format-guide content MUST NOT introduce a competing fixed-height inner scrollbar that conflicts with the modal body scroll (remove/relax the nested `max-height`+`overflow`).
- **FR-005** (Bug3): Intentional `AbortController.abort()` during conversation switch / new conversation / reset MUST NOT produce an error chat item. Abort errors MUST be swallowed silently in `send`, `confirm`, and stream consumption.
- **FR-006** (Bug3): Genuine (non-abort) errors MUST continue to surface as error chat items.
- **FR-007** (Bug4): "Validate & apply" MUST account for in-progress configuration in the active sub-view (pending attribute draft / selected import-by-id rows) by auto-committing it before validation, or by blocking with a clear message.
- **FR-008** (Bug4): When apply auto-commits, the user MUST see the same success feedback as an explicit add, and the committed skill(s) MUST be included in the validation/apply result.

### Non-Functional Requirements

- **NFR-001**: Each fix is isolated to its app and component; no cross-app behavior change.
- **NFR-002**: Existing passing tests MUST remain green; new behavior SHOULD be covered by unit tests where a test harness exists.

## Success Criteria *(mandatory)*

- **SC-001**: Deleting the currently-viewed library returns to the project page with no login-form flash and no re-authentication (Bug1).
- **SC-002**: Expanding "View standard format" shows the full guide with one scroll region and a visible footer at all supported viewport heights (Bug2).
- **SC-003**: Switching/starting conversations during streaming never shows "signal is aborted without reason" (Bug3).
- **SC-004**: Configuring a skill and clicking "Validate & apply" without a manual add never results in a silent no-op; the skill is added or the user is told how to proceed (Bug4).

## Out of Scope

- Server-side cancellation of agent turns when the client disconnects (Bug3).
- Redesign of the multi-step skill creation wizard beyond preventing the silent-drop (Bug4).
- Any change to authorization rules for deletion (Bug1).
