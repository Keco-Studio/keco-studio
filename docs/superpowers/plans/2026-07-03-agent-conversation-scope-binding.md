# Agent Conversation Project/Scope Binding Implementation Plan

**Goal:** Freeze each Agent conversation's owning project and data scope at creation time; at runtime the conversation-bound values are the single source of truth and no longer drift with the frontend's live navigation. The History list and panel header display the owning project and scope level.

**Architecture:** When a conversation is first created, snapshot a `scope` from the navigation level at that moment (table/folder/project/global) and store it in `agent_conversations.meta.scope` (jsonb, no table schema change). When continuing an existing conversation, the backend `POST /api/agent-chat` constructs the `ToolContext` from `meta.scope` and ignores the live navigation values in the request body. The only entry point for continuing a conversation is the main POST route (`/messages` is GET-only for fetching history and does not drive a turn). The global level is restricted in v1 (no cross-project support).

**Tech Stack:** TypeScript, Next.js App Router, Supabase (jsonb meta), Jest

**Spec:** `docs/superpowers/specs/2026-07-03-agent-conversation-scope-binding-design.md`

---

## Key Findings (verified before coding)

- The only entry point for continuing a conversation is `POST /api/agent-chat` (with `conversationId`); `conversations/[id]/messages/route.ts` only has GET and does not drive an agent turn → spec §4.4 simplifies to a single entry point.
- `metaForSave` (`conversation-meta.ts:50`) currently only returns `{ autoExecute }`; writing meta on conversation creation would overwrite scope → the creation path must **merge** autoExecute + scope.
- `resolveConversationMeta` (`conversation-meta.ts:8`) currently only parses `autoExecute`; it needs to be extended to expose `scope`.
- `getOrCreateConversation` (`conversation-store.ts:55`) already has "existing conversation" and "create new" branches, which is where the snapshot and project lock land.
- `ConversationList` already displays `projectName`, and the select in `listAllConversations` already includes `meta` → the badge only needs `scope.level` exposed.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/agent/scope.ts` | `ConversationScope` type, `resolveScopeFromNavigation`, `buildContextFromScope` |
| Modify | `src/lib/agent/types.ts` | Add `scope?` to `ConversationMeta`; export `ConversationScope` |
| Modify | `src/lib/agent/conversation-meta.ts` | `resolveConversationMeta` exposes scope; `metaForSave` supports merging scope |
| Modify | `src/lib/agent/conversation-store.ts` | `getOrCreateConversation` snapshots scope + project lock; list mapping exposes scope |
| Modify | `src/app/api/agent-chat/route.ts` | New conversation snapshots scope; existing conversation builds ToolContext from meta.scope |
| Modify | `src/app/api/agent-chat/conversations/[id]/meta/route.ts` | GET meta response body already includes scope (meta passes through as-is; confirm no change needed) |
| Modify | `src/components/agent/types.ts` | `SendContext` needs no change; add frontend scope display types (if needed) |
| Modify | `src/components/agent/ConversationList.tsx` | Render scope level badge |
| Modify | `src/components/agent/useAgentChat.ts` | Continuing a conversation no longer sends live navigation; retrieve scope when loading a conversation |
| Modify | `src/components/agent/ChatPanel.tsx` | Header shows 🔒 locked target |
| Create | `tests/unit/agent/scope.test.ts` | Unit tests for `resolveScopeFromNavigation` + `buildContextFromScope` |
| Modify | `tests/unit/agent/*` (meta) | `resolveConversationMeta` scope parsing + legacy fallback |

---

## Task 1: Scope Types and Pure Functions (`scope.ts`)

**Files:** Create `src/lib/agent/scope.ts`; Modify `src/lib/agent/types.ts`

- [ ] **Step 1: Define `ConversationScope` in `types.ts` and extend `ConversationMeta`**

```typescript
export type ScopeLevel = 'global' | 'project' | 'folder' | 'table';

export interface ConversationScope {
  level: ScopeLevel;
  projectId?: string;
  folderId?: string;
  folderName?: string;
  libraryId?: string;
  libraryName?: string;
  sectionName?: string;
}

// Add inside ConversationMeta:
//   scope?: ConversationScope;
```

- [ ] **Step 2: Create `src/lib/agent/scope.ts`**

Implement two pure functions:

```typescript
import type { ConversationScope } from './types';

interface NavigationInput {
  projectId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
  currentSectionName?: string;
}

/** §3.1 Determine scope level from finest to coarsest. */
export function resolveScopeFromNavigation(nav: NavigationInput): ConversationScope {
  if (nav.currentLibraryId) {
    return {
      level: 'table',
      projectId: nav.projectId,
      folderId: nav.currentFolderId,
      folderName: nav.currentFolderName,
      libraryId: nav.currentLibraryId,
      libraryName: nav.currentLibraryName,
      sectionName: nav.currentSectionName,
    };
  }
  if (nav.currentFolderId) {
    return { level: 'folder', projectId: nav.projectId, folderId: nav.currentFolderId, folderName: nav.currentFolderName };
  }
  if (nav.projectId) {
    return { level: 'project', projectId: nav.projectId };
  }
  return { level: 'global' };
}

