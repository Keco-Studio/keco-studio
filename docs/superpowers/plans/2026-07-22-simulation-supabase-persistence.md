# Simulation Supabase Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native simulation workbench's browser-local session storage with private, project-scoped Supabase persistence that rejects stale writes.

**Architecture:** Store one `SimulationStateV1` JSONB snapshot per authenticated user and Studio project. All mutations go through compare-and-swap RPCs; an async repository validates snapshots and a single-flight save queue coalesces reducer changes while surfacing transient failures and revision conflicts to the provider and workbench.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Supabase PostgreSQL/PostgREST, Zod, Jest, gated local-Supabase RLS tests

---

## File Map

- Create `supabase/migrations/20260722000000_simulation_states.sql`: table, RLS, grants, and compare-and-swap save/reset functions.
- Create `tests/unit/database/simulation-states-migration.test.ts`: static migration contract.
- Create `tests/unit/database/simulation-states.rls.behavior.test.ts`: gated real-Postgres authorization and concurrency behavior.
- Modify `src/lib/simulation/storage.ts`: retain Zod validation and replace the synchronous `Storage` adapter with an async Supabase repository.
- Rewrite `tests/unit/simulation/storage.test.ts`: repository parsing, validation, RPC, and error classification.
- Create `src/lib/simulation/SimulationSaveQueue.ts`: framework-free, single-flight save coordinator.
- Create `tests/unit/simulation/simulation-save-queue.test.ts`: coalescing, retry, conflict, and stop behavior.
- Modify `src/lib/simulation/SimulationSessionProvider.tsx`: hydrate from Supabase, own revision/queue lifecycle, and expose recovery actions.
- Modify `src/components/simulation/workbench/SimulationToast.tsx`: named action button for retry/load/reset.
- Modify `src/components/simulation/workbench/SimulationWorkbench.tsx`: hydration/error states and persistence recovery actions.
- Modify `src/components/simulation/workbench/SimulationWorkbench.module.css`: stable toast action styling.
- Modify simulation provider/workbench tests to cover the new wiring.
- Modify `docs/architecture/ARCHITECTURE.md`: make Supabase the authoritative simulation store.

### Task 1: Add The Simulation State Table And Atomic RPCs

**Files:**
- Create: `tests/unit/database/simulation-states-migration.test.ts`
- Create: `tests/unit/database/simulation-states.rls.behavior.test.ts`
- Create: `supabase/migrations/20260722000000_simulation_states.sql`

- [ ] **Step 1: Write the failing static migration test**

Create `tests/unit/database/simulation-states-migration.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260722000000_simulation_states.sql',
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('simulation states migration', () => {
  it('creates one constrained versioned snapshot per user and project', () => {
    expect(sql).toMatch(/create table public\.simulation_states/i);
    expect(sql).toMatch(/primary key \(user_id, project_id\)/i);
    expect(sql).toMatch(/state_version = 1/i);
    expect(sql).toMatch(/jsonb_typeof\(state\) = 'object'/i);
    expect(sql).toMatch(/revision >= 1/i);
  });

  it('allows only the owning user with accepted project access to read', () => {
    expect(sql).toContain('is_project_owner');
    expect(sql).toContain('is_accepted_collaborator');
    expect(sql).not.toContain('user_has_project_access');
    expect(sql).toMatch(/grant select on public\.simulation_states to authenticated/i);
    expect(sql).toMatch(/revoke insert, update, delete on public\.simulation_states from authenticated/i);
  });

  it('forces writes and resets through revision-aware functions', () => {
    expect(sql).toContain('save_simulation_state');
    expect(sql).toContain('reset_simulation_state');
    expect(sql).toMatch(/p_expected_revision/i);
    expect(sql).toMatch(/revision = p_expected_revision/i);
    expect(sql).toMatch(/revision = simulation_states\.revision \+ 1/i);
    expect(sql).toMatch(/set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.save_simulation_state/i);
  });
});
```

- [ ] **Step 2: Run the static test and verify it fails**

Run:

```bash
npx jest tests/unit/database/simulation-states-migration.test.ts --runInBand
```

Expected: FAIL because `20260722000000_simulation_states.sql` does not exist.

- [ ] **Step 3: Create the constrained table and read policy**

Start `supabase/migrations/20260722000000_simulation_states.sql` with:

