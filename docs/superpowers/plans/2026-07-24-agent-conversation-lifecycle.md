# Agent Conversation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Agent execution and input lock state independently for every conversation while users switch conversations or projects.

**Architecture:** Add a client-side runtime registry keyed by conversation and selected per project. Refactor `useAgentChat` so every request captures its originating runtime key and every SSE event updates that runtime only; navigation changes selection without cancellation.

**Tech Stack:** React 19, TypeScript, Jest, Next.js App Router

---

### Task 1: Conversation Runtime Registry

**Files:**
- Create: `src/components/agent/agentChatRuntimeStore.ts`
- Test: `tests/unit/agent/conversation-runtime-store.test.ts`

- [ ] Write tests proving project selections and streaming flags are isolated.
- [ ] Run `npm run test:unit -- tests/unit/agent/conversation-runtime-store.test.ts --runInBand` and confirm it fails because the registry is missing.
- [ ] Implement runtime creation, update, project selection, subscription, and conversation binding.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Conversation-Scoped Streaming

**Files:**
- Modify: `src/components/agent/useAgentChat.ts`
- Test: `tests/unit/agent/conversation-runtime-store.test.ts`

- [ ] Replace hook-local message and stream ownership with the selected runtime snapshot.
- [ ] Capture a runtime key for `send` and `confirm`, and route all events and errors to that key.
- [ ] Remove navigation-triggered aborts from reset and history loading.
- [ ] Preserve each project's selected runtime during project changes.
- [ ] Run the Agent unit tests and TypeScript checks.

### Task 3: Regression Verification

**Files:**
- Verify: `src/components/agent/ChatPanel.tsx`
- Verify: `src/components/agent/ChatInput.tsx`

- [ ] Confirm panel close and navigation do not cancel runtime work.
- [ ] Confirm returning to a running conversation passes `isStreaming=true` to `ChatInput`.
- [ ] Run focused Agent tests, `npm run typecheck`, and ESLint on changed files.
