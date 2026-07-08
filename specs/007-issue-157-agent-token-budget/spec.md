# Feature Specification: Agent per-turn token/cost budget & context compaction (issue #157)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #157 — no token/cost budget enforcement; up to 50 full-context LLM calls per turn; design docs re-sent every iteration.

## Overview

The agent ReAct loop has no cost controls. `streamLlm` is called with only `{ tools }` and no `maxTokens` (`src/lib/agent/core.ts:283`). `MAX_ITERATIONS = 50` (`core.ts:60`) and confirmation resume restarts the loop with iteration `0` (`continueLoop(messages, ..., 0, trace)`, `core.ts:716`), so a single user turn can legally issue 50+ full-context completions. Uploaded design docs are embedded verbatim in the user message and, by design, re-sent on every iteration and every subsequent turn (`core.ts:598-604`); only tool content is compacted, user content never is. Token usage is recorded to traces (`core.ts:308`) but never enforced.

This spec adds a per-turn token budget (fail-soft), sets `maxTokens` on completions, compacts large user-message content after first use, and stops resetting the iteration counter on resume.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — A runaway turn stops with a clear message (Priority: P1)

**Root cause**: no budget check between iterations; usage tracked but not enforced (`core.ts:308`).

**Acceptance Scenarios**:
1. **Given** a turn whose cumulative token usage crosses the configured budget, **When** the loop is about to start another iteration, **Then** it stops and emits a user-visible message instead of continuing.
2. **Given** a normal short turn, **When** it runs, **Then** the budget never triggers and behavior is unchanged.

### Scenario 2 — Resume does not reset the iteration budget (Priority: P1)

**Root cause**: `core.ts:716` resumes with iteration count `0`, so an approve/reject after a long turn grants a fresh 50 iterations.

**Acceptance Scenarios**:
1. **Given** a turn that already ran N iterations before a confirmation pause, **When** the user approves and the loop resumes, **Then** the counter continues from N (does not reset to 0).

### Scenario 3 — Large design docs are not re-sent verbatim forever (Priority: P2)

**Root cause**: user content (incl. embedded design docs) is never compacted; re-sent every iteration/turn (`core.ts:598-604`).

**Acceptance Scenarios**:
1. **Given** a user message containing a large embedded document, **When** the loop iterates past the first use, **Then** subsequent iterations use a compacted/summarized form (or an artifact reference), not the full verbatim body.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Introduce a per-turn token budget constant and a pure helper (e.g. `isOverBudget(usedTokens, budget)`) enforced between iterations; on exceed, emit a fail-soft SSE message and end the turn.
- **FR-002**: Pass an explicit `maxTokens` to `streamLlm` on every completion.
- **FR-003**: Carry the iteration counter across confirmation resume — `continueLoop` on resume MUST start from the suspended count, not `0`.
- **FR-004**: After first inclusion, large user-message content MUST be compacted (summarized or replaced with a retrievable reference) so it is not re-sent verbatim on every iteration.
- **FR-005**: Budget/limit values MUST be centralized (single module) and unit-testable.

### Non-Functional Requirements

- **NFR-001**: Fail-soft only — a budget stop is a graceful message, never an unhandled throw.
- **NFR-002**: No change to the confirmation/auto-execute semantics from #144.

## Success Criteria *(mandatory)*

- **SC-001**: Unit test: the budget helper returns "stop" when over budget and "continue" under it.
- **SC-002**: Unit test: resume path preserves the iteration counter (no reset to 0).
- **SC-003**: Unit test: a completion request includes a `maxTokens`/`max_tokens` value.
- **SC-004**: Unit test: repeated iterations of a turn with a large doc do not re-embed the full body after first use.
- **SC-005**: CI (lint + unit + build) green; Playwright green.

## Out of Scope

- Dollar-cost accounting or provider billing integration.
- Streaming partial summaries of tool output beyond existing tool compaction.
- Changing `MAX_ITERATIONS` itself (kept; the fix is not resetting it and enforcing tokens).