```sql
create table public.simulation_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  state_version integer not null,
  state jsonb not null,
  revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id),
  constraint simulation_states_version_check check (state_version = 1),
  constraint simulation_states_state_object_check check (jsonb_typeof(state) = 'object'),
  constraint simulation_states_revision_check check (revision >= 1)
);

create trigger simulation_states_updated_at
  before update on public.simulation_states
  for each row execute function public.update_updated_at_column();

alter table public.simulation_states enable row level security;

create policy simulation_states_select_own_accessible
  on public.simulation_states for select
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_insert_own_accessible
  on public.simulation_states for insert
  with check (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_update_own_accessible
  on public.simulation_states for update
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  )
  with check (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

create policy simulation_states_delete_own_accessible
  on public.simulation_states for delete
  using (
    (select auth.uid()) = user_id
    and (
      public.is_project_owner(project_id, (select auth.uid()))
      or public.is_accepted_collaborator(project_id, (select auth.uid()))
    )
  );

grant select on public.simulation_states to authenticated;
revoke insert, update, delete on public.simulation_states from authenticated;
grant select, insert, update, delete on public.simulation_states to service_role;
```

- [ ] **Step 4: Add the compare-and-swap functions**

Define `save_simulation_state(p_project_id uuid, p_expected_revision bigint, p_state_version integer, p_state jsonb)` as `security definer`, `set search_path = ''`, returning `table(status text, revision bigint)`. Derive the user only from `auth.uid()` and validate access explicitly:

```sql
v_user_id := auth.uid();
if v_user_id is null then raise exception 'not authenticated'; end if;
if not (
  public.is_project_owner(p_project_id, v_user_id)
  or public.is_accepted_collaborator(p_project_id, v_user_id)
) then raise exception 'project access denied'; end if;
if p_expected_revision < 0 or p_state_version <> 1
   or jsonb_typeof(p_state) <> 'object' then
  raise exception 'invalid simulation state';
end if;
```

For revision `0`, use `insert ... on conflict do nothing returning simulation_states.revision into v_revision`; return `('saved', 1)` only when inserted and `('conflict', null)` otherwise. For existing rows, use one guarded update:

```sql
update public.simulation_states
set state_version = p_state_version,
    state = p_state,
    revision = simulation_states.revision + 1
where user_id = v_user_id
  and project_id = p_project_id
  and revision = p_expected_revision
returning simulation_states.revision into v_revision;
```

Return `saved` when updated and `conflict` otherwise. Define `reset_simulation_state(p_project_id uuid, p_expected_revision bigint)` with the same checks. Delete only at the expected revision, treat an absent row at expected revision `0` as reset, and return conflict otherwise. Revoke public execution and grant execution to `authenticated` for both functions. End with `notify pgrst, 'reload schema';`.

- [ ] **Step 5: Run the static test and verify it passes**

Run:

```bash
npx jest tests/unit/database/simulation-states-migration.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Write gated real-Postgres behavior tests**

Create `tests/unit/database/simulation-states.rls.behavior.test.ts` using `buildProjectFixture()` and `teardownProjectFixture()`. Use:

```ts
const freshState = { version: 1, activeSessionId: null, sessions: [] };
const save = (client: SupabaseClient, projectId: string, revision: number) =>
  client.rpc('save_simulation_state', {
    p_project_id: projectId,
    p_expected_revision: revision,
    p_state_version: 1,
    p_state: freshState,
  });
