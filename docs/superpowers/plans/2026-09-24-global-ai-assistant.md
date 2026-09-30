# Global AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one consistent Keco Assistant across Projects, all Studio project pages, Script, Create Map, and Game Design Systems while keeping account conversations isolated from project content and preserving existing Studio and Script behavior.

**Architecture:** `DashboardLayout` mounts one route-aware `AssistantHost`; the host passes a typed workspace context into the existing panel and runtime. The server freezes that workspace and optional project in conversation metadata, selects a workspace-specific Tool bundle, and checks the same bundle again at execution. Existing Create Map and Game Design System services remain the domain boundaries; Agent Tools are thin validated adapters that return bounded summaries or durable asynchronous job identities.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/Postgres RLS, Jest 30, Testing Library, Playwright, OpenAI-compatible SSE Tool calling.

## Global Constraints

- Covered workspaces are Projects, all Studio project pages, Script, Create Map, and Game Design Systems.
- Simulation, Account, Billing, MCP, Keco Admin, Keco 101, authentication, invitation, OAuth, and payment-result pages must not render the assistant.
- Create Map must expose exactly one assistant entry using the existing Keco Assistant icon, size, position, drag behavior, animation, and panel.
- Account conversations use `project_id = NULL`; project conversations remain immutably bound to one authorized project.
- Client route or project identifiers are hints only; the server revalidates access and ownership on every turn and Tool execution.
- Tool schemas and Tool execution both use the stored workspace allowlist.
- Paid map generation, paid map retry, and GDD generation always require explicit confirmation, including Auto mode.
- List Tools default to 20 records and reject or clamp values above 50.
- Collapsed assistant state performs zero network requests.
- Tool schema is built once per user turn and rebuilt only after a successful schema-changing Tool.
- Retrieval uses one embedding request followed by concurrent scope RPCs; account scope retrieves same-conversation memory only.
- Async generation returns after enqueue or submission and never polls inside the ReAct loop.
- Existing per-result model-context compaction and the 16,000-character limit remain in force.
- No project, map, or Game Design System deletion or Game Design System unbinding Tools are added.

---

### Task 1: Account Conversation Database Contract

**Files:**
- Create: `supabase/migrations/20260924130000_global_agent_conversations.sql`
- Create: `tests/unit/database/global-agent-conversations-migration.test.ts`
- Modify: `src/lib/agent/conversation-store.ts`
- Test: `tests/unit/agent/conversation-store.test.ts`

**Interfaces:**
- Produces: `agent_conversations.project_id uuid NULL` and RLS that authorizes an owned account conversation without project membership.
- Produces: transactional RPC `create_project_with_default_resource_idempotent(p_name text, p_description text, p_idempotency_key uuid)` for retry-safe Agent project creation.
- Produces: `ConversationRecord.project_id: string | null` and `ConversationListItem.projectId: string | null`.
- Consumes: existing `meta.scope.workspace` JSON metadata; no new database workspace column is needed.

- [ ] **Step 1: Write migration contract tests**

Add assertions that read the migration and verify these exact clauses:

```ts
expect(sql).toMatch(/alter table public\.agent_conversations\s+alter column project_id drop not null/i);
expect(sql).toMatch(/project_id is null\s+or/i);
expect(sql).toMatch(/user_id = \(select auth\.uid\(\)\)/i);
expect(sql).toMatch(/create index[^;]+agent_conversations[^;]+user_id[^;]+updated_at/i);
expect(sql).toMatch(/create index[^;]+agent_conversations[^;]+project_id[^;]+updated_at/i);
expect(sql).toMatch(/create or replace function public\.create_project_with_default_resource_idempotent/i);
```

Add store tests proving a new account conversation inserts `project_id: null`, an existing account conversation can be loaded without a project mismatch, and a project-bound conversation still rejects a different requested project.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/database/global-agent-conversations-migration.test.ts tests/unit/agent/conversation-store.test.ts
```

Expected: FAIL because the migration does not exist and the store still requires `projectId: string`.

- [ ] **Step 3: Add the nullable binding and replacement RLS policies**

The migration must:

```sql
ALTER TABLE public.agent_conversations
  ALTER COLUMN project_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users can view own conversations" ON public.agent_conversations;
