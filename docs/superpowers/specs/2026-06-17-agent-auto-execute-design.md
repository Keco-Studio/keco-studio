# Agent Auto-Execute (Disable Confirmations) Design Spec

**Date:** 2026-06-17  
**Status:** Draft  
**Scope:** Disable confirmations for all Agent write operations by default; write tools execute consecutively within a single SSE stream; keep an optional "Confirm mode" that can be enabled when needed  
**Related:** [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md), [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md)

---

## 1. Overview

### 1.1 Problem

Currently, for every write tool the Agent pauses the ReAct loop, closes the SSE, waits for the user to click Confirm, then resumes via `/api/agent-chat/confirm`. During batch data processing (many-row `update_row`, repeated `create_asset`, cross-library `set_reference`, etc.), the number of confirmations and SSE round-trips grows linearly, making for a terrible experience.

The existing `skipConfirmation` covers only `pre_execute` tools, and can only be enabled by having the LLM call `set_conversation_option` (which itself requires a meta confirmation) — a hidden entry point with insufficient coverage.

### 1.2 Decision

**Adopt "fully automatic execution" by default**: all write tools (including two-phase `post_preview` tools) complete directly within the single SSE stream triggered by a user message, with no confirmation cards.

The risk model the user accepts: **if something goes wrong, hit F5** — meaning primarily **discarding changes that have not yet happened** (an in-progress SSE, tools not yet executed, pending actions awaiting Confirm in Confirm mode), not "one-click undo of data already written". Operations already written to Supabase still cannot be rolled back via F5 (see §6).

### 1.3 Goals

| Goal | Description |
|------|------|
| **G1** | Default `autoExecute: true`; new conversations work out of the box with no confirmation cards |
| **G2** | `post_preview` tools in auto mode: after `execute()` succeeds, immediately `executeImport()`, no pause |
| **G3** | Multiple write tools within a single user turn execute consecutively, SSE uninterrupted |
| **G4** | ChatPanel provides a visible toggle to switch back to "Confirm mode" |
| **G5** | Permission layer unchanged: Viewer still cannot write; the confirmation layer and permission layer are independent |

### 1.4 Non-Goals

- No undo / version rollback / soft-delete recovery
- No batch tool aggregation (`batch_update_rows` etc.) — this spec only changes the confirmation policy
- No changes to tool schemas or business rules in the LLM prompt (field parsing, rowIndex, etc.)
- Do not remove the `agent_pending_actions` table or the `/confirm` route — Confirm mode still needs them

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **autoExecute** | Conversation-level switch: `true` = skip all confirmations and execute write operations directly |
| **requireConfirmation** | Alias for `autoExecute === false`, keeping the existing three `confirmationMode` flows |
| **pre_execute** | Confirm-before-write mode (create/update/delete etc.) |
| **post_preview** | Preview first, then confirm the write (import_script, update_row, setup_library, set_reference) |
| **meta** | The option change itself requires confirmation (`set_conversation_option`, see §5.4) |

---

## 3. Behavior Specification

### 3.1 Default

**All conversations default to Auto** (new conversations + loaded historical conversations):

- **New conversations**: write `meta.autoExecute = true` on creation (or initialize from the user preference, whose default is also `true`)
- **Historical conversations**: when reading meta, if `autoExecute` is absent and legacy `skipConfirmation` is not enabled either, **resolve as `true`** (see §4.1 `resolveConversationMeta`)
- **New user's global preference** (localStorage): absent means `autoExecute: true`
- ChatPanel header shows the state: `Auto` (default) / `Confirm` (when the user manually enables confirmations)

### 3.2 ReAct loop — `needsConfirmation`

```typescript
function needsConfirmation(tool: AgentTool, meta: ConversationMeta): boolean {
  if (tool.category === 'read') return false;
  if (meta.autoExecute === true) return false; // NEW: supersedes all modes
  // Existing logic below unchanged for requireConfirmation mode:
  if (tool.confirmationMode === 'post_preview' || tool.confirmationMode === 'meta') return true;
  if (tool.confirmationMode === 'pre_execute' && meta.skipConfirmation) return false;
  return true;
}
```

