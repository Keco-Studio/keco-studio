# Map Conversation Version Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist multiple immutable Plan branches and optional generated Map PNG assets within one Create Map conversation.

**Architecture:** Each conversation Plan receives its own existing linear `map_project`; this preserves the current Draft/Plan/PixelLab lifecycle. New append-only conversations, nodes, and messages point at immutable `map_plan_versions` and generated assets. The current plus-adjacent history button becomes the version library, not a new side panel.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, Zod, Supabase Postgres/RLS/RPCs, Jest, PixelLab.

**Spec:** `docs/superpowers/specs/2026-10-23-map-conversation-version-library-design.md`

## Global Constraints

- Work on `dev-ting`; never run `supabase db reset` or delete project data.
- Do not make `map_revisions` a DAG. Plan branches use distinct `map_projects`.
- Every user change creates a new immutable Plan. Follow-ups require an explicit base Plan and never mutate it.
- A Plan exists in the library before image generation. Every Map belongs to exactly one Plan.
- Existing reference images remain shared; immutable Plan snapshots preserve selected `assetId` and `sha256` values.
- Creating a Plan must never invoke PixelLab. Preserve existing paid confirmation/retry behavior.
- Viewers read/download only; owner/admin/editor roles mutate conversation records or generate Maps.
- Existing standalone/GDD Maps remain readable and are not auto-migrated.

---

## File Structure

- Create `supabase/migrations/20261023090000_map_conversation_version_library.sql`: schema, constraints, RLS, RPCs.
- Create `src/features/create-map/model/mapConversation.ts`: Zod domain schemas/types.
- Create `src/features/create-map/services/mapConversationService.ts`: typed RPC client.
- Create `src/features/create-map/hooks/useMapConversation.ts`: durable query-backed snapshot.
- Create `src/features/create-map/components/MapVersionLibrary.tsx`: version tree in the existing menu button.
- Create `src/features/create-map/components/MapBasePlanPicker.tsx`: required follow-up base selector.
- Modify `src/app/api/create-map/plan/route.ts`: server-resolve immutable base Plan.
- Modify `src/features/create-map/services/createMapService.ts` and `hooks/useDirectMapGeneration.ts`: selected Plan generation and Map-output attachment.
- Modify `src/features/create-map/components/MapChatPanel.tsx`, `DirectMapWorkbench.tsx`, and `CreateMapWorkbench.module.css`: durable cards, composition, opening/version styles.
- Create `tests/unit/database/map-conversation-version-library.behavior.test.ts` and focused unit/component tests below.

## Task 1: Database Conversation Tree

**Files:**
- Create: `supabase/migrations/20261023090000_map_conversation_version_library.sql`
- Create: `tests/unit/database/map-conversation-version-library.behavior.test.ts`
- Modify: `tests/unit/database/create-map-v3-migration.test.ts`

**Interfaces:**
- Consumes: `map_projects`, `map_revisions`, `map_plan_versions`, `map_assets`, `map_require_writer`.
- Produces: `map_conversations`, `map_conversation_nodes`, `map_conversation_messages`; `read_map_conversation_v1`, `claim_map_conversation_plan_v1`, `complete_map_conversation_plan_v1`, `fail_map_conversation_plan_v1`, `attach_map_conversation_output_v1`, `resolve_map_conversation_node_v1`.

- [ ] **Step 1: Write failing live RLS/RPC tests**

```ts
it('creates root and sibling child Plans with immutable snapshot links', async () => {
  const rootClaim = row(await owner.rpc('claim_map_conversation_plan_v1', rootClaimArgs));
  const root = row(await owner.rpc('complete_map_conversation_plan_v1', completeArgs(rootClaim.request_token)));
  const [left, right] = await Promise.all([
    editor.rpc('complete_map_conversation_plan_v1', childArgs(root.plan_node_id, crypto.randomUUID())),
    owner.rpc('complete_map_conversation_plan_v1', childArgs(root.plan_node_id, crypto.randomUUID())),
  ]);
  expect([root.plan_display_version, row(left).plan_display_version, row(right).plan_display_version].sort()).toEqual([1, 2, 3]);
  expect(row(left).parent_plan_node_id).toBe(root.plan_node_id);
  expect(row(left).map_plan_version_id).toEqual(expect.any(String));
});

it('allows a viewer to read but never create a Plan or output', async () => {
  expect((await viewer.rpc('read_map_conversation_v1', { p_conversation_id: conversationId })).error).toBeNull();
  expect((await viewer.rpc('claim_map_conversation_plan_v1', claimArgs)).error?.code).toBe('42501');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/unit/database/map-conversation-version-library.behavior.test.ts --runInBand`

