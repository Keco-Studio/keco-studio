# Agent Conversation Project/Scope Binding Design Spec

**Date:** 2026-07-03  
**Status:** Draft  
**Scope:** Each Agent conversation freezes its owning project and data scope at creation time; at runtime the conversation-bound values are the sole authority, no longer drifting with the frontend's live navigation; the History list shows the owning project and scope level  
**Related:** [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md), [2026-06-12-agent-chat-persistence-design.md](./2026-06-12-agent-chat-persistence-design.md), [2026-06-17-agent-auto-execute-design.md](./2026-06-17-agent-auto-execute-design.md)

---

## 1. Overview

### 1.1 Problem

Currently the Agent's runtime project and page context (folder / library / section) **come entirely from the frontend's live navigation** (`useNavigation()`). While the conversation itself stores the creation-time project in `agent_conversations.project_id`, the runtime does not treat it as authoritative:

- When sending a message (`useAgentChat.ts:339-350`), what is sent is `ctx.projectId` + the **live values** of the current folder/library/section.
- The backend `getOrCreateConversation` (`conversation-store.ts:59-72`) only validates user ownership for existing conversations, **not whether projectId matches the conversation's binding**.

**Consequence:** If a user opens History in project A and switches back to a historical conversation belonging to project B to continue messaging, it actually executes with **project A's context** — multiple projects share the same Agent conversation, and data may be written to the wrong project.

### 1.2 Decision

**Conversation-scoped binding**: each Agent conversation snapshots a `scope` from the navigation hierarchy at **first creation**, written into `agent_conversations.meta.scope`. From then on, for every turn of that conversation, **the project and page context are governed solely by `meta.scope`**, ignoring the live navigation values in the request body.

Conversation-to-project is many-to-one: one project may have multiple conversations; a conversation corresponds only to the project it was created in, and never changes. The History list lists all of the user's conversations, annotating each with its owning project and scope level.

### 1.3 Goals

| Goal | Description |
|------|------|
| **G1** | Snapshot the scope into `meta.scope` at conversation creation (four levels: global / project / folder / table) |
| **G2** | For every turn of an existing conversation, the backend resolves the project and page context from `meta.scope`, discarding live navigation values in the body |
| **G3** | Strict project lock validation: when body.projectId does not match the conversation's `project_id`, reject/ignore, eliminating mismatches |
| **G4** | The History list shows each conversation's owning project name + a scope level marker |
| **G5** | After the ChatPanel loads a conversation, the header shows the conversation's locked target (project / folder / table) |
| **G6** | Existing auto-execute, permissions, RAG, multimodal, etc. behavior is unaffected |

### 1.4 Non-Goals

- **No actual cross-project capability for the "global" level** (v1 scope). See §7 Deferred. In v1 the global level is only a **restricted placeholder state**: the conversation can be created, but sending a message prompts the user "this conversation is not bound to a specific project; please enter a project first". Real cross-project query/write is left to a later spec.
- No multiple Agent panels open simultaneously (still single panel + History switching).
- No changes to business rules in the LLM prompt (field resolution, rowIndex, reference fields, etc.).
- No after-the-fact editing of a conversation's scope (the scope is frozen once created; if the user needs a different scope, create a new conversation).
- No changes to the `agent_messages` / `agent_pending_actions` / `agent_traces` table structures.

---

## 2. Terminology

| Term | Meaning |
|------|---------|
| **scope** | The data-scope snapshot bound to a conversation, stored in `agent_conversations.meta.scope` |
| **scope.level** | Four levels: `global` \| `project` \| `folder` \| `table`, from coarse to fine |
| **binding** | The mechanism whereby the conversation's runtime treats `meta.scope` as authoritative, freezing live navigation |
| **live navigation** | The real-time project/folder/library/section provided by the frontend's `useNavigation()` |
| **scope snapshot** | The act of determining the scope from live navigation and writing it to meta at first conversation creation |

---

## 3. Scope Model

### 3.1 Four-level determination (snapshot at creation)

Based on the live navigation **at the moment the conversation is first created**, determine the level from fine to coarse:

```
If currentLibraryId exists        → level = 'table'
Else if currentFolderId exists     → level = 'folder'
Else if currentProjectId exists    → level = 'project'
Else                              → level = 'global'
```

### 3.2 Scope data structure

Stored in `agent_conversations.meta.scope`:

```typescript
interface ConversationScope {
  level: 'global' | 'project' | 'folder' | 'table';
  projectId?: string;      // required when level >= 'project'
  folderId?: string;       // required when level >= 'folder'
  folderName?: string;     // name at snapshot time (for display; may become stale)
  libraryId?: string;      // required when level === 'table'
  libraryName?: string;    // name at snapshot time
  sectionName?: string;    // active section tab at snapshot time (optional)
}
```

**Note:** The name fields are display snapshots taken at creation and may become stale due to later renames. At runtime, resolve live names by id (reusing the existing id→name lookup logic in `core.ts:buildSystemMessage`); the name snapshots are only for quick display in the History list and as a degradation fallback.

### 3.3 Runtime behavior per level