CREATE POLICY "Users can view own conversations" ON public.agent_conversations
FOR SELECT USING (
  user_id = (SELECT auth.uid())
  AND (
    project_id IS NULL
    OR project_id IN (
      SELECT pc.project_id
      FROM public.project_collaborators pc
      WHERE pc.user_id = (SELECT auth.uid())
        AND pc.accepted_at IS NOT NULL
    )
  )
);
```

Apply the same account-or-accessible-project predicate to INSERT and UPDATE `WITH CHECK`; DELETE remains owner-only. Recreate the existing policy names so dependent tests and operational tooling remain stable. Add:

```sql
CREATE INDEX IF NOT EXISTS idx_agent_conv_user_updated
  ON public.agent_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conv_project_updated
  ON public.agent_conversations(project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;
```

Add a private idempotency ledger keyed by `(user_id, operation, idempotency_key)` with canonical input hash, status, and JSON result. The `SECURITY INVOKER` RPC must require `auth.uid()`, take a transaction-scoped advisory lock for the key, return the stored result when key and hash match, raise `IDEMPOTENCY_CONFLICT` when the hash differs, call the existing transactional project creation function once, and store its `{ project_id, folder_id }` result before returning. Revoke direct table access from `anon` and `authenticated`; expose only the RPC to `authenticated`.

Change store inputs and DTOs to `projectId?: string | null`. Existing-row validation must use this rule:

```ts
const requestedProjectId = params.projectId ?? null;
if (data.project_id !== requestedProjectId) {
  throw new Error('Conversation project binding does not match the requested context.');
}
```

New inserts write `project_id: requestedProjectId`. Legacy project rows and message persistence are otherwise unchanged.

- [ ] **Step 4: Run database and store tests and verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/20260924130000_global_agent_conversations.sql tests/unit/database/global-agent-conversations-migration.test.ts src/lib/agent/conversation-store.ts tests/unit/agent/conversation-store.test.ts
git commit -m "feat: support account agent conversations"
```

### Task 2: Typed Workspace, Scope, And Account-Capable API

**Files:**
- Create: `src/lib/agent/workspace.ts`
- Create: `tests/unit/agent/workspace.test.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/scope.ts`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/app/api/agent-chat/confirm/route.ts`
- Modify: `tests/unit/agent/scope.test.ts`
- Modify: `tests/unit/agent/route.test.ts`
- Modify: `tests/unit/agent/document-context-route.test.ts`

**Interfaces:**
- Produces: `AgentWorkspace = 'projects' | 'studio' | 'script' | 'create-map' | 'game-design-systems'`.
- Produces: `workspaceAllowsAccountScope(workspace: AgentWorkspace): boolean` and `requireProjectContext(ctx: ToolContext): string`.
- Produces: `ToolContext.projectId?: string`, `ToolContext.userRole?: UserRole`, with required `workspace: AgentWorkspace`.
- Consumes: nullable conversation binding from Task 1.

- [ ] **Step 1: Write scope and route tests**

Cover all five workspace values, reject missing projects for `studio`, accept account scope for `projects`, `script`, `create-map`, and `game-design-systems`, and verify an existing conversation ignores live navigation in favor of stored scope.

Use this table in `workspace.test.ts`:

```ts
it.each([
  ['projects', true],
  ['studio', false],
  ['script', true],
  ['create-map', true],
  ['game-design-systems', true],
] as const)('%s account capability is %s', (workspace, expected) => {
  expect(workspaceAllowsAccountScope(workspace)).toBe(expected);
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/workspace.test.ts tests/unit/agent/scope.test.ts tests/unit/agent/route.test.ts tests/unit/agent/document-context-route.test.ts
```

Expected: FAIL on the expanded enum and account request behavior.

- [ ] **Step 3: Add workspace validation and optional project context**

Implement this public contract in `workspace.ts`:

```ts
export const AGENT_WORKSPACES = [
  'projects',
  'studio',
  'script',
  'create-map',
  'game-design-systems',
] as const;

export function isAgentWorkspace(value: unknown): value is AgentWorkspace {
  return typeof value === 'string' && AGENT_WORKSPACES.includes(value as AgentWorkspace);
}

export function workspaceAllowsAccountScope(workspace: AgentWorkspace): boolean {
  return workspace !== 'studio';
}

export class ProjectContextRequiredError extends Error {
  readonly code = 'PROJECT_CONTEXT_REQUIRED';
}

export function requireProjectContext(ctx: ToolContext): string {
  if (!ctx.projectId) throw new ProjectContextRequiredError('Select a project before using this operation.');
  return ctx.projectId;
}
```

In the POST route, validate `workspace`, derive `requestedProjectId: string | null`, reject an unbound Studio request, and only call `resolveUserRole` when the stored conversation has a project. `resolveScopeFromNavigation` must preserve `workspace` for global scopes. Confirmation resume reconstructs workspace and project solely from stored metadata and binding.

- [ ] **Step 4: Make AI usage binding accept account turns**

Adjust the route call to the existing usage recorder so project ID is omitted for account turns while `userId`, operation, source, and conversation metadata remain populated. Add a route assertion that account turns never pass an empty string as a project ID.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command plus:

```bash
npm run typecheck:api
```

Expected: all selected tests pass and API typecheck exits 0.

- [ ] **Step 6: Commit the scope/API contract**

```bash
git add src/lib/agent/workspace.ts src/lib/agent/types.ts src/lib/agent/scope.ts src/app/api/agent-chat/route.ts src/app/api/agent-chat/confirm/route.ts tests/unit/agent/workspace.test.ts tests/unit/agent/scope.test.ts tests/unit/agent/route.test.ts tests/unit/agent/document-context-route.test.ts
git commit -m "feat: add global agent workspace scope"
```

### Task 3: Workspace History And Runtime Isolation

**Files:**
- Modify: `src/lib/agent/conversation-store.ts`
- Modify: `src/app/api/agent-chat/conversations/route.ts`
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/agentChatRuntimeStore.ts`
- Modify: `src/components/agent/agentChatStorage.ts`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/components/agent/ConversationList.tsx`
- Modify: `tests/unit/agent/agent-chat-runtime-store.test.ts`
- Modify: `tests/unit/agent/conversation-switch-lifecycle-wiring.test.ts`
- Create: `tests/unit/agent/conversation-history-scope.test.tsx`

**Interfaces:**
- Produces: `AgentRuntimeScope { userId?: string; workspace: AgentWorkspace; projectId?: string }`.
- Produces: runtime key `draft:${userId ?? 'anonymous'}:${workspace}:${projectId ?? 'account'}`.
- Produces: history query `GET /api/agent-chat/conversations?workspace=<workspace>&projectId=<uuid>` where `projectId` is absent for account history.
- Produces: history DTO with `projectId: string | null`, `workspace`, and optional `projectName`.

- [ ] **Step 1: Write runtime and history tests**

Verify Projects and Create Map account drafts have different keys, two projects have different keys, changing context does not mutate a bound conversation, legacy rows resolve to `studio`, and history labels show account workspace or project name.

- [ ] **Step 2: Run the tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/agent-chat-runtime-store.test.ts tests/unit/agent/conversation-switch-lifecycle-wiring.test.ts tests/unit/agent/conversation-history-scope.test.tsx
```

Expected: FAIL because runtime and history are keyed only by project.

- [ ] **Step 3: Replace project-only runtime helpers with scope helpers**

Expose these functions from `agentChatRuntimeStore.ts`:

```ts
export function agentRuntimeScopeKey(scope: AgentRuntimeScope): string;
export function getScopedAgentRuntime(scope: AgentRuntimeScope): AgentChatRuntime | undefined;
export function selectScopedAgentRuntime(scope: AgentRuntimeScope, runtimeKey: string): void;
```

Keep project helper wrappers temporarily only where tests or old callers still need them, then migrate `useAgentChat` to the scoped functions. The restoration effect must react to `[ctx.userId, ctx.workspace, ctx.projectId]` and create a local draft without fetching. A saved conversation may be fetched only after `open === true`; opening history and restoring a known saved ID are both gated by that state.

- [ ] **Step 4: Add bounded workspace/project history filtering**

`listConversations` accepts:

```ts
type ConversationFilter = {
  userId: string;
  workspace: AgentWorkspace;
  projectId: string | null;
  limit?: number;
};
```

Clamp `limit` to 50, filter account rows with `.is('project_id', null)`, project rows with `.eq('project_id', projectId)`, and post-filter legacy metadata as Studio. Do not use `listAllConversations` for the panel. Join or separately resolve project display names without exposing inaccessible project content.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Step 2 command and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 6: Commit runtime isolation**

```bash
git add src/lib/agent/conversation-store.ts src/app/api/agent-chat/conversations/route.ts src/components/agent/types.ts src/components/agent/agentChatRuntimeStore.ts src/components/agent/agentChatStorage.ts src/components/agent/useAgentChat.ts src/components/agent/ConversationList.tsx tests/unit/agent/agent-chat-runtime-store.test.ts tests/unit/agent/conversation-switch-lifecycle-wiring.test.ts tests/unit/agent/conversation-history-scope.test.tsx
git commit -m "feat: isolate agent runtime by workspace"
```

### Task 4: Server-Enforced Workspace Tool Bundles

**Files:**
- Create: `src/lib/agent/tools/workspace-policy.ts`
- Create: `tests/unit/agent/workspace-tool-policy.test.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `tests/unit/agent/dynamic-tool-schema.test.ts`
- Modify: `tests/unit/agent/core.test.ts`

**Interfaces:**
- Produces: `getAllowedToolNames(workspace: AgentWorkspace): ReadonlySet<string>`.
- Produces: `resolveAllowedTool(name: string, workspace: AgentWorkspace): AgentTool | undefined`.
- Produces: `createTurnToolSchema(ctx: ToolContext): { get(): Promise<OpenAITool[]>; invalidate(): void }`.
- Consumes: Tool names added in Tasks 5, 8, and 9.

- [ ] **Step 1: Write policy and schema-cache tests**

Assert Projects exposes only `list_projects`, `create_project`, `select_project`, and `set_conversation_option`; Create Map exposes only its six map Tools plus common account/project discovery and conversation settings; GDS exposes only its seven Tools plus common discovery/settings. Assert a disallowed execution returns `TOOL_NOT_AVAILABLE_IN_WORKSPACE` even if a model fabricates the Tool call.

Add a core test where two ReAct iterations occur and `getLibraryProperties` is called once. Add a schema-changing Tool result with a new `schemaChanged: true` field and verify one rebuild before the next model call.

- [ ] **Step 2: Run policy/core tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/workspace-tool-policy.test.ts tests/unit/agent/dynamic-tool-schema.test.ts tests/unit/agent/core.test.ts
```

Expected: FAIL because every workspace receives `allTools` and schemas rebuild every iteration.

- [ ] **Step 3: Implement allowlists and the execution gate**

`workspace-policy.ts` must use literal readonly sets. Studio includes the current registry. Script includes document reads, import, script queries, Story Graph reads/edits, semantic search, project discovery, and conversation settings, but excludes Studio-only library/asset mutation unless already required by the Script workflow.

Change LLM schema construction to filter before dynamic schema injection. Change execution from `resolveTool(name)` to:

```ts
const tool = resolveAllowedTool(call.function.name, ctx.workspace);
if (!tool) {
  return toolError('TOOL_NOT_AVAILABLE_IN_WORKSPACE', call.function.name);
}
```

Apply the same resolution during confirmation resume so an old or tampered pending action cannot bypass the workspace policy.

- [ ] **Step 4: Cache schema once per turn**

Create the schema cache before entering the ReAct loop:

```ts
const toolSchema = createTurnToolSchema(ctx);
let llmTools = await toolSchema.get();
```

Reuse `llmTools` for every iteration. Add `schemaChanged?: boolean` to `ToolResult`; after a successful Tool result with `schemaChanged === true`, call `toolSchema.invalidate()` and assign `llmTools = await toolSchema.get()` once before the next iteration. No other Tool result triggers a rebuild.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Step 2 command and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 6: Commit the Tool security boundary**

```bash
git add src/lib/agent/tools/workspace-policy.ts src/lib/agent/tools/index.ts src/lib/agent/core.ts src/lib/agent/types.ts tests/unit/agent/workspace-tool-policy.test.ts tests/unit/agent/dynamic-tool-schema.test.ts tests/unit/agent/core.test.ts
git commit -m "feat: enforce agent workspace tool bundles"
```

### Task 5: Projects Tools And Typed Navigation

**Files:**
- Create: `src/lib/agent/tools/list-projects.ts`
- Create: `src/lib/agent/tools/create-project.ts`
- Create: `src/lib/agent/tools/select-project.ts`
- Create: `src/lib/agent/project-tool-service.ts`
- Create: `tests/unit/agent/project-tools.test.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/useAgentChat.ts`

**Interfaces:**
- Produces: `AgentNavigationDestination = { kind: 'project'; projectId: string }`.
- Produces: SSE `{ type: 'navigation_requested'; destination: AgentNavigationDestination }`.
- Produces: bounded project summaries `{ id, name, description, role, canRead, canWrite }`.
- Consumes: `createProject(supabase, input)` and current collaborator authorization.

- [ ] **Step 1: Write Tool and navigation tests**

Cover default 20/max 50 pagination, role/capability summaries, idempotent create by `idempotencyKey`, selection by exact ID, unique case-insensitive name, ambiguous-name candidates, inaccessible projects, and rejection of URL-like destinations.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/project-tools.test.ts
```

Expected: FAIL because the Tools and navigation event do not exist.

- [ ] **Step 3: Implement the account project service and Tools**

Use Zod or the repository's existing explicit validators. Tool schemas are:

```ts
type ListProjectsArgs = { cursor?: string; limit?: number };
type CreateProjectArgs = { name: string; description?: string; idempotencyKey: string };
type SelectProjectArgs = { projectId?: string; projectName?: string };
```

The service queries only accepted memberships, orders deterministically by `created_at DESC, id DESC`, and returns at most 50 summaries. Project creation calls `create_project_with_default_resource_idempotent`; the same UUID key and canonical input returns the stored result, while changed input maps the database exception to `IDEMPOTENCY_CONFLICT`.

`select_project` returns `PROJECT_NAME_AMBIGUOUS` plus candidates when more than one normalized name matches. On success it returns a Tool result carrying:

```ts
navigation: { kind: 'project', projectId: verifiedProjectId }
```

Extend core to emit the typed navigation event after a successful Tool result; do not accept a URL from Tool arguments or Tool result data.

- [ ] **Step 4: Handle navigation in the client**

In `useAgentChat`, validate `kind === 'project'` and UUID shape, then call `router.push('/' + projectId)`. Immediately activate a new `studio` project draft; do not mutate the account conversation or send a model request.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Step 2 command, `npm run typecheck`, and `npm run typecheck:api`.

Expected: PASS.

- [ ] **Step 6: Commit Projects capabilities**

```bash
git add src/lib/agent/tools/list-projects.ts src/lib/agent/tools/create-project.ts src/lib/agent/tools/select-project.ts src/lib/agent/project-tool-service.ts src/lib/agent/tools/index.ts src/lib/agent/types.ts src/components/agent/types.ts src/components/agent/useAgentChat.ts tests/unit/agent/project-tools.test.ts
git commit -m "feat: add project assistant tools"
```

### Task 6: Retrieval Latency And Account Isolation

**Files:**
- Modify: `src/lib/agent/embedding-retrieval.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `tests/unit/agent/embedding-retrieval.test.ts`
- Create: `tests/unit/agent/retrieval-performance.test.ts`

**Interfaces:**
- Produces: `RetrieveChunksParams.projectId?: string`.
- Produces: `retrievalScopesForContext(ctx: ToolContext): RetrievalScope[]`.
- Preserves: existing ranking, quotas, deduplication, recency, and max-character behavior.

- [ ] **Step 1: Write concurrency and isolation tests**

Use deferred RPC promises to prove all selected scope calls start before any resolves. Verify global contexts request only `chat_same_conversation`; project contexts retain the configured project scopes. Verify no account call sends `p_project_id: ''` or searches `chat_same_project`, `library`, `design_document`, or `project_document`.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/embedding-retrieval.test.ts tests/unit/agent/retrieval-performance.test.ts
```

Expected: FAIL because scope RPCs run sequentially and project ID is required.

- [ ] **Step 3: Parallelize selected retrieval scopes**

Replace the sequential loop with:

```ts
const batches = await Promise.all(
  scopes
    .filter((scope) => (quotas[scope] ?? 0) > 0)
    .map((scope) => fetchScopeCandidates(
      params.supabase,
      params,
      scope,
      (quotas[scope] ?? 0) * 2,
    )),
);
const candidates = batches.flat();
```

For account scope, pass `projectId: undefined` to the RPC and choose `['chat_same_conversation']`. The embedding request remains single and precedes this concurrent fan-out.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command.

Expected: PASS with unchanged ranking snapshots.

- [ ] **Step 5: Commit the latency change**

```bash
git add src/lib/agent/embedding-retrieval.ts src/lib/agent/core.ts tests/unit/agent/embedding-retrieval.test.ts tests/unit/agent/retrieval-performance.test.ts
git commit -m "perf: parallelize agent retrieval scopes"
```

### Task 7: Route-Aware Global Assistant Host

**Files:**
- Create: `src/components/agent/AssistantHost.tsx`
- Create: `src/lib/agent/client-workspace.ts`
- Create: `tests/unit/agent/assistant-route-coverage.test.ts`
- Create: `tests/unit/agent/assistant-host.test.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/components/agent/ConversationList.tsx`

**Interfaces:**
- Produces: `deriveAgentWorkspaceContext(pathname, navigation, createMapPreference)`.
- Produces: `AssistantHost` as the only Dashboard-level owner of `ChatPanel` visibility.
- Consumes: scoped runtime from Task 3 and existing launcher/panel components unchanged in visual identity.

- [ ] **Step 1: Write the route matrix and closed-state tests**

Cover Projects, representative Studio nested pages, Script root/project/document, Create Map, and GDS root/create as shown. Cover every excluded family. Render the host collapsed with mocked `fetch`, Supabase auth, and conversation APIs; assert `fetch` is never called until panel open or message send.

Assert every covered route contains one `data-testid="agent-launcher"`, and Create Map contains exactly one.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/assistant-route-coverage.test.ts tests/unit/agent/assistant-host.test.tsx tests/unit/create-map/workbench-wiring.test.tsx
```

Expected: FAIL because the current panel is project-only and hidden on Projects, Create Map, and GDS.

- [ ] **Step 3: Implement pure route derivation**

Return `null` for excluded routes and a typed context for covered routes. Match special routes before the generic `/<projectId>` Studio route. The Create Map persisted project is only a client hint:

```ts
export type AgentWorkspaceContext = {
  workspace: AgentWorkspace;
  projectId?: string;
  projectName?: string;
  currentDocumentId?: string;
  currentFolderId?: string;
  currentFolderName?: string;
  currentLibraryId?: string;
  currentLibraryName?: string;
};
```

- [ ] **Step 4: Mount one host and remove the project-only render gate**

Replace `hideChatPanel` branching in `DashboardLayout` with `<AssistantHost />`. Keep `AgentImportBridge` and `RecentVisitTracker` unchanged. `ChatPanel` receives context as a prop and no longer returns `null` when `projectId` is absent.

Do not fetch history during host or collapsed panel mount. Move any automatic restore that requires network behind panel-open state; local runtime restoration remains synchronous.

- [ ] **Step 5: Preserve launcher and context-change behavior**

Reuse the current `bot.svg`, `ChatPanel.module.css` launcher classes, draggable position hook, `title="Keco Assistant"`, and `data-testid="agent-launcher"`. When workspace or project changes, close the open panel, retain the old runtime, and activate the new scoped draft without sending.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 2 command and `npm run typecheck`.

Expected: PASS.

- [ ] **Step 7: Commit the global shell**

```bash
git add src/components/agent/AssistantHost.tsx src/lib/agent/client-workspace.ts src/components/layout/DashboardLayout.tsx src/components/agent/ChatPanel.tsx src/components/agent/useAgentChat.ts src/components/agent/ConversationList.tsx tests/unit/agent/assistant-route-coverage.test.ts tests/unit/agent/assistant-host.test.tsx tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "feat: mount one global assistant host"
```

### Task 8: Create Map Tools And Unified Message Cards

**Files:**
- Create: `src/lib/agent/tools/list-maps.ts`
- Create: `src/lib/agent/tools/read-map.ts`
- Create: `src/lib/agent/tools/create-map-draft.ts`
- Create: `src/lib/agent/tools/generate-map-image.ts`
- Create: `src/lib/agent/tools/get-map-generation-status.ts`
- Create: `src/lib/agent/tools/retry-map-generation.ts`
- Create: `src/components/agent/MapToolResultCard.tsx`
- Create: `tests/unit/agent/create-map-tools.test.ts`
- Create: `tests/unit/agent/map-tool-result-card.test.tsx`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Modify: `src/components/agent/ChatMessage.tsx`
- Modify: `src/components/agent/types.ts`
- Delete: `src/features/create-map/components/MapChatPanel.tsx`

**Interfaces:**
- Consumes: `createMapMcpService(supabase, userId)` and its existing draft, preview, submit, status, and retry methods.
- Produces: Tool result display hint `map` with bounded plan/generation DTOs.
- Produces: Create Map workbench refresh invalidation after draft creation and generation submission.

- [ ] **Step 1: Write map Tool adapter tests**

Cover project-required errors, read access, editor/admin write checks, max-50 listing, project ownership validation for map/revision/asset IDs, draft idempotency, mandatory confirmation preparation, stale confirmation, retry duplicate-billing acknowledgement, and immediate return after provider submission.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/create-map-tools.test.ts tests/unit/agent/map-tool-result-card.test.tsx tests/unit/create-map/workbench-wiring.test.tsx
```

Expected: FAIL because the Agent adapters and shared card do not exist and the workbench still mounts `MapChatPanel`.

- [ ] **Step 3: Implement six thin Tool adapters**

Each Tool calls `requireProjectContext(ctx)` before the domain service. Use these argument contracts:

```ts
type ListMapsArgs = { cursor?: string; limit?: number };
type ReadMapArgs = { mapId: string };
type CreateMapDraftArgs = CreateMapDraftInput;
type GenerateMapImageArgs = { mapId: string; revisionId: string; saveVersion: number };
type MapStatusArgs = { mapId: string; revisionId: string; assetId: string };
type RetryMapGenerationArgs = MapStatusArgs & { acknowledgeDuplicateBilling: boolean };
```

`generate_map_image` and `retry_map_generation` use `confirmationPolicy: 'always'`; `prepareConfirmation` returns the existing exact plan, fee notice, signed binding token, and duplicate-billing warning. Execution passes the sealed args to the existing service. Status executes one read and returns; it contains no loop, timer, recursive Tool call, or retry delay.

- [ ] **Step 4: Move reusable Map UI into Agent messages**

Add `DisplayHint` value `map`. `MapToolResultCard` renders plan title/version, generation status, downloadable image when present, and history summary from Tool data. It must not own the canvas, map browser, project selector, or polling loop.

- [ ] **Step 5: Remove the separate assistant entry**

Remove `<MapChatPanel>` and its message/composer state from `DirectMapWorkbench`. Keep saved maps, canvas, collision controls, source attachment, direct toolbar create/view commands, and generation monitoring owned by the workbench. Dispatch or consume a small `create-map:refresh` event after relevant Agent invalidations so the workbench reloads durable state.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 2 command and:

```bash
npm run test:create-map-v3
npm run typecheck
```

Expected: PASS and exactly one assistant launcher on Create Map.

- [ ] **Step 7: Commit Create Map integration**

```bash
git rm src/features/create-map/components/MapChatPanel.tsx
git add src/lib/agent/tools/list-maps.ts src/lib/agent/tools/read-map.ts src/lib/agent/tools/create-map-draft.ts src/lib/agent/tools/generate-map-image.ts src/lib/agent/tools/get-map-generation-status.ts src/lib/agent/tools/retry-map-generation.ts src/lib/agent/tools/index.ts src/components/agent/MapToolResultCard.tsx src/components/agent/ChatMessage.tsx src/components/agent/types.ts src/features/create-map/DirectMapWorkbench.tsx src/features/create-map/CreateMapWorkbench.module.css tests/unit/agent/create-map-tools.test.ts tests/unit/agent/map-tool-result-card.test.tsx tests/unit/create-map/workbench-wiring.test.tsx
git commit -m "feat: integrate create map with global assistant"
```

### Task 9: Game Design Systems Tools

**Files:**
- Create: `src/lib/agent/tools/list-game-design-systems.ts`
- Create: `src/lib/agent/tools/read-game-design-system.ts`
- Create: `src/lib/agent/tools/generate-game-design-system.ts`
- Create: `src/lib/agent/tools/copy-game-design-system.ts`
- Create: `src/lib/agent/tools/apply-game-design-system.ts`
- Create: `src/lib/agent/tools/generate-gdd.ts`
- Create: `src/lib/agent/tools/get-generation-status.ts`
- Create: `src/lib/agent/game-design-system-tool-service.ts`
- Create: `tests/unit/agent/game-design-system-tools.test.ts`
- Modify: `src/lib/agent/tools/index.ts`
- Modify: `src/components/agent/ChatMessage.tsx`

**Interfaces:**
- Consumes: server functions in `src/lib/services/gameDesignSystemService.ts` and existing generation/GDD job services used by their API routes.
- Produces: bounded system/version summaries and durable GDS/GDD job identities.
- Requires: an explicit target project argument for apply and GDD generation; owner/Admin for apply; Editor/Admin for GDD generation.

- [ ] **Step 1: Write GDS Tool tests**

Cover default 20/max 50 listing, source redaction, bounded version detail, account-scope generation and copying, exact project access checks, version validity, owner/Admin bind policy, Editor/Admin GDD policy, always-confirm GDD warning, job status ownership, and no internal polling.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/agent/game-design-system-tools.test.ts
```

Expected: FAIL because the Tools do not exist.

- [ ] **Step 3: Implement bounded read and account write adapters**

The Tool service must call server-side domain services directly rather than HTTP client wrappers. List results include only ID, title, summary, source, status, latest version, and updated time. Read results include the selected version and a bounded version list; reuse `sourceVisibility.server.ts` so private source snapshots are not leaked.

Generation and copy operations preserve existing normalization and idempotency keys. They return after the generation job is enqueued.

- [ ] **Step 4: Implement project-bound apply and GDD adapters**

Use these project-bound argument contracts so the account-level GDS conversation never infers a target:

```ts
type ApplyGameDesignSystemArgs = {
  projectId: string;
  designSystemId: string;
  versionId: string;
};
type GenerateGddArgs = {
  projectId: string;
  mode: 'quick' | 'professional';
  idempotencyKey: string;
};
```

`apply_game_design_system` revalidates the explicit project role, system visibility, and version ownership before binding. `generate_gdd` revalidates the explicit project, reads its currently pinned version, seals project/version/mode plus warning in `prepareConfirmation`, and uses `confirmationPolicy: 'always'`. Duplicate or ambiguous project names are never accepted by these write Tools; the model must pass the stable ID returned by `list_projects`.

The warning text must state that professional GDD generation may automatically submit up to three paid map images. Execution enqueues the existing job and returns `{ jobId, status }`; it does not poll.

- [ ] **Step 5: Render bounded generation results and verify GREEN**

Reuse generic list/text cards for summaries and add only a small generation status branch in `ChatMessage` when Tool data contains `{ jobType, jobId, status }`.

Run the Step 2 command plus:

```bash
npx jest --runInBand tests/unit/game-design-system-routes.test.ts tests/unit/game-design-system-route-test-boundaries.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit GDS capabilities**

```bash
git add src/lib/agent/tools/list-game-design-systems.ts src/lib/agent/tools/read-game-design-system.ts src/lib/agent/tools/generate-game-design-system.ts src/lib/agent/tools/copy-game-design-system.ts src/lib/agent/tools/apply-game-design-system.ts src/lib/agent/tools/generate-gdd.ts src/lib/agent/tools/get-generation-status.ts src/lib/agent/tools/index.ts src/lib/agent/game-design-system-tool-service.ts src/components/agent/ChatMessage.tsx tests/unit/agent/game-design-system-tools.test.ts
git commit -m "feat: add game design assistant tools"
```

### Task 10: End-To-End Coverage, Performance Guardrails, And Release Verification

**Files:**
- Modify: `tests/e2e/specs/agent-chat.spec.ts`
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Create: `tests/unit/agent/global-assistant-performance.test.tsx`
- Modify: `tests/unit/keco-admin/keco-admin-wiring.test.ts`
- Modify: `tests/unit/keco-101/keco-101-wiring.test.ts`
- Modify: `docs/superpowers/specs/2026-09-24-global-ai-assistant-design.md`

**Interfaces:**
- Validates all acceptance criteria from the approved design.
- Produces no new production interface.

- [ ] **Step 1: Add route and workflow E2E coverage**

Add mocked-provider flows for:

```text
Projects: list -> create -> select -> typed navigation -> new project conversation
Studio: existing document/library workflows remain available
Script: existing import/query/Story Graph workflows remain available
Create Map: draft -> plan preview -> explicit paid confirmation -> queued status
GDS: list -> read -> generate/copy -> apply -> explicit GDD confirmation -> queued status
```

Also assert Simulation and excluded account/admin routes have no launcher, route changes preserve old history, and Create Map has one launcher.

- [ ] **Step 2: Add deterministic performance guard tests**

The component test spies on `fetch` and Supabase query methods and asserts zero calls after rendering a collapsed `AssistantHost`. The Tool test counts schema builder calls across a multi-iteration turn. The retrieval test from Task 6 proves concurrent start order. List Tool tests assert lengths never exceed 50. Async tests fail if status functions are called after enqueue in the same Tool execution.

- [ ] **Step 3: Run focused regression suites**

```bash
npx jest --runInBand tests/unit/agent tests/unit/create-map tests/unit/game-design-system-routes.test.ts tests/unit/game-design-system-route-test-boundaries.test.ts tests/unit/keco-admin/keco-admin-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run static verification**

```bash
npm run lint
npm run typecheck
npm run typecheck:api
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Run browser workflows**

Start the app against the test environment, then run:

```bash
npx playwright test tests/e2e/specs/agent-chat.spec.ts tests/e2e/specs/create-map-v3.spec.ts tests/e2e/specs/game-design-system.spec.ts --workers=1
```

Expected: PASS. Capture desktop and mobile screenshots for Projects, Create Map, and GDS with the same launcher visible and no overlapping controls.

- [ ] **Step 6: Mark the design implemented and commit verification**

Change the design status to `Implemented` only after Steps 3-5 pass, then commit:

```bash
git add tests/e2e/specs/agent-chat.spec.ts tests/e2e/specs/create-map-v3.spec.ts tests/e2e/specs/game-design-system.spec.ts tests/unit/agent/global-assistant-performance.test.tsx tests/unit/keco-admin/keco-admin-wiring.test.ts tests/unit/keco-101/keco-101-wiring.test.ts docs/superpowers/specs/2026-09-24-global-ai-assistant-design.md
git commit -m "test: verify global assistant workflows"
```

### Task 11: Final Review Gate

**Files:**
- Review: all files changed by Tasks 1-10

**Interfaces:**
- Confirms the shipped system matches the approved design and introduces no out-of-scope Tools.

- [ ] **Step 1: Review security and data isolation**

Trace one account request, one project request, one confirmation resume, and one fabricated disallowed Tool call. Confirm stored scope wins over request data, account retrieval cannot see projects, and lost membership blocks project content immediately.

- [ ] **Step 2: Review latency and bounded work**

Confirm collapsed mount has no requests; schema build count is one unless invalidated; retrieval RPCs start concurrently; lists cap at 50; async Tools return after submit/enqueue; no ReAct polling was introduced.

- [ ] **Step 3: Review presentation consistency**

At desktop and mobile widths, compare the launcher on Projects, Studio, Script, Create Map, and GDS. Confirm the asset, 56px dimensions, accessible name, drag behavior, panel shell, and animation are identical, and Create Map contains no second chat composer.

- [ ] **Step 4: Run the complete project gate**

```bash
npm run validate
```

Expected: lint, TypeScript checks, MCP checks/tests, unit tests, storage-write checks, and production build all pass.

- [ ] **Step 5: Record final state**

```bash
git status --short
git log --oneline -12
```

Expected: only pre-existing unrelated user files remain untracked or modified; the feature commits are present in task order.