**Meta resolution (single entry point `resolveConversationMeta`):**

```typescript
function resolveConversationMeta(raw: ConversationMeta | null | undefined): ConversationMeta {
  if (raw?.autoExecute === false) return { autoExecute: false };
  if (raw?.autoExecute === true || raw?.skipConfirmation === true) return { autoExecute: true };
  return { autoExecute: true }; // default: all conversations Auto
}
```

Writes consistently use `autoExecute`; `skipConfirmation` is no longer written.

### 3.3 Auto-execute path per confirmation mode

When `needsConfirmation === false` and the tool is a write:

#### A. `pre_execute` / `meta`

Same as the existing no-confirmation branch: directly `tool.execute()` → `tool_result` SSE → persist → continue the loop.

#### B. `post_preview` (**the core new logic of this spec**)

The current no-confirmation branch **only calls `execute()` and never calls `executeImport()`**, so preview tools under the legacy `skipConfirmation` never actually wrote to the DB. Auto mode must complete this:

```
1. yield tool_call_start
2. result = await tool.execute(params, ctx)     // preview phase
3. if !result.success → tool_result (failure) → continue loop
4. if !tool.executeImport → treat as single-phase; tool_result → continue
5. importResult = await tool.executeImport(result, params, ctx)
6. yield tool_call_end
7. yield tool_result (importResult data + displayHint from preview or import)
8. cache_invalidated if needed
9. persist assistant + tool messages → continue loop (NO return)
```

**SSE events:** in auto mode the preview phase's `tool_result` is still sent (the user can see the change summary in the stream), but no `confirmation_request` is sent.

**Trace:** record `phase: 'execute'` and `phase: 'executeImport'` separately (consistent with the confirm-resume path).

### 3.4 Require-confirmation path (`autoExecute: false`)

Existing behavior fully preserved:

- `pre_execute` / `meta`: pause → `confirmation_request` → `/confirm` → resume
- `post_preview`: preview → `confirmation_request` → `/confirm` → `executeImport`
- Frontend `ConfirmationCard` / `ScriptPreviewCard` / `SkillPreviewCard` render as usual

### 3.5 Multi-tool turns

If the user sends one message in auto mode and the Agent calls N write tools consecutively:

- All execute sequentially within the **same SSE connection**
- Each step pushes `tool_call_start` → `tool_result` (and `cache_invalidated`)
- `done` / `error` is pushed only when the whole turn finishes or fails
- **No longer** `return` and close the SSE because of an intermediate write

---

## 4. Data Model

### 4.1 `ConversationMeta` (`agent_conversations.meta` jsonb)

```typescript
interface ConversationMeta {
  /** Default true for new conversations. When true, all write tools skip confirmation. */
  autoExecute?: boolean;

  /** @deprecated Read as autoExecute=true if set. Do not write on new saves. */
  skipConfirmation?: boolean;
}
```

| Field | Default | Scope |
|-------|---------|-------|
| `autoExecute` | **`true` (absent means true)** | Per conversation; historical conversations also default to true when loaded |
| `skipConfirmation` | — | Legacy only; read → `autoExecute: true` if set |

**Resolved default:** only when the user explicitly switches to Confirm (`autoExecute: false` written to the DB) does that conversation go through the confirmation flow.

### 4.2 User preference (localStorage)

| Key | Value | Purpose |
|-----|-------|---------|
| `keco:agent:auto-execute:{userId}` | `"true"` \| `"false"` | Default for **new** conversations when user clicks "New" |

Rules:

- When creating a new conversation: meta is initialized from the user preference (preference default = `true`)
- When the user flips the toggle in ChatPanel: update the current conversation's meta **and** update the user preference
- When loading a historical conversation: resolved via `resolveConversationMeta`; **any conversation not explicitly set to false is Auto**

