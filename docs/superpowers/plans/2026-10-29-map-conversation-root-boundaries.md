# Map Conversation Root Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give every GDD Map its own conversation rooted at `Plan V1`, preserve existing trees through an atomic split migration, and stop exposing storage revision numbers as user-facing versions.

**Architecture:** Add unique `root_map_project_id` metadata and a one-root index to `map_conversations`. Bind GDD conversations by each artifact's Map project, migrate historical root trees into separate conversations, and derive UI labels from conversation Plan/Map nodes.

**Tech Stack:** Supabase PostgreSQL migrations/RPCs, Next.js React, TypeScript, Jest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-map-conversation-root-boundaries-design.md`

## Global Constraints

- One conversation has exactly one root Plan.
- A root Plan may come from one GDD Map brief or a user-created Map.
- Different Map briefs from one GDD job create different conversations.
- Selecting a historical Map resolves to its owning Plan and creates a child Plan in that conversation.
- Preserve all existing IDs and rows; do not reset Supabase or delete project data.
- User-facing labels never use `map_revisions.revision_number`.
- Do not stage or revert unrelated pre-existing dirty-worktree changes.

---

### Task 1: Write Failing Database Tests

**Files:**
- Modify: `tests/unit/database/gdd-map-plan-binding.behavior.test.ts`
- Create: `tests/unit/database/map-conversation-root-boundaries-migration.test.ts`
- Modify: `tests/unit/database/map-conversation-version-library-migration.test.ts`
- Modify: `tests/unit/database/agent-map-conversation-binding-migration.test.ts`

- [ ] **Step 1: Change the live GDD expectation**

After preparing two artifacts from the same `gdd_generation_job`, assert that their Plan nodes have different `conversation_id` values, both have `plan_display_version = 1`, and each conversation's `root_map_project_id` equals its own `map_project_id`:

```ts
const rows = await fx.svc.from('map_conversation_nodes')
  .select('conversation_id,plan_display_version,map_project_id')
  .in('map_project_id', [firstMapId, secondMapId])
  .eq('node_type', 'plan');
expect(rows.error).toBeNull();
expect(rows.data).toHaveLength(2);
expect(new Set(rows.data?.map((row) => row.conversation_id)).size).toBe(2);
expect(rows.data?.every((row) => row.plan_display_version === 1)).toBe(true);
```

Fetch `map_conversations.root_map_project_id` for both rows and assert the root identity matches.

- [ ] **Step 2: Add a one-root live behavior test**

Create a root Plan through `create_map_conversation_plan_v1`, call the same RPC again with that conversation ID and a null parent, and assert it rejects without adding a second root. The final query must return exactly one row where `parent_plan_node_id is null`.

- [ ] **Step 3: Add migration contract tests**

Read `supabase/migrations/20261029130000_map-conversation-root-boundaries.sql` and assert it contains:

```ts
expect(sql).toContain('add column if not exists root_map_project_id');
expect(sql).toContain('drop index if exists public.map_conversations_gdd_generation_job_idx');
expect(sql).toContain('map_conversations_root_map_project_idx');
expect(sql).toContain('map_conversation_one_root_plan_idx');
expect(sql).toContain('root_map_project_id = v_artifact.map_project_id');
expect(sql).toContain('row_number() over');
```

Also assert the Agent binding migration contract includes `root_map_project_id` on its root insert.

- [ ] **Step 4: Run RED**

```bash
npm test -- tests/unit/database/gdd-map-plan-binding.behavior.test.ts tests/unit/database/map-conversation-root-boundaries-migration.test.ts --runInBand
```

The new migration contract and changed live expectation must fail before production code is changed.

---

### Task 2: Implement Root Metadata And Historical Split

**Files:**
- Create: `supabase/migrations/20261029130000_map-conversation-root-boundaries.sql`
- Modify: `tests/unit/database/gdd-map-plan-binding.behavior.test.ts`
- Modify: `tests/unit/database/map-conversation-version-library-migration.test.ts`
- Modify: `tests/unit/database/agent-map-conversation-binding-migration.test.ts`

- [ ] **Step 1: Add root metadata and indexes**

Add `root_map_project_id uuid references public.map_projects(id) on delete restrict`, temporarily nullable for backfill. Drop the unique GDD-job index and recreate it as a non-unique provenance index. Add:

```sql
create unique index map_conversations_root_map_project_idx
  on public.map_conversations(root_map_project_id);