```

Assert creation returns `[{ status: 'saved', revision: 1 }]`. Race two saves at revision `1` and assert one returns `saved` and one `conflict`. Iterate owner/admin/editor/viewer to prove each can create and read only their own row. Assert outsider and a pending collaborator cannot select or call the RPC, direct authenticated insert fails, stale reset returns conflict, and project deletion cascades rows.

- [ ] **Step 7: Run and commit the database slice**

Run:

```bash
npx jest tests/unit/database/simulation-states-migration.test.ts tests/unit/database/simulation-states.rls.behavior.test.ts --runInBand
```

Expected: static test PASS; behavior suite SKIP unless `RLS_DB_TESTS=1` points to local Supabase, otherwise PASS.

Commit:

```bash
git add supabase/migrations/20260722000000_simulation_states.sql tests/unit/database/simulation-states-migration.test.ts tests/unit/database/simulation-states.rls.behavior.test.ts
git commit -m "feat(simulation): add revisioned cloud state storage"
```

### Task 2: Replace The Browser Adapter With A Supabase Repository

**Files:**
- Modify: `tests/unit/simulation/storage.test.ts`
- Modify: `src/lib/simulation/storage.ts`

- [ ] **Step 1: Rewrite repository tests around async Supabase calls**

Keep `snapshot()` and `state()` fixtures. Remove `memoryStorage()` and key tests. Add a mock for `from('simulation_states').select(...).eq(...).maybeSingle()` and `rpc(...)`. Require:

```ts
await expect(repository.load('project-1')).resolves.toEqual({
  ok: true,
  state: null,
  revision: 0,
});
await expect(repository.save('project-1', 4, state('project-1'))).resolves.toEqual({
  ok: true,
  revision: 5,
});
await expect(repository.clear('project-1', 4)).resolves.toEqual({ ok: true });
```

Add cases for valid load/deep freeze, unsupported `state_version`, invalid/project-mismatched state, read error, RPC error, and RPC conflict. Assert calls never send `user_id` and save sends `p_expected_revision`, `p_state_version: 1`, and validated state. Assert version `0` is rejected rather than migrated, matching the explicit decision not to import legacy browser state.

- [ ] **Step 2: Run the repository test and verify it fails**

```bash
npx jest tests/unit/simulation/storage.test.ts --runInBand
```

Expected: FAIL because the repository is synchronous and browser-backed.

- [ ] **Step 3: Implement the async repository contract**

Keep the v1 Zod schemas and `deepFreeze` in `storage.ts`. Remove the local-storage key and the local-only v0 migration path; the first cloud schema supports version `1` only. Future cloud versions must add an explicit database/application rollout. Replace the public contract with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type SimulationStorageErrorCode =
  | 'storage_unavailable' | 'read_failed' | 'write_failed' | 'remove_failed'
  | 'malformed' | 'unknown_version' | 'invalid_state' | 'unauthorized' | 'conflict';

export interface SimulationStorageError {
  readonly code: SimulationStorageErrorCode;
  readonly message: string;
  readonly observedRevision?: number;
}

export type SimulationLoadResult =
  | { readonly ok: true; readonly state: SimulationStateV1 | null; readonly revision: number; readonly migratedFrom?: 0 }
  | { readonly ok: false; readonly error: SimulationStorageError };
export type SimulationSaveResult =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly error: SimulationStorageError };
export type SimulationClearResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SimulationStorageError };

export interface SimulationStorageRepository {
  load(projectId: string): Promise<SimulationLoadResult>;
  save(projectId: string, expectedRevision: number, state: SimulationStateV1): Promise<SimulationSaveResult>;
  clear(projectId: string, expectedRevision: number): Promise<SimulationClearResult>;
}

export function createSimulationStorageRepository(
  supabase: Pick<SupabaseClient, 'from' | 'rpc'> | null | undefined,
): SimulationStorageRepository;
```

Load `state_version,state,revision` filtered only by `project_id`; RLS supplies the user scope. No row returns revision `0`. Validate revision before state parsing. Invalid row data returns error with `observedRevision`. Save/reset call their RPCs and normalize `saved`/`reset`/`conflict`. Map auth/privilege errors to `unauthorized`; do not expose raw backend messages.

- [ ] **Step 4: Run tests, typecheck, and commit**

```bash
npx jest tests/unit/simulation/storage.test.ts --runInBand
npx tsc --noEmit --pretty false
git add src/lib/simulation/storage.ts tests/unit/simulation/storage.test.ts
git commit -m "feat(simulation): persist state through Supabase repository"
```

Expected: repository tests PASS and TypeScript exits `0`.

### Task 3: Add A Single-Flight Revisioned Save Queue

**Files:**
- Create: `tests/unit/simulation/simulation-save-queue.test.ts`
- Create: `src/lib/simulation/SimulationSaveQueue.ts`

- [ ] **Step 1: Write deferred-promise queue tests**

Instantiate the planned queue as:

```ts
const queue = new SimulationSaveQueue({
  revision: 2,
  save: jest.fn(),
  onSaved: jest.fn(),
  onUnsaved: jest.fn(),
  onConflict: jest.fn(),
});
queue.enqueue(firstState);
queue.enqueue(newestState);
```

