# Agent Chat Persistence & History Design Spec

**Date:** 2026-06-12  
**Status:** Draft  
**Scope:** ChatPanel input draft persistence, per-project active conversation restoration, cross-project History list (with project names), full display of historical messages  
**Related:** [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

When a user opens the bottom-right **Keco Assistant** (`ChatPanel`) inside any Dashboard project, the current implementation has three classes of experience gaps:

| Gap | Current state | Target |
|------|------|------|
| Input draft | `ChatInput` uses component-local `useState`; lost on project switch/refresh | **Globally shared** draft, visible across projects, preserved after refresh |
| Active conversation | `useAgentChat` is in-memory only; switching `projectId` doesn't switch the conversation | Remember and restore the last active conversation and message list **per project** |
| History | `ConversationList` only queries the current `projectId` | List **all** of the user's historical conversations and show the **owning project name** |

**Design principles:**

- **Sent messages**: the DB is the single source of truth (`agent_conversations` + `agent_messages`), consistent with the existing Agent Core.
- **Unsent drafts**: stored only in browser `localStorage`, never in the DB.
- **Conversation ownership**: each conversation stays bound to its creation-time `project_id` (LLM context and permissions unchanged); History merely stops filtering by the current project **for display**.
- **Minimal backend changes**: extend the list API; the message-loading API is unchanged.

---

## 2. Data Model

### 2.1 Database tables

#### `agent_conversations` — conversation metadata

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Conversation ID |
| `user_id` | uuid FK → `auth.users` | Owner |
| `project_id` | uuid FK → `projects` | Project where the conversation was **created** (context binding for agent tools) |
| `title` | text nullable | Display title (auto from first user message or manual later) |
| `meta` | jsonb | e.g. `{ skipConfirmation: boolean }` |
| `created_at` | timestamptz | Created |
| `updated_at` | timestamptz | Last activity (touched on each message save) |

**History list data source:** query this table, filtered by `user_id`, **not filtered by the current page's `project_id`**.

#### `agent_messages` — message records

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Message ID |
| `conversation_id` | uuid FK → `agent_conversations` | Parent session |
| `role` | text | `'user'` \| `'assistant'` \| `'tool'` |
| `content` | jsonb | Full body: `{ content, tool_calls?, tool_call_id?, name? }` |
| `created_at` | timestamptz | Sent at |

**History detail data source:** after a conversation is selected, query this table `WHERE conversation_id = ? ORDER BY created_at ASC`.

#### `projects` — project names (for History display)

| Column | Used for |
|--------|----------|
| `id` | Join key from `agent_conversations.project_id` |
| `name` | Shown in History list as **Project** label |

**Relationship:**

```
projects 1 ──< agent_conversations 1 ──< agent_messages
```

#### Not in scope for History UI

| Table | Purpose |
|-------|---------|
| `agent_pending_actions` | Suspended ReAct / confirmation state |
| `agent_traces` | Audit / latency logs |

---

### 2.2 Browser storage (localStorage)

All keys are scoped by authenticated user to avoid cross-account leakage.

| Key pattern | Value | Scope |
|-------------|-------|-------|
| `keco:agent:draft:{userId}` | string (textarea content) | **Global** — same draft in project A and B |
| `keco:agent:last-conversation:{userId}` | `Record<projectId, conversationId>` | **Per project** — which session to restore when entering a project |

**Draft rules:**

- Write on `input` with ~300ms debounce.
- Clear key on successful Send.
- Never sync draft to Supabase.

**Last-conversation rules:**

- Update whenever a conversation receives a new `conversationId` (from SSE header `X-Conversation-Id` or first message response).
- Update when user selects a conversation from History.
- Do **not** update on "New conversation" until user sends first message (clears active slot for that project).

---

## 3. Functional Requirements

### 3.1 Input draft (global shared)

**FR-D1.** User types in the input box; text persists when:

- Switching from project A to project B (and back).
- Closing and reopening ChatPanel.
- Full page refresh (same browser, same logged-in user).

**FR-D2.** After Send succeeds, input clears and draft key is removed.

**FR-D3.** Draft is **not** shared across different logged-in users on the same machine (key includes `userId`).

**FR-D4.** Draft is independent of conversation / project — one global draft per user.

---

### 3.2 Active conversation (per project)

**FR-C1.** When user navigates to project P, ChatPanel loads the conversation mapped in `keco:agent:last-conversation:{userId}[P]` if it exists and is still accessible.

**FR-C2.** If no mapped conversation for P:

- Show empty message area (placeholder copy).
- Do **not** auto-create a DB conversation until the user sends the first message (existing `getOrCreateConversation` behavior).

**FR-C3.** When user switches from project A to project B:

- Message list and `conversationId` switch to B's restored session (or empty).
- A's mapping remains stored; returning to A restores A's session.

**FR-C4.** "New" button clears in-memory messages and `conversationId` for the **current project only**; removes that project's entry from last-conversation map; does not affect other projects or global draft.

**FR-C5.** Sending a message always uses `ctx.projectId` of the **current page** (unchanged). A conversation created in project A always has `agent_conversations.project_id = A` even if user later views it from project B via History.

---

### 3.3 History list (all conversations + project name)

**FR-H1.** History panel lists **all conversations** owned by the current user across **all projects** they can access, ordered by `updated_at DESC`.

**FR-H2.** Each row displays at minimum:

| Field | Source |
|-------|--------|
| Title | `agent_conversations.title` or fallback `"Conversation"` |
| Project name | `projects.name` via `agent_conversations.project_id` |
| Last updated | `agent_conversations.updated_at` (localized) |

**FR-H3.** Optional preview (nice-to-have, not blocking v1): first ~80 chars of last user message from `agent_messages`.

**FR-H4.** Delete action removes the conversation (cascade deletes messages per FK). If deleted conversation was the active one for any project in localStorage map, clear that map entry on next load.

**FR-H5.** Selecting a row:

1. Closes History dropdown.
2. Sets `conversationId` to selected id.
3. Loads messages via existing `GET /api/agent-chat/conversations/:id/messages`.
4. Updates last-conversation map for **current** `projectId` (so returning to this project shows this thread).

**FR-H6.** User may open a conversation that belongs to project X while currently viewing project Y. UI shows messages; subsequent sends still bind to **current page's** `projectId` only if user starts a **new** conversation. If user continues sending in a loaded historical thread, messages append to **that thread's existing** `conversation_id` (agent context uses the conversation's stored `project_id` from DB — see §5.2).

---

### 3.4 History message rendering

**FR-M1.** Loaded history must render the same visual types as live chat where data exists:

| DB `role` | UI |
|-----------|-----|
| `user` | User bubble (`content.content` string) |
| `assistant` | Assistant bubble (text only; no streaming) |
| `tool` | Tool result card (`ToolCallCard`) with parsed JSON from `content.content` |

**FR-M2.** Historical assistant messages with `tool_calls` in content: render tool cards where tool results exist in following `tool` rows; skip orphaned tool_calls (same sanitize logic as backend `sanitizeMessagesForLlm`).

**FR-M3.** Historical `confirmation_request` states are **not** re-interactive: show resolved summary text (e.g. "Action approved" / "Action rejected") if persisted; pending confirmations older than expiry show as expired/disabled.

**FR-M4.** Pagination: initial load `limit=200`; if `nextCursor` returned, "Load older messages" button at top (v1 can defer if all threads fit in 200).

---

## 4. API Changes

### 4.1 List conversations — extend

**Current:** `GET /api/agent-chat/conversations?projectId={uuid}` — requires `projectId`, filters by it.

**New behavior:**

```
GET /api/agent-chat/conversations?scope=all
GET /api/agent-chat/conversations?projectId={uuid}   // keep for backward compatibility
```

| Param | Behavior |
|-------|----------|
| `scope=all` | Return all conversations for `user_id = auth.uid()` where user has access to `project_id` (same RLS as today) |
| `projectId` | Existing per-project filter (optional legacy) |

**Response shape (extended):**

```typescript
interface ConversationListItem {
  id: string;
  projectId: string;
  projectName: string;      // NEW — from projects.name
  title: string | null;
  updatedAt: string;
  createdAt: string;
  lastMessagePreview?: string;  // optional v1
}
```

**Implementation notes:**

- Add `listAllConversations(supabase, userId)` in `conversation-store.ts`.
- Join or secondary query: `projects(id, name)` for each distinct `project_id`.
- Order: `updated_at DESC`.
- Auth: verify user on each conversation's project via existing RLS (SELECT policy already checks project membership).

### 4.2 Load messages — unchanged

```
GET /api/agent-chat/conversations/:id/messages?limit=200
```

Ownership check via `agent_conversations.user_id`.

### 4.3 Send message — unchanged

```
POST /api/agent-chat
Body: { conversationId?, projectId, message, ...context }
```

---

## 5. Frontend Architecture

### 5.1 New module: `agentChatStorage.ts`

Location: `src/components/agent/agentChatStorage.ts`

Responsibilities:

- `getDraft(userId)`, `setDraft(userId, text)`, `clearDraft(userId)`
- `getLastConversationMap(userId)`, `setLastConversation(userId, projectId, conversationId)`, `clearLastConversation(userId, projectId)`

Pure functions; no React deps. Unit-testable.

### 5.2 Hook changes: `useAgentChat.ts`

| Change | Detail |
|--------|--------|
| Accept `userId` + `projectId` | React to `projectId` changes |
| On `projectId` change | Abort stream; load last conversation for new project from storage → `loadConversation(id)` or reset to empty |
| On `conversationId` set | Persist to storage for current `projectId` |
| `loadConversation` | Improve message → `ChatItem[]` mapping (tool name from content, assistant text, etc.) |

**Cross-project History selection:** When user loads conversation C created in project X while on page Y:

- Display messages from C.
- `conversationIdRef` = C.id.
- Agent API on next send uses C's id; backend loads conversation record — **`project_id` on the conversation row remains X** (tool context unchanged). This matches "view any history, continue thread" semantics.

Document this explicitly so implementers do not overwrite `project_id` on send.

### 5.3 Component changes

| File | Change |
|------|--------|
| `ChatInput.tsx` | Controlled draft from storage; debounced persist; clear on send |
| `ChatPanel.tsx` | Pass `userId` from `useAuth()`; remove `projectId` prop from `ConversationList` or pass as display-only |
| `ConversationList.tsx` | Fetch `scope=all`; render `projectName`; sort by `updatedAt` |

### 5.4 Data flow diagram

```
┌─────────────────────────────────────────────────────────────┐
│ ChatPanel (DashboardLayout — single mount)                   │
├─────────────────────────────────────────────────────────────┤
│  ChatInput ◄──► localStorage keco:agent:draft:{userId}      │
│       │              (GLOBAL)                                │
│       ▼                                                      │
│  useAgentChat(ctx.projectId)                                 │
│       │                                                      │
│       ├──► localStorage last-conversation map (PER PROJECT)  │
│       │                                                      │
│       ├──► POST /api/agent-chat ──► agent_conversations      │
│       │                              agent_messages           │
│       │                                                      │
│       └──► ConversationList (scope=all)                    │
│                 └──► agent_conversations JOIN projects.name  │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. UI Specification

### 6.1 History list row

```
┌──────────────────────────────────────────────┐
│ {title or "Conversation"}              [Del] │
│ {projectName} · {updatedAt locale string}    │
└──────────────────────────────────────────────┘
```

- Active conversation: highlight background (existing `activeId` styling).
- Empty state: `"No conversations yet."`
- Loading: skeleton or spinner in dropdown.

### 6.2 Project switch behavior

| Event | Messages area | Input draft |
|-------|---------------|-------------|
| A → B | Load B's last conversation or empty | Unchanged (global) |
| B → A | Load A's last conversation or empty | Unchanged |
| Refresh on A | Load A's last conversation or empty | Restore draft |

---

## 7. Edge Cases

| Case | Behavior |
|------|----------|
| Last conversation deleted | On load 404, clear map entry; show empty |
| User loses project access | RLS hides conversation from list; load returns 404 → clear |
| Streaming in progress + project switch | Abort SSE; switch conversation |
| Two tabs same user | last-write-wins on localStorage (acceptable v1) |
| Logout | Draft and maps remain on disk but keys use userId — invisible to next login |
| Viewer role | Can view History and messages; write tools still blocked by permissions |

---

## 8. Out of Scope (v1)

- Server-side draft sync
- Cross-device draft / last-conversation sync (would need user preferences table)
- Search / filter History by project name
- Rename conversation title in UI
- Auto-load latest conversation when no map entry (product chose empty state)
- `agent_traces` in History UI

---

## 9. Testing Plan

### Unit

- `agentChatStorage.ts`: get/set/clear draft; per-project conversation map
- `loadConversation` mapper: user, assistant, tool rows → `ChatItem[]`

### Integration / manual

1. Type draft in project A → switch to B → draft visible → refresh → draft visible.
2. Send in A → switch B → A messages hidden → switch back → A messages restored.
3. History shows conversations from A and B with correct project names.
4. Select old conversation from History → full message thread renders.
5. Delete conversation from History → removed from list; active state cleared if applicable.
6. New conversation → empty messages; first send creates row in `agent_conversations`.

### E2E (optional follow-up)

- Extend agent e2e spec: draft persistence + history list cross-project.

---

## 10. Implementation Checklist

| # | Task | Files |
|---|------|-------|
| 1 | Add `agentChatStorage.ts` | `src/components/agent/agentChatStorage.ts` |
| 2 | Extend `listAllConversations` + project name | `conversation-store.ts`, `conversations/route.ts` |
| 3 | `useAgentChat`: project switch restore, storage hooks, improved history mapper | `useAgentChat.ts` |
| 4 | Draft persistence | `ChatInput.tsx`, `ChatPanel.tsx` |
| 5 | History `scope=all` + project name column | `ConversationList.tsx` |
| 6 | Unit tests for storage + mapper | `tests/unit/agent/` |

---

## 11. Acceptance Criteria

- [ ] Unsent input survives project switch, panel close, and page refresh (same user).
- [ ] Each project restores its own last active conversation when re-entered.
- [ ] History lists **all** user conversations, not filtered to current project.
- [ ] Each History row shows **project name** from `projects` table.
- [ ] Selecting a History entry loads and displays messages from `agent_messages`.
- [ ] Data sources documented: **`agent_conversations`** (list), **`agent_messages`** (detail), **`projects.name`** (label).

---

## 12. Revision History

| Date | Change |
|------|--------|
| 2026-06-12 | Initial spec from product requirements |