| level | Authoritative project source | Page context passed to the LLM | Notes |
|-------|------------------|-----------------------|------|
| `table` | `scope.projectId` | folder + library + section (all from scope) | Finest; the Agent operates on that table by default |
| `folder` | `scope.projectId` | folder (from scope), library=none | The Agent operates on that folder by default |
| `project` | `scope.projectId` | no folder/library | The Agent's operating range is the entire project |
| `global` | none | none | **v1 restricted**: see §7; prompt to pick a project before messaging |

---

## 4. Backend Changes

### 4.1 Scope snapshot (new conversation)

Extend the **create new conversation** branch of `getOrCreateConversation` (`conversation-store.ts`): accept a `scope` parameter and write it into `meta.scope`. The scope is determined by the API route from the live navigation fields in the request body and passed in.

```typescript
// route.ts POST — snapshot only when creating a new conversation (no conversationId)
const scope = resolveScopeFromNavigation({
  projectId: body.projectId,
  currentFolderId: body.currentFolderId,
  currentFolderName: body.currentFolderName,
  currentLibraryId: body.currentLibraryId,
  currentLibraryName: body.currentLibraryName,
  currentSectionName: body.currentSectionName,
});
```

`resolveScopeFromNavigation` is a pure function (new file `src/lib/agent/scope.ts`) implementing the §3.1 determination logic.

### 4.2 Scope as authority at runtime (existing conversations)

The core change to `route.ts` POST: **distinguish new conversations from existing ones**.

```
if (no conversationId) {
  // New conversation: snapshot the scope; ToolContext uses live navigation (= snapshot source, the two match)
} else {
  // Existing conversation: construct ToolContext from conversation.meta.scope,
  // ignoring live currentFolderId/currentLibraryId/... values in the body
}
```

For existing conversations, the `ToolContext`'s `projectId` / `currentFolderId` / `currentLibraryId` / `currentSectionName` are all read from `meta.scope`. This is **the key freezing point**: the DB becomes the sole authority; whether the frontend sends live ctx or not does not affect the result.

### 4.3 Strict project lock validation (G3)

Enhance the existing-conversation branch of `getOrCreateConversation`:

```typescript
if (params.conversationId) {
  const data = /* fetch */;
  if (data.user_id !== params.userId) throw new Error('Conversation does not belong to the current user.');
  // NEW: project lock
  if (params.projectId && data.project_id !== params.projectId) {
    // Do not error out; instead treat the conversation's bound project_id as authoritative (prevent mismatches, silently correct)
    // Log a warn entry for troubleshooting
    console.warn('agent.scope.project_mismatch', {
      conversationId: params.conversationId,
      boundProject: data.project_id,
      requestProject: params.projectId,
    });
  }
  return normalizeConversation(data);
}
```

**Decision: silently correct rather than error** — because the frontend loading project B's conversation while in project A is a legitimate operation (the user simply wants to continue that conversation); the backend only needs to guarantee execution with the conversation's bound project.

### 4.4 `/messages` continuation route sync

If `conversations/[id]/messages/route.ts` also drives agent turns (continuation), it must apply the same "meta.scope is authoritative" logic. Implement by reusing the same constructor function from §4.2, avoiding behavioral divergence between the two entry points.

> **Implementation note:** Extract a shared function `buildToolContextForConversation(conversation, authed, liveBody?)` called by both the POST main route and the messages continuation route, guaranteeing a single source of truth.

### 4.5 `resolveConversationMeta` compatibility

The existing `resolveConversationMeta` (`conversation-meta.ts`) resolves `autoExecute`. Extend it to also resolve `scope` (when absent, `scope = undefined`, treated as a legacy conversation).

**Legacy conversation (no meta.scope) degradation strategy:** simply use the conversation's `project_id` as `level: 'project'` with an empty page context. That is, old conversations behave as "bound to the project, no finer scope" — safe behavior that does not break historical data.

---

## 5. Frontend Changes

### 5.1 Sending messages (`useAgentChat.ts` send)

- **First message of a new conversation**: continue sending all live navigation fields (as the snapshot source); behavior unchanged.
- **Existing conversation**: may keep sending live fields (the backend ignores them), but the cleaner approach is to **stop sending** these fields and send only `conversationId` + `message`. The latter is recommended to make the "context is determined by the conversation" semantics explicit.

### 5.2 Restoring scope display after loading a conversation

When `loadConversation` fetches the conversation meta, also retrieve the `scope` and store it in local state for header display (§5.4). Reuse the existing `/conversations/[id]/meta` route, extending its response body to include `scope`.

### 5.3 History list annotated with project + scope (G4)

`ConversationList.tsx` already shows `projectName`. Extend `ConversationItem` and the return of `listAllConversations` to carry `scope.level` and corresponding names, rendering a level badge on the meta line:

```
{title}
{projectName} · {scopeBadge} · {updatedAt}
```

`scopeBadge` examples:
- table: `📄 LibraryName`
- folder: `📁 FolderName`
- project: `📦 Project` (or omitted; projectName already conveys it)
- global: `🌐 Global`

The `select` of `listAllConversations` (`conversation-store.ts:292`) already includes `meta`; only the mapping needs to expose `scope`.