/** Build the navigation fields of ToolContext from the conversation-bound scope (§4.2). Legacy conversations without scope fall back to project level. */
export function contextFieldsFromScope(
  scope: ConversationScope | undefined,
  fallbackProjectId: string
): Pick<ToolContext, 'projectId' | 'currentFolderId' | 'currentFolderName' | 'currentLibraryId' | 'currentLibraryName' | 'currentSectionName'> {
  if (!scope) {
    return { projectId: fallbackProjectId }; // §4.5 legacy → project level
  }
  return {
    projectId: scope.projectId ?? fallbackProjectId,
    currentFolderId: scope.folderId,
    currentFolderName: scope.folderName,
    currentLibraryId: scope.libraryId,
    currentLibraryName: scope.libraryName,
    currentSectionName: scope.sectionName,
  };
}
```

- [ ] **Step 3: Unit tests `tests/unit/agent/scope.test.ts`**

Coverage: resolution of all four levels (table/folder/project/global); fallback when scope is absent; use fallback when scope.projectId is missing.

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent/scope.test.ts
```

Expected: all pass.

---

## Task 2: Meta Parsing and Save Merging for Scope

**Files:** Modify `src/lib/agent/conversation-meta.ts`

- [ ] **Step 1: `resolveConversationMeta` exposes scope**

Keep the autoExecute logic, and additionally pass `raw.scope` through as-is:

```typescript
export function resolveConversationMeta(raw): ConversationMeta {
  const autoExecute = raw?.autoExecute === false ? false : true; // existing semantics
  const resolved: ConversationMeta = { autoExecute };
  if (raw?.scope) resolved.scope = raw.scope;
  return resolved;
}
```

(Keep the existing skipConfirmation compatibility branch unchanged.)

- [ ] **Step 2: `metaForSave` supports merging scope**

```typescript
export function metaForSave(autoExecute: boolean, scope?: ConversationScope): ConversationMeta {
  return scope ? { autoExecute, scope } : { autoExecute };
}
```

- [ ] **Step 3: Update unit tests**

`resolveConversationMeta`: with/without scope; legacy (no scope + no autoExecute) → `{autoExecute:true}` without scope.

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent
```

---

## Task 3: Snapshot Scope on Conversation Creation + Project Lock

**Files:** Modify `src/lib/agent/conversation-store.ts`

- [ ] **Step 1: Add a `scope` parameter to `getOrCreateConversation`; merge it into meta on creation**

```typescript
params: { conversationId?; userId; projectId; initialAutoExecute?; scope?: ConversationScope }
// Creation branch:
const initialMeta = metaForSave(params.initialAutoExecute ?? true, params.scope);
```

- [ ] **Step 2: Add the project lock to the existing-conversation branch (silent correction + warn, §4.3)**

Before returning, if `params.projectId && data.project_id !== params.projectId` → `console.warn('agent.scope.project_mismatch', {...})`. Do not throw.

- [ ] **Step 3: `mapConversationListRow` exposes scope**

`ConversationListItem` already includes `meta` (via `resolveConversationMeta`); confirm scope is exposed along with meta. If it's more convenient for the frontend, additionally flatten out a `scopeLevel` field.

- [ ] **Step 4: Compile check**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit
```

---

## Task 4: Main POST Route — Snapshot and Binding

**Files:** Modify `src/app/api/agent-chat/route.ts`

- [ ] **Step 1: Distinguish new conversation vs existing conversation**

- No `body.conversationId` → new conversation: `scope = resolveScopeFromNavigation(body)`, passed into `getOrCreateConversation`; `ToolContext` uses the live body (consistent with the snapshot).
- Has `body.conversationId` → existing conversation: `getOrCreateConversation` retrieves the conversation, `const scope = resolveConversationMeta(conversation.meta).scope`; the navigation fields of `ToolContext` use `contextFieldsFromScope(scope, conversation.project_id)`, **ignoring the body's folder/library/section**.

