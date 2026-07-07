# Feature Specification: Abort the agent loop on client disconnect; lock down retry policy (issue #158)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft
**Input**: GitHub issue #158 — client disconnect doesn't abort the loop; llm-client retries non-retriable 4xx errors.

## Overview

Two problems in the agent streaming path:

1. **Disconnect leak.** `sseResponse`'s `ReadableStream` has only `start()` and no `cancel()` handler (`src/lib/agent/sse.ts:17-32`), and no `AbortSignal` is threaded from the route into `runAgentTurn` → `streamLlm` / tool execution. `llm-client` already accepts a `signal` (`src/lib/agent/llm-client.ts:30,66`) but nothing passes one. When the client disconnects, the loop keeps issuing LLM calls and tool writes to completion.

2. **Retry policy.** `llm-client` currently retries only `status >= 500 || status === 429` (`llm-client.ts:86`) — which is already correct in the current code. Rather than "fix" a bug that has since been narrowed, this spec **pins that policy with a tested predicate** so a future edit can't silently widen retries to non-retriable 4xx (400/401/403/422).

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Client disconnect aborts the run (Priority: P1)

**Root cause**: `sse.ts:17-32` has no `cancel()`; no `AbortSignal` reaches `streamLlm`/tools.

**Acceptance Scenarios**:
1. **Given** an in-flight agent turn, **When** the client disconnects (the stream is cancelled), **Then** an `AbortController` is aborted and no further LLM calls or tool executions start.
2. **Given** a normal completion, **When** the generator finishes, **Then** the stream closes exactly as today (no behavior change).

### Scenario 2 — Non-retriable errors are not retried (Priority: P2)

**Root cause**: retry gate lives inline (`llm-client.ts:86`); no test guards it against regressions.

**Acceptance Scenarios**:
1. **Given** an LLM response of 400/401/403/422, **When** the client handles it, **Then** it throws immediately without a retry.
2. **Given** 429 or 5xx or a network error, **When** it occurs on the first attempt, **Then** exactly one retry with backoff happens before failing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `sseResponse` MUST accept (or create and expose) an `AbortController` and implement `cancel()` on the `ReadableStream` to abort it when the consumer disconnects.
- **FR-002**: The route MUST thread that `AbortSignal` into `runAgentTurn`, and `runAgentTurn` MUST pass it to `streamLlm` (already supported) and check it before starting each iteration / tool execution.
- **FR-003**: When aborted, the loop MUST stop promptly and skip remaining LLM calls and tool executions; partial persisted state is acceptable (documented).
- **FR-004**: Extract the retry decision into a pure `isRetriableStatus(status: number): boolean` returning true only for `429` and `>= 500`, and use it in `llm-client`.

### Non-Functional Requirements

- **NFR-001**: No change to successful-path streaming output or event ordering.
- **NFR-002**: Abort must not surface a spurious client error bubble (consistent with the existing intentional-abort handling in `useAgentChat`).

## Success Criteria *(mandatory)*

- **SC-001**: Unit test: `isRetriableStatus` is false for 400/401/403/422 and true for 429/500/503.
- **SC-002**: Unit test: aborting the threaded signal prevents subsequent `streamLlm`/tool calls (e.g. via a fake that records calls).
- **SC-003**: Unit test: the ReadableStream `cancel()` aborts the controller.
- **SC-004**: CI (lint + unit + build) green; Playwright green.

## Out of Scope

- Server-side rollback of writes already applied before the abort.
- Rate-limit-aware adaptive backoff beyond the existing single retry.