create unique index map_conversation_one_root_plan_idx
  on public.map_conversation_nodes(conversation_id)
  where node_type = 'plan' and parent_plan_node_id is null;
```

- [ ] **Step 2: Split historical GDD trees in one transaction**

Disable only `map_conversations_immutable`, `map_conversation_nodes_immutable`, and `map_conversation_messages_immutable`. Build temporary root/target tables from every GDD conversation's root Plan (`parent_plan_node_id is null`). Keep the earliest root's conversation ID and create one target conversation per additional root, using the root Map project name and its artifact's `gdd_generation_job_id`.

Build a recursive node map from each root through Plan descendants and Map children. Update node `conversation_id` and Plan `plan_display_version` using `row_number() over (partition by target_conversation order by created_at, id)`. Update messages through `artifact_node_id` or `base_plan_node_id`; update completed requests through `plan_node_id`. Re-number `sequence_number` locally with `row_number() over (partition by conversation_id order by created_at, id)`. Preserve every original node, message, request, Map, revision, asset, and Plan snapshot ID.

Before re-enabling triggers, raise an exception if any target has zero/multiple roots, a node/message/request has a mismatched project, or any GDD root lacks a target. PostgreSQL must roll back the complete split on failure.

- [ ] **Step 3: Backfill and enforce root identity**

For every conversation, set `root_map_project_id` from its sole root Plan. Set `next_plan_display_version` to local Plan count plus one. Change the shared GDD fallback title to the root Map project name, preserving user-authored direct/Agent titles. Assert every conversation has exactly one root, then set the column `NOT NULL`.

- [ ] **Step 4: Recreate GDD and direct-root RPC paths**

Recreate `ensure_gdd_map_artifact_conversation_v1` to select by `conversation.root_map_project_id = v_artifact.map_project_id`; insert new GDD conversations with that field and the Map name. Recreate `create_map_conversation_plan_v1` so a root request creates/saves its Map project before inserting the conversation, then inserts the conversation with `root_map_project_id` and Plan V1. Follow-ups retain the existing parent conversation and local counter. Update node validation to require root Map project equality; the partial index rejects a second root.

- [ ] **Step 5: Update Agent root binding**

Recreate `attach_map_conversation_plan_to_agent_v1` so a new Agent-backed root inserts `root_map_project_id = p_map_id`. Existing Agent conversations are backfilled from their root Plan and must use the same one-root invariant.

- [ ] **Step 6: Run GREEN database tests**

```bash
npm test -- tests/unit/database/gdd-map-plan-binding.behavior.test.ts tests/unit/database/map-conversation-root-boundaries-migration.test.ts tests/unit/database/map-conversation-version-library-migration.test.ts tests/unit/database/agent-map-conversation-binding-migration.test.ts --runInBand
RUN_DB_TESTS=1 npm test -- tests/unit/database/gdd-map-plan-binding.behavior.test.ts --runInBand
```

The live command may be skipped when credentials are unavailable; record that limitation rather than claiming live verification.

- [ ] **Step 7: Commit the database change**

```bash
git add supabase/migrations/20261029130000_map-conversation-root-boundaries.sql tests/unit/database/gdd-map-plan-binding.behavior.test.ts tests/unit/database/map-conversation-root-boundaries-migration.test.ts tests/unit/database/map-conversation-version-library-migration.test.ts tests/unit/database/agent-map-conversation-binding-migration.test.ts
git commit -m "fix: isolate map conversations by root plan"
```

---

### Task 3: Replace Revision Labels With Semantic Labels

**Files:**
- Modify: `src/features/create-map/model/mapConversation.ts`
- Create: `tests/unit/create-map/map-conversation-labels.test.ts`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Modify: `tests/unit/create-map/workbench-refresh.test.tsx`

- [ ] **Step 1: Write failing helper tests**

Add a Plan V1 with a Map V1.1 and test:

```ts
expect(getMapConversationLabels(snapshot, planId, mapRevisionId)).toEqual({
  planLabel: 'Plan V1', canvasLabel: 'Map V1.1',
});
expect(getMapConversationLabels(snapshot, planId, null)).toEqual({
  planLabel: 'Plan V1', canvasLabel: 'Plan V1',
});
```

Also test a missing Plan returns both labels as `null`, and add a wiring assertion that `DirectMapWorkbench` no longer formats `draft.identity.revisionNumber` as a user-facing label.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/create-map/map-conversation-labels.test.ts tests/unit/create-map/workbench-wiring.test.tsx --runInBand
```