Assert only one `save(2, firstState)` starts while pending; after revision `3` succeeds only `save(3, newestState)` starts. A transient failure must call `onUnsaved`, and `retry()` must use the unchanged revision and latest state. A conflict must call `onConflict` and block later enqueue/retry. `stop()` must ignore late completion. `isDirty()` becomes false only when the latest state is acknowledged.

- [ ] **Step 2: Run the queue test and verify it fails**

```bash
npx jest tests/unit/simulation/simulation-save-queue.test.ts --runInBand
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the framework-free queue**

Create `SimulationSaveQueue.ts` with:

```ts
export class SimulationSaveQueue {
  private revision: number;
  private pending: SimulationStateV1 | null = null;
  private failed: SimulationStateV1 | null = null;
  private inFlight = false;
  private blocked = false;
  private stopped = false;

  enqueue(state: SimulationStateV1): void;
  retry(): void;
  stop(): void;
  isDirty(): boolean;
  getRevision(): number;
}
```

`enqueue()` stores the latest state and calls private `flush()`. `flush()` exits when stopped, blocked, in flight, or empty. Remove the pending snapshot before `save(revision, snapshot)`. On success update revision, call `onSaved(revision, dirty)`, and flush newer state. On transient failure keep the failed snapshot only if no newer one exists, then call `onUnsaved`. On conflict mark blocked, clear pending/failed, and call `onConflict`. Every continuation checks `stopped` before callbacks or follow-up work.

- [ ] **Step 4: Run tests and commit**

```bash
npx jest tests/unit/simulation/simulation-save-queue.test.ts tests/unit/simulation/storage.test.ts --runInBand
git add src/lib/simulation/SimulationSaveQueue.ts tests/unit/simulation/simulation-save-queue.test.ts
git commit -m "feat(simulation): serialize cloud state saves"
```

Expected: PASS.

### Task 4: Wire Hydration, Recovery, And Conflict UI

**Files:**
- Modify: `tests/unit/simulation/providers-static.test.ts`
- Modify: `tests/unit/simulation/workbench-flow.test.tsx`
- Modify: `tests/unit/simulation/workbench-static.test.ts`
- Modify: `src/lib/simulation/SimulationSessionProvider.tsx`
- Modify: `src/components/simulation/workbench/SimulationToast.tsx`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.tsx`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.module.css`

- [ ] **Step 1: Update provider/workbench contract tests first**

Require `useSupabase`, `await repository.load`, `SimulationSaveQueue`, `requestGenerationRef`, and `queue.stop()`. Assert provider source excludes `getBrowserStorage`, `simulationStorageKey`, and `localStorage`. Add:

```ts
expect(workbench).toContain('sessions.isHydrating');
expect(workbench).toContain('sessions.retryPersistence');
expect(workbench).toContain('sessions.loadCloudVersion');
expect(workbench).toContain('actionLabel');
expect(toast).toContain('actionLabel');
expect(toast).toContain('onAction');
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
npx jest tests/unit/simulation/providers-static.test.ts tests/unit/simulation/workbench-flow.test.tsx tests/unit/simulation/workbench-static.test.ts --runInBand
```

Expected: FAIL because cloud hydration and named toast actions are not wired.

- [ ] **Step 3: Implement provider hydration and persistence status**

Use `const supabase = useSupabase()` and memoize the repository. Expose:

```ts
type PersistenceStatus = 'hydrating' | 'ready' | 'unsaved' | 'conflict' | 'load-error' | 'invalid';