- [ ] **Step 2: Global level restricted in v1 (§7)**

Existing conversation with `scope?.level === 'global'` (or a new conversation resolved as global) → return 400:
`{ error: 'This conversation is not bound to a specific project. Please enter a project and start a new conversation.' }`

- [ ] **Step 3: Adapt projectId validation**

For existing conversations, projectId follows the conversation binding; the UUID validation of body.projectId only applies to the new-conversation path.

- [ ] **Step 4: Compile + smoke test**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit && npm run build
```

---

## Task 5: Frontend — Don't Send Live Navigation on Continuation + Retrieve Scope on Load

**Files:** Modify `src/components/agent/useAgentChat.ts`

- [ ] **Step 1: `send` distinguishes new vs continued conversation**

When `conversationIdRef.current` exists (continuation), the body sends only `conversationId` + `message` + `imageUrls`, without folder/library/section (§5.1 recommendation). The first message of a new conversation still sends all fields as the snapshot source.

- [ ] **Step 2: Retrieve scope when loading a conversation and store it in state**

In `loadConversation`, `fetchConversationMeta` already requests `/meta`; extend it to parse out `scope` and expose it to ChatPanel via a new `scope` state. Add a new hook return value `activeScope`.

- [ ] **Step 3: Compile check**

```bash
cd /home/hetu/project/keco-studio && npx tsc --noEmit
```

---

## Task 6: History Badge + Panel Header Locked Target

**Files:** Modify `src/components/agent/ConversationList.tsx`, `src/components/agent/ChatPanel.tsx`, `ChatPanel.module.css`

- [ ] **Step 1: `ConversationList` renders the scope badge (§5.3)**

Add `scope?: { level; folderName?; libraryName? }` to `ConversationItem` (exposed from the `/conversations?scope=all` response body). Render on the meta line:
- table → `📄 {libraryName}`; folder → `📁 {folderName}`; project → omitted; global → `🌐 Global`.

- [ ] **Step 2: `ChatPanel` header shows the locked target (§5.4)**

After loading a conversation, use `activeScope` to render `🔒 {projectName} / {scopeBadge}` (read-only). A new conversation shows a live navigation preview (with the hint "This conversation will be bound to this").

- [ ] **Step 3: Styles**

Add badge/lock label styles in `ChatPanel.module.css`, reusing the existing `convMeta` style.

- [ ] **Step 4: Compile + build**

```bash
cd /home/hetu/project/keco-studio && npm run build
```

---

## Task 7: Integration Verification and Regression

- [ ] **Step 1: All unit tests green**

```bash
cd /home/hetu/project/keco-studio && npx jest tests/unit/agent
```

- [ ] **Step 2: Manual verification (§9.2 / §9.3)**

1. Create a conversation in some table context and send a message → DB `meta.scope.level === 'table'`, ids correct.
2. Switch to another project → load the conversation from step 1 via History and continue → tools hit the **original** project's library.
3. Project lock: craft a body.projectId that mismatches the conversation → executes with the conversation's project + warn log.
4. Legacy conversation (manually delete meta.scope) → runs at project level without errors.
5. History list: conversations across multiple projects each show the correct project name + scope badge.
6. Load a conversation → header shows 🔒 locked target; switching projects does not change the header.

- [ ] **Step 3: Regression**

auto-execute (Auto/Confirm toggle), permissions (Viewer cannot write), RAG, and multimodal image upload behavior unchanged.

- [ ] **Step 4: Clean up temporary files, final build**

```bash
cd /home/hetu/project/keco-studio && npm run build
```

---

## Success Criteria (aligned with spec §12)

- [ ] New conversations correctly write `meta.scope` on creation; all four level resolutions follow the rules
- [ ] Continuing an existing conversation follows `meta.scope`; switching projects has no effect
- [ ] Loading a project B conversation while in project A and continuing it → tools hit project B data
- [ ] Each conversation in History shows its owning project name + scope badge
- [ ] ChatPanel header shows the current conversation's locked target
- [ ] Legacy conversations (no meta.scope) run at project level without errors
- [ ] auto-execute / permissions / RAG / multimodal regressions unchanged

---

## Notes

- **No database migration, no breaking changes:** scope lives in the existing `meta` jsonb; historical conversations are handled via the fallback path.
- **Language rule:** Code/comments in English; user-facing error copy and UI copy in English (e.g. the global restriction message, the lock badge).
- **Commit:** Commit each Task only after it is complete and build/tests pass; current branch is `debug`. If pushing is needed, create a separate feature branch — do not push to main directly.