Expected: FAIL because the conversation tables/RPCs are absent.

- [ ] **Step 3: Implement append-only tables and relationship guards**

```sql
create table public.map_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  next_display_version bigint not null default 1 check (next_display_version > 0),
  created_at timestamptz not null default now()
);
create table public.map_conversation_nodes (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.map_conversations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  node_type text not null check (node_type in ('plan', 'map')), plan_display_version bigint check (plan_display_version > 0),
  parent_plan_node_id uuid references public.map_conversation_nodes(id) on delete restrict,
  map_project_id uuid references public.map_projects(id) on delete restrict,
  map_plan_version_id uuid references public.map_plan_versions(id) on delete restrict,
  map_revision_id uuid references public.map_revisions(id) on delete restrict,
  map_asset_id uuid references public.map_assets(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  unique (conversation_id, map_project_id, map_plan_version_id),
  unique (parent_plan_node_id, map_revision_id, map_asset_id)
);
create unique index map_conversation_plan_display_version_idx
  on public.map_conversation_nodes(conversation_id, plan_display_version)
  where node_type = 'plan';
```

Create `map_conversation_messages` with conversation-local sequence, `user`/`assistant` role, optional base/artifact node IDs, and an idempotency key. Use trigger validation to ensure parent/base, map project, immutable Plan version, Map revision, and Map asset all share the correct conversation project. Add update/delete-rejecting triggers for all new tables.

- [ ] **Step 4: Implement atomic RPCs and policies**

```sql
create function public.claim_map_conversation_plan_v1(
  p_project_id uuid, p_conversation_id uuid, p_parent_plan_node_id uuid,
  p_title text, p_user_message text, p_idempotency_key uuid, p_intent_hash text
) returns table (claim_status text, request_token uuid, conversation_id uuid, base_plan_version_id uuid)
language plpgsql security definer set search_path = '';

create function public.complete_map_conversation_plan_v1(
  p_idempotency_key uuid, p_request_token uuid, p_name text,
  p_source_document_id uuid, p_source_document_updated_at timestamptz,
  p_source_epoch bigint, p_source_revision bigint, p_plan jsonb, p_scene jsonb
) returns table (conversation_id uuid, plan_node_id uuid, map_id uuid,
  draft_revision_id uuid, plan_version_id uuid, display_version bigint)
language plpgsql security definer set search_path = '';

create function public.fail_map_conversation_plan_v1(
  p_idempotency_key uuid, p_request_token uuid, p_error_code text, p_error_message text
) returns table (conversation_id uuid, assistant_message_id uuid)
language plpgsql security definer set search_path = '';
```

`p_conversation_id` and `p_parent_plan_node_id` are both nullable only for a root request. In that case, claim must call `map_require_writer`, create and lock a new conversation with `p_title`, append the durable user message, and return its request token. For a child it must lock the existing conversation, verify the selected parent Plan belongs to its project, append the durable user message with `base_plan_node_id`, and return that immutable base snapshot only after authorization. Completion must atomically create the branch `map_project`/Draft, call `save_map_plan_v3`, allocate the next **Plan** display version, and write the Plan node plus assistant artifact message. `fail_map_conversation_plan_v1` consumes the same pending token and appends a failed assistant message without creating a Plan node if the planner rejects a request. Replays with the same hash return the prior result; changed payloads raise `KM409`. `attach_map_conversation_output_v1` validates that the asset/revision belongs to its Plan and upserts one Map child plus message. Map nodes have `plan_display_version = null`; their `Map V{planDisplay}.{map_version_number}` label is derived from the owning Plan and immutable generated revision. The read/resolve RPCs return only authorized ordered snapshots and exact Plan/Map selection metadata.

Enable RLS, grant project collaborator reads, revoke direct writes, grant only authenticated RPC execution, and issue `notify pgrst, 'reload schema'`.

- [ ] **Step 5: Run database tests and commit**

Run: `npm test -- tests/unit/database/map-conversation-version-library.behavior.test.ts tests/unit/database/create-map-v3-migration.test.ts --runInBand`

Expected: PASS for Plan-only nodes, viewer controls, cross-project rejection, output ownership, retry idempotency, and concurrent sibling branches.