### 4.3 Unchanged tables

`agent_pending_actions` is used only when `autoExecute: false`; auto mode should add no new pending rows.

---

## 5. API & Frontend

### 5.1 PATCH conversation meta (new)

```
PATCH /api/agent-chat/conversations/:id/meta
Body: { autoExecute: boolean }
Auth: same as agent-chat
Response: { meta: ConversationMeta }
```

Used by the ChatPanel toggle to write directly to the DB, **bypassing** the LLM's `set_conversation_option`.

### 5.2 Existing routes

| Route | Change |
|-------|--------|
| `POST /api/agent-chat` | Pass `conversationMeta.autoExecute` into `runAgentTurn` |
| `POST /api/agent-chat/confirm` | No change; used only in requireConfirmation mode |
| Conversation create | Initialize `meta: { autoExecute: <userPref> }` |

### 5.3 ChatPanel UI

**Add a toggle to the header:**

```
[ Auto ▼ ]  or  [ Confirm ▼ ]
```

- **Auto** (default): `autoExecute: true`, tooltip: `Write tools run immediately. Refresh (F5) to discard in-progress work or fix a stale UI—not to undo saved changes.`
- **Confirm**: `autoExecute: false`, restores the existing confirmation card flow

On toggle:

1. If `isStreaming` is active, disable the toggle
2. Call the PATCH meta API
3. Update the localStorage user preference
4. Optional: append a system note to the chat area (non-LLM message): `Mode: Auto — confirmations disabled for this conversation.`

**Confirm-mode UI preserved:** `ConfirmationCard`, `ScriptPreviewCard`, etc. are not removed; no `confirmation_request` events are received in auto mode.

### 5.4 `set_conversation_option` tool

| Option | Auto mode | Confirm mode |
|--------|-----------|--------------|
| Deprecate `skipConfirmation` | Ignore or map to `autoExecute` | Same mapping |

**Recommendation:** keep the tool but change it to set `autoExecute`; in auto mode the **meta confirmation is also skipped** (consistent with "all confirmations off"). If `autoExecute: false`, changing the option still goes through meta confirmation.

Update RULE 7 in `prompts.ts`:

- Remove the "have the user say skip confirmation, then call the tool" flow
- Change to: "The user can toggle Auto/Confirm in the ChatPanel; default is Auto"

---

## 6. Limitations & User Expectations

### 6.1 Intended use of F5 (product consensus)

User mental model: **F5 = discard what isn't finished yet**, not undo completed writes.

| Scenario | F5 effect |
|------|---------|
| Agent is streaming a reply / mid-tool execution | **Can interrupt**: discards this turn's unfinished SSE and tools not yet executed |
| Pending action awaiting Confirm in Confirm mode | **Can discard**: after refresh the pending expires; that step is not written |
| UI/cache inconsistent with the DB | **Can fix**: refreshes the UI; successful writes still go through `cache_invalidated` + `router.refresh()` |
| Data **already** successfully written to Supabase | **Cannot undo**; F5 does not roll back the DB |

### 6.2 Other boundaries

| Scenario | Description |
|------|------|
| Interrupted SSE | Executed tools are already persisted; queued unexecuted tools will not run |
| Accidental delete | In auto mode, deletes take effect immediately; no soft-delete |
| Step-by-step confirmation needed | Manually switch the ChatPanel to **Confirm** |

Product stance: **speed first**; use F5 to cut losses on "changes that haven't happened yet"; errors already persisted require manual data fixes or Confirm mode as a safeguard.

---

## 7. Affected Tools

### 7.1 Write tools — auto mode executes immediately