- [ ] **Step 3: Implement and wire the helper**

Export from `mapConversation.ts`:

```ts
export function getMapConversationLabels(snapshot: MapConversationSnapshot | null, planNodeId: string | null, revisionId: string | null) {
  const plan = snapshot?.planNodes.find((node) => node.id === planNodeId);
  if (!plan) return { planLabel: null, canvasLabel: null };
  const map = revisionId ? plan.maps.find((node) => node.revisionId === revisionId) : null;
  return { planLabel: plan.displayLabel, canvasLabel: map?.displayLabel ?? plan.displayLabel };
}
```

Use `canvasLabel` for the canvas/resource cards and `planLabel` for `DirectMapPlanInspector`. Use the existing active Plan label only as a loading fallback; never use `draft.identity.revisionNumber`. Keep the separate generation-history menu's internal `V${revision.revisionNumber}` labels unchanged.

- [ ] **Step 4: Verify historical Map selection**

Extend `workbench-refresh.test.tsx` with a Map node whose owning Plan is `Plan V1`, select it, and assert the resolved `planNodeId` becomes both active and base. Assert the details label is `Plan V1` and a matching image revision produces `Map V1.1`.

- [ ] **Step 5: Run GREEN UI tests**

```bash
npm test -- tests/unit/create-map/map-conversation-labels.test.ts tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx --runInBand
```

- [ ] **Step 6: Commit the UI change**

```bash
git add src/features/create-map/model/mapConversation.ts src/features/create-map/DirectMapWorkbench.tsx tests/unit/create-map/map-conversation-labels.test.ts tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx
git commit -m "fix: show semantic map conversation versions"
```

---

### Task 4: Full Verification

- [ ] **Step 1: Run all affected unit tests**

```bash
npm test -- tests/unit/database/gdd-map-plan-binding.behavior.test.ts tests/unit/database/map-conversation-root-boundaries-migration.test.ts tests/unit/database/map-conversation-version-library-migration.test.ts tests/unit/database/agent-map-conversation-binding-migration.test.ts tests/unit/create-map/map-conversation-labels.test.ts tests/unit/create-map/map-conversation-service.test.ts tests/unit/create-map/map-chat-panel.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/workbench-refresh.test.tsx --runInBand
```

- [ ] **Step 2: Run static checks**

```bash
npm run lint -- --file src/features/create-map/model/mapConversation.ts --file src/features/create-map/DirectMapWorkbench.tsx
npm run typecheck
git diff HEAD~2..HEAD --check
```

- [ ] **Step 3: Run Create Map E2E when the app server is available**

```bash
npx playwright test tests/e2e/specs/create-map-v3.spec.ts --grep "Plan V1|Map V1|conversation"
```

- [ ] **Step 4: Review migration safety**

Confirm no `delete` or `truncate` targets domain rows, all three disabled triggers are re-enabled, and the migration raises before `root_map_project_id set not null` on any incomplete tree. Leave unrelated dirty files untouched.