```bash
git add supabase/migrations/20261023090000_map_conversation_version_library.sql tests/unit/database/map-conversation-version-library.behavior.test.ts tests/unit/database/create-map-v3-migration.test.ts && git commit -m "feat: persist map conversation version trees"
```

## Task 2: Conversation Client Model and Service

**Files:**
- Create: `src/features/create-map/model/mapConversation.ts`
- Create: `src/features/create-map/services/mapConversationService.ts`
- Create: `src/features/create-map/hooks/useMapConversation.ts`
- Create: `tests/unit/create-map/map-conversation-service.test.ts`

**Interfaces:**
- Consumes: Task 1 RPCs, `MapPlanV3`, `MapSceneV3`, `MapDraftIdentity`, `MapAssetRecord`.
- Produces: `MapConversationSnapshot`, `MapConversationPlanNode`, `MapConversationMapNode`, and `createMapConversationService`.

- [ ] **Step 1: Write failing parser/service tests**

```ts
it('lists Plan-only nodes as valid bases', async () => {
  const snapshot = await service.readConversation(conversationId);
  expect(snapshot.planNodes.map((node) => node.displayLabel)).toEqual(['Plan V1']);
  expect(snapshot.planNodes[0].maps).toEqual([]);
});
it('resolves a Map node through its owning Plan', async () => {
  const resolved = await service.resolveNode(mapNodeId);
  expect(resolved.planNodeId).toBe(planNodeId);
  expect(resolved.selectedMap?.assetId).toBe(assetId);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/unit/create-map/map-conversation-service.test.ts --runInBand`

Expected: FAIL because the model/service/hook do not exist.

- [ ] **Step 3: Implement strict schemas, service, and query hook**

```ts
export type MapConversationService = {
  readConversation(conversationId: string): Promise<MapConversationSnapshot>;
  claimPlan(input: ClaimConversationPlanInput): Promise<ClaimedConversationPlan>;
  completePlan(input: CompleteConversationPlanInput): Promise<CreatedConversationPlan>;
  resolveNode(nodeId: string): Promise<ResolvedConversationNode>;
  attachGeneratedMap(input: AttachGeneratedMapInput): Promise<MapConversationMapNode>;
};
export function useMapConversation(projectId: string, conversationId: string | null) {
  return useQuery({ queryKey: ['create-map', 'conversation', projectId, conversationId], queryFn: () => service.readConversation(conversationId!), enabled: Boolean(projectId && conversationId), staleTime: 5_000 });
}
```