### 5.4 ChatPanel header shows the locked target (G5)

After the panel loads a conversation, the header shows the conversation's locked scope (read-only, not changeable):

```
Keco Assistant  🔒 ProjectA / 📁 FolderX
```

A new conversation (not yet created; about to snapshot the current navigation) shows a preview of the live navigation target, informing the user "this session will bind to this".

---

## 6. Data Model

**No table structure changes.** Only a new `scope` key inside `agent_conversations.meta` (jsonb):

```jsonc
{
  "autoExecute": true,
  "scope": {
    "level": "table",
    "projectId": "uuid",
    "folderId": "uuid",
    "folderName": "Worldview",
    "libraryId": "uuid",
    "libraryName": "Characters",
    "sectionName": "Basic Info"
  }
}
```

Backward compatible: historical conversations without the `scope` key degrade to `level: 'project'` per §4.5.

---

## 7. Deferred: the "global" level

v1 does **not implement** actual cross-project capability. Fully landing the global level would require:

- The panel opening even without `currentProjectId` (currently `ChatPanel.tsx:133` simply `return null`).
- The backend `route.ts:43` relaxing the mandatory requirement of a valid `projectId`.
- All tools refactored from "single-projectId queries" to "multi-project queries across what the user can access", relaxing RLS / permission checks accordingly.

v1 behavior: if a conversation's scope.level === 'global' (theoretically only created when the user has no project context; the v1 UI layer should avoid producing them where possible), sending a message makes the backend return an explicit error message: "This conversation is not bound to a specific project; please enter a project and start a new conversation." Left to a standalone spec (cross-project Agent).

---

## 8. Edge Cases

| # | Scenario | Handling |
|---|------|------|
| E1 | The scope-bound folder/library is later deleted | Runtime id→name lookup fails; name falls back to the snapshot; tool calls return "resource does not exist", explained to the user by the LLM |
| E2 | The scope-bound resource is renamed | Runtime resolves the latest name by id; the History badge may show the old snapshot name (acceptable, or refresh at list load) |
| E3 | Legacy conversation (no meta.scope) | §4.5 degrades to `level: 'project'` |
| E4 | User in project A loads a project B conversation and continues | Backend executes with the conversation's bound project B (§4.3 silent correction); cache invalidation events must target B's library |
| E5 | User has no project context at all for the first message of a new conversation | level = 'global', triggering the §7 v1 restriction notice |
| E6 | Cache invalidation after writes (`invalidateCache`) | Based on the scope-bound libraryId, not live navigation |

---

## 9. Testing Strategy

### 9.1 Unit

- `resolveScopeFromNavigation`: boundaries of the four-level determination (combinations of present/absent fields).
- `resolveConversationMeta`: `scope` parsing + legacy degradation.
- `buildToolContextForConversation`: existing conversations ignore the live body and follow meta.scope.

### 9.2 Integration

1. Create a conversation in a table context → meta.scope.level === 'table' and ids correct.
2. Switch to another project → load the step-1 conversation and continue → tool calls hit the original project's library, not the current project.
3. Project lock: body.projectId mismatched with the conversation → execute with the conversation's bound project + warn log.
4. Legacy conversation (manually remove meta.scope) → runs at project level, no errors.

### 9.3 Manual

- History list: conversations across multiple projects each show the correct project name + scope badge.
- Load a conversation → header shows the 🔒 locked target; header unchanged after switching projects.

---

## 10. Rollout

| Step | Action |
|------|--------|
| 1 | Ship `resolveScopeFromNavigation` + new conversations writing `meta.scope` |
| 2 | Ship "existing conversations treat meta.scope as authoritative" + project lock validation |
| 3 | Ship History badges + header locked-target display |
| 4 | Legacy conversations transition smoothly via the degradation path; no data migration needed |

**No breaking changes, no data migration**: historical conversations are compatible via the §4.5 degradation path.

---

## 11. Open Questions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Should the frontend still send live navigation fields when continuing an existing conversation? | Recommended not to (§5.1); the backend follows meta.scope regardless |
| Q2 | On project lock mismatch, error or silently correct? | **Locked: silently correct** (§4.3); loading another project's conversation to continue is a legitimate operation |
| Q3 | Is the scope editable after the fact? | **Locked: No** — frozen once created; create a new conversation to change scope |
| Q4 | Can the global level be created in v1? | v1 avoids producing it at the UI layer where possible; if produced, show the restriction notice (§7) |
| Q5 | How to handle stale name snapshots? | Runtime resolves the latest name by id; badges tolerate old names (E2) |

---

## 12. Success Criteria

- [ ] New conversations correctly write `meta.scope`, with the four-level determination matching §3.1
- [ ] When continuing an existing conversation, the project and page context follow `meta.scope`; switching projects has no effect
- [ ] Loading a project B conversation while in project A and continuing: tools hit project B's data
- [ ] The History list shows each conversation's owning project name + scope level badge
- [ ] The ChatPanel header shows the current conversation's locked target
- [ ] Legacy conversations (no meta.scope) do not error and run at project level
- [ ] Auto-execute / permissions / RAG / multimodal behavior regression unchanged