type SessionContextValue = {
  // retain every existing domain field/action
  isHydrating: boolean;
  persistenceStatus: PersistenceStatus;
  persistenceWarning: string | null;
  retryPersistence: () => void;
  loadCloudVersion: () => void;
  resetStorage: () => void;
};
```

At each namespace change increment `requestGenerationRef`, stop the old queue, dispatch `PROJECT_CHANGED`, and set `hydrating`. Await `repository.load(selectedProjectId)` and ignore results whose generation is stale. On success dispatch cloud/fresh state, store a baseline state ref, create `SimulationSaveQueue` at the returned revision, then set `ready`. On invalid state keep `observedRevision` for reset; on other load failure set `load-error`.

Keep the 150ms reducer debounce, but enqueue only after hydration and only when state differs from the hydration baseline/current last-enqueued reference. Queue callbacks set `ready`, `unsaved`, or `conflict` only for their captured generation.

Implement `retryPersistence`: reload for load error, queue retry for unsaved. Implement `loadCloudVersion`: only in conflict, rerun hydration and explicitly discard memory. Implement async reset with queue/observed revision; on success install fresh state and a revision-`0` queue, on conflict enter conflict status. Preserve the import project guard and synchronous reducer action API.

- [ ] **Step 4: Add a named action to the toast**

Change `SimulationToastProps` to include:

```ts
readonly actionLabel?: string;
readonly onAction?: () => void;
```

Render:

```tsx
{actionLabel && onAction ? (
  <button type="button" onClick={onAction} className={styles.toastAction}>
    {actionLabel}
  </button>
) : null}
```

Add `.toastAction` styling with stable height, existing simulation colors, and `:focus-visible`; do not create a nested panel.

- [ ] **Step 5: Wire loading and recovery in the workbench**

After project guards:

```tsx
if (sessions.isHydrating) {
  return <div className={styles.emptyState}>Loading simulation sessions...</div>;
}
if (sessions.persistenceStatus === 'load-error') {
  return <div className={styles.emptyState}>
    <p>{sessions.persistenceWarning}</p>
    <button type="button" onClick={sessions.retryPersistence}>Retry</button>
  </div>;
}
```

Derive the persistent action:

```ts
const persistenceAction = sessions.persistenceStatus === 'conflict'
  ? { label: 'Load cloud version', run: sessions.loadCloudVersion }
  : sessions.persistenceStatus === 'unsaved'
    ? { label: 'Retry save', run: sessions.retryPersistence }
    : sessions.persistenceStatus === 'invalid'
      ? { label: 'Reset cloud state', run: sessions.resetStorage }
      : null;
```

Pass `actionLabel` and `onAction` to `SimulationToast`. Keep the workbench usable for unsaved/conflict; keep initial load error blocking to prevent an unknown cloud state from being overwritten.

- [ ] **Step 6: Run focused tests and commit**

```bash
npx jest tests/unit/simulation --runInBand
git add src/lib/simulation/SimulationSessionProvider.tsx src/components/simulation/workbench/SimulationToast.tsx src/components/simulation/workbench/SimulationWorkbench.tsx src/components/simulation/workbench/SimulationWorkbench.module.css tests/unit/simulation/providers-static.test.ts tests/unit/simulation/workbench-flow.test.tsx tests/unit/simulation/workbench-static.test.ts
git commit -m "feat(simulation): hydrate and recover cloud sessions"
```

Expected: all simulation tests PASS.

### Task 5: Update Architecture Documentation And Verify

**Files:**
- Modify: `docs/architecture/ARCHITECTURE.md:131`
- Verify: all files changed in Tasks 1-4

- [ ] **Step 1: Update authoritative architecture statements**

Use:

```markdown
- **Supabase PostgreSQL**: Persistent data source for libraries, assets, field values, permissions, version snapshots, and private project-scoped simulation sessions
- **Browser Storage**: Supabase runtime auth state and non-authoritative UI preferences; Yjs documents and simulation sessions do not use browser-local durable persistence
```

Replace the statement that simulation mutations are not written to Supabase with the `simulation_states` snapshot, per-user/project RLS, revisioned atomic writes, and explicit conflict recovery.

- [ ] **Step 2: Run focused verification**

```bash
git diff --check
npx jest tests/unit/database/simulation-states-migration.test.ts tests/unit/database/simulation-states.rls.behavior.test.ts tests/unit/simulation --runInBand
```

Expected: no whitespace errors; static and simulation tests PASS; gated RLS tests PASS with local Supabase or report SKIP.

- [ ] **Step 3: Run repository-wide verification**

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run test:unit -- --runInBand
npm run build
```

Expected: every command exits `0`. Record any unrelated pre-existing dirty-worktree failure with its exact file/output, then rerun narrow feature checks.

- [ ] **Step 4: Run the browser flow when configured**

```bash
npx playwright test tests/e2e/specs/simulation-system.spec.ts --workers=1
```

Expected: PASS with configured Supabase test data, including refresh restoration from Supabase. If unavailable, report it as not run.

- [ ] **Step 5: Commit documentation and review scope**

```bash
git add docs/architecture/ARCHITECTURE.md
git commit -m "docs: document simulation cloud persistence"
git status --short
```

Expected: implementation commits contain only the migration, simulation persistence code/tests, recovery UI, and architecture documentation. Existing unrelated user changes remain untouched.