Use a Zod discriminated union for Plan/Map nodes, camel-case the RPC payload, reject malformed ownership/type/timestamp values, and calculate idempotency intent hashes from canonical project/conversation/base/request/source/reference JSON instead of mutable Draft data.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/unit/create-map/map-conversation-service.test.ts --runInBand`

Expected: PASS for parser rejection, Plan-only filtering, Map resolution, and durable reconstruction.

```bash
git add src/features/create-map/model/mapConversation.ts src/features/create-map/services/mapConversationService.ts src/features/create-map/hooks/useMapConversation.ts tests/unit/create-map/map-conversation-service.test.ts && git commit -m "feat: add map conversation client service"
```

## Task 3: Server-Resolve Explicit Base Plans

**Files:**
- Modify: `src/app/api/create-map/plan/route.ts`
- Modify: `tests/unit/create-map/create-map-plan-route.test.ts`

**Interfaces:**
- Consumes: `conversationId`, `basePlanNodeId`, Task 1 node resolver.
- Produces: a planner payload derived from the immutable server-resolved base; no node persistence inside the route.

- [ ] **Step 1: Write failing route tests**

```ts
it('rejects a non-root request without a base Plan', async () => {
  const response = await POST(request({ projectId, conversationId, description: 'Move the dock east' }));
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'base_plan_required' });
});
it('does not plan from a foreign or stale base node', async () => {
  const response = await POST(request({ projectId, conversationId, basePlanNodeId: foreignNodeId, description: 'Add a dock' }));
  expect(response.status).toBe(403);
  expect(mockCreateMapPlanV3).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/unit/create-map/create-map-plan-route.test.ts --runInBand`

Expected: FAIL because request validation has no conversation/base fields.

- [ ] **Step 3: Validate the request and resolve before LLM use**

```ts
const Body = z.object({ projectId: z.string().uuid(), conversationId: z.string().uuid().nullable().default(null), basePlanNodeId: z.string().uuid().nullable().default(null), description: z.string().trim().max(4_000).default('') /* retained fields */ }).strict()
  .superRefine((value, ctx) => { if (value.conversationId && !value.basePlanNodeId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['basePlanNodeId'], message: 'base_plan_required' }); });
```

Root planning requires both IDs to be null. Follow-up planning resolves the authorized node before `createMapPlanV3`, verifies conversation/project, and passes snapshot plan/source/reference hashes as base context. Return 403/404 before calling the planner for inaccessible, foreign, stale, or non-Plan nodes. The subsequent claim call, rather than this route, stores the durable user message so a planner failure can be recorded by a second `fail_map_conversation_plan_v1` RPC using the same request token.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/unit/create-map/create-map-plan-route.test.ts --runInBand`

Expected: PASS with existing root/source/reference/unsafe-description coverage retained.

```bash
git add src/app/api/create-map/plan/route.ts tests/unit/create-map/create-map-plan-route.test.ts && git commit -m "feat: resolve map conversation base plans server side"
```

## Task 4: Attach Generation Outputs to Plans

**Files:**
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `src/features/create-map/hooks/useDirectMapGeneration.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`
- Modify: `tests/unit/create-map/direct-map-generation-hook.test.ts`

**Interfaces:**
- Consumes: `planVersionId`, `planNodeId`, six-argument `prepare_map_generation_v3`, Task 2 attachment.
- Produces: `onMapOutputCreated({ planNodeId, revisionId, assetId, status })`.

- [ ] **Step 1: Write the failing selected-Plan generation test**

```ts
it('binds generation to the selected immutable Plan and attaches one child Map', async () => {
  await result.current.generate();
  expect(rpc).toHaveBeenCalledWith('prepare_map_generation_v3', expect.objectContaining({ p_plan_version_id: planVersionId }));
  expect(attachGeneratedMap).toHaveBeenCalledWith({ planNodeId, revisionId, assetId });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/direct-map-generation-hook.test.ts --runInBand`

Expected: FAIL because generation has no conversation owner.

- [ ] **Step 3: Implement selected snapshot preparation and status attachment**

```ts
prepareGenerationV3(identity, options: { planVersionId: string; planNodeId?: string }): Promise<PreparedMapGeneration>
onMapOutputCreated?: (output: { planNodeId: string; revisionId: string; assetId: string; status: MapAssetRecord['status'] }) => Promise<void>
```

Conversation generation uses the six-argument RPC. For queued/generating/ready/failed outputs, attach/upsert the Map child and invalidate the conversation query. The attachment must return the owning Plan's display version and generated revision's `map_version_number` so the UI derives `Map V{plan}.{map}` without consuming another Plan version. Retain the existing standalone path and ensure Plan completion alone cannot submit to PixelLab.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/direct-map-generation-hook.test.ts --runInBand`

Expected: PASS for immutable Plan binding, idempotent Map output, and unchanged standalone generation.

```bash
git add src/features/create-map/services/createMapService.ts src/features/create-map/hooks/useDirectMapGeneration.ts tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/direct-map-generation-hook.test.ts && git commit -m "feat: attach generated maps to conversation plans"
```

## Task 5: Version Library and Base Picker

**Files:**
- Create: `src/features/create-map/components/MapVersionLibrary.tsx`
- Create: `src/features/create-map/components/MapBasePlanPicker.tsx`
- Modify: `src/features/create-map/components/MapChatPanel.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Create: `tests/unit/create-map/map-version-library.test.tsx`
- Create: `tests/unit/create-map/map-base-plan-picker.test.tsx`
- Modify: `tests/unit/create-map/map-chat-panel.test.tsx`

**Interfaces:**
- Consumes: snapshot, selected node ID, node callback, Plan-only base options.
- Produces: accessible plus-adjacent version tree and required base selection control.

- [ ] **Step 1: Write failing component tests**

```tsx
it('lists Plan-only and nested Map assets through the existing history trigger', async () => {
  render(<MapVersionLibrary snapshot={snapshot} selectedNodeId={null} onSelectNode={onSelectNode} />);
  await user.click(screen.getByRole('button', { name: /version library/i }));
  expect(screen.getByRole('menuitem', { name: /Plan V1/i })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: /Map V2.1.*Generating/i })).toBeVisible();
});
it('blocks follow-up send until a base Plan is selected', () => {
  render(<MapBasePlanPicker isRoot={false} plans={plans} value={null} onChange={onChange} />);
  expect(screen.getByText(/select a base plan/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the component tests and confirm they fail**

Run: `npm test -- tests/unit/create-map/map-version-library.test.tsx tests/unit/create-map/map-base-plan-picker.test.tsx tests/unit/create-map/map-chat-panel.test.tsx --runInBand`

Expected: FAIL because the tree/base picker do not exist.

- [ ] **Step 3: Implement accessible nodes and durable artifacts**

```tsx
<MapBasePlanPicker isRoot={snapshot === null || snapshot.planNodes.length === 0} plans={snapshot?.planNodes ?? []} value={basePlanNodeId} onChange={setBasePlanNodeId} disabled={busy || readOnly} />
```

Reuse the button directly right of plus; do not introduce a side library. Plan rows work without Map children; nested Map rows show queued/generating/ready/failed status. Support keyboard navigation, Enter and Escape. Artifact cards take node IDs rather than inferring card type from message text; Map selection opens its owning Plan.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- tests/unit/create-map/map-version-library.test.tsx tests/unit/create-map/map-base-plan-picker.test.tsx tests/unit/create-map/map-chat-panel.test.tsx --runInBand`

Expected: PASS for Plan-only visibility, keyboard access, explicit base, Map status, and Map-to-Plan selection.

```bash
git add src/features/create-map/components/MapVersionLibrary.tsx src/features/create-map/components/MapBasePlanPicker.tsx src/features/create-map/components/MapChatPanel.tsx src/features/create-map/CreateMapWorkbench.module.css tests/unit/create-map/map-version-library.test.tsx tests/unit/create-map/map-base-plan-picker.test.tsx tests/unit/create-map/map-chat-panel.test.tsx && git commit -m "feat: add map conversation version library"
```

## Task 6: Workbench Integration and Verification

**Files:**
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Modify: `tests/unit/create-map/workbench-refresh.test.tsx`

**Interfaces:**
- Consumes: Tasks 2-5 and retained Draft/Saved Maps behavior.
- Produces: durable root/child requests, node opening, refresh reconstruction, generation refresh.

- [ ] **Step 1: Write failing workbench integration tests**

```tsx
it('rebuilds Plan-only conversation history after remount', async () => {
  const { unmount } = render(<DirectMapWorkbench />); await screen.findByText('Plan V1'); unmount(); render(<DirectMapWorkbench />);
  expect(await screen.findByText('Plan V1')).toBeVisible(); expect(screen.queryByText('Map V1.1')).not.toBeInTheDocument();
});
it('opens a Map node through its Plan and exact output', async () => {
  render(<DirectMapWorkbench />); await user.click(await screen.findByRole('menuitem', { name: /Map V2.1/i }));
  expect(mockLoadSavedMapV3).toHaveBeenCalledWith(ownerMapProjectId);
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npm test -- tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx --runInBand`

Expected: FAIL because `chatMessages` and `nextMessageId()` are browser-only state.

- [ ] **Step 3: Replace browser-only chat and open nodes through their immutable snapshot**

Delete `chatMessages`/`nextMessageId`. Track active conversation, selected node, and selected base IDs. Root claims a new conversation first; child claims the explicit base first. Both invoke the planner route with their returned conversation/base IDs, complete the Plan when planning succeeds, or call `fail_map_conversation_plan_v1` when it fails, then refresh the query.

```ts
const openConversationNode = async (nodeId: string) => {
  const resolved = await conversationService.resolveNode(nodeId);
  const loaded = await service.loadSavedMapV3(resolved.mapProjectId);
  const prepared = await generation.prepareRestore(loaded, resolved.selectedMap?.assetId ?? null);
  setPlan(resolved.plan); setScene(prepared.scene); draft.install(loaded); setSelectedNodeId(nodeId);
};
```

Never prepare a historical conversation node from its stale browser Draft save version. Preserve `SavedMapsPanel` for standalone Maps; no automatic conversion/backfill.

- [ ] **Step 4: Run integration, live, lint, and build verification**

Run: `npm test -- tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx tests/unit/database/map-conversation-version-library.behavior.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts --runInBand && npm run lint && npm run build`

Expected: PASS. Confirm every modification creates a new Plan, a base is always explicit, Plan-only assets survive refresh, Maps resolve to their Plan/output, collaborator privileges work, and existing standalone/GDD/PixelLab coverage remains green.

- [ ] **Step 5: Commit and review final diff**

```bash
git add src/features/create-map/DirectMapWorkbench.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx && git commit -m "feat: persist create map conversations" && git status --short && git diff HEAD~1..HEAD --check
```