| Tool | Mode | Auto behavior |
|------|------|---------------|
| `create_asset` | pre_execute | execute |
| `update_asset` | pre_execute | execute |
| `delete_asset` | pre_execute | execute |
| `add_field` | pre_execute | execute |
| `create_library` | pre_execute | execute |
| `create_folder` | pre_execute | execute |
| `delete_library` | pre_execute | execute |
| `rename_library` | pre_execute | execute |
| `import_script` | post_preview | execute → executeImport |
| `update_row` | post_preview | execute → executeImport |
| `setup_library` | post_preview | execute → executeImport |
| `set_reference` | post_preview | execute → executeImport |
| `set_conversation_option` | meta | execute (no meta confirm when auto) |

Read tools: unchanged.

---

## 8. Implementation Plan (high level)

### Phase 1 — Core loop

1. Extend `ConversationMeta` with `autoExecute`; migration helper for `skipConfirmation`
2. Update `needsConfirmation()` in `core.ts`
3. Add `executePostPreviewTool()` helper: execute + executeImport in one path
4. Wire auto path for post_preview (fix skipConfirmation gap)
5. Unit tests: `needsConfirmation`, post_preview auto path, legacy meta migration

### Phase 2 — API & persistence

1. PATCH meta endpoint
2. New conversation defaults from user preference
3. Agent-chat route passes updated meta

### Phase 3 — Frontend

1. ChatPanel Auto/Confirm toggle
2. localStorage user preference
3. Remove reliance on LLM for mode switching; update empty-state copy

### Phase 4 — Cleanup

1. Deprecate `skipConfirmation` in types/docs/skills
2. Update `prompts.ts` rule 7
3. Update `.claude/skills/debug-agent.md`

---

## 9. Testing

### 9.1 Unit (`tests/unit/agent/`)

| Case | Expect |
|------|--------|
| `autoExecute: true` + `create_asset` | No confirmation; execute once |
| `autoExecute: true` + `update_row` | execute + executeImport; no pending action |
| `autoExecute: false` + `update_row` | confirmation_request; pending action saved |
| Legacy `{ skipConfirmation: true }` | Treated as autoExecute |
| `autoExecute: true` + failed preview | No executeImport; error tool_result |

### 9.2 E2E (optional, headed)

1. Auto mode: send "create asset X" → no Confirm button → data appears in the library
2. Toggle Confirm → create in the same conversation → Confirm card appears
3. Auto mode: two consecutive write instructions → multiple tool_results within a single SSE

### 9.3 Manual

- Viewer role: write tools still return a permission error (independent of confirmation)
- import_script with large text: long single SSE in auto mode (note the `maxDuration` 60s limit is unchanged)

---

## 10. Rollout

| Step | Action |
|------|--------|
| 1 | Ship with **`resolveConversationMeta` defaulting to true** (new + historical conversations) |
| 2 | Only conversations with `meta.autoExecute === false` keep Confirm behavior |
| 3 | Announce in release notes: "Agent conversations default to Auto; use F5 to discard in-progress operations; switch to Confirm when confirmation is needed" |

**Product decision (locked):** no conservative feature-flag period; **all conversations default to Auto**, consistent with the user's "all confirmations off + F5 discards unfinished changes" model.

---

## 11. Open Questions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Should old conversations default to auto? | **Locked: Yes** — all conversations default to Auto via `resolveConversationMeta` |
| Q2 | Should delete still require confirmation under auto? | **Locked: No** — just switch to Confirm mode |
| Q3 | Keep ScriptPreviewCard as read-only display? | **Yes** — displayed via in-stream tool_result, no buttons |
| Q4 | F5 semantics | **Locked** — discard unfinished changes / fix UI; does not undo persisted data |
| Q5 | `maxDuration` timeout for batch writes | Out of scope |

---

## 12. Success Criteria

- [ ] New and historical conversations (not explicitly Confirm) show no confirmation cards by default; 10 consecutive `update_row` calls require no Confirm clicks
- [ ] `post_preview` tools actually write to the DB in auto mode (not preview only)
- [ ] Confirm mode behaves identically to production (regression)
- [ ] The ChatPanel toggle persists to the conversation + user preference
- [ ] Docs and prompt no longer instruct users to "say skip confirmation"
