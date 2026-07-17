# Realtime Connection Pool Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate Sidebar `IncreaseConnectionPool` failures while preserving all private Realtime behavior and Sidebar refresh workflows.

**Architecture:** Restore three explicit Postgres Changes bindings inside the existing private project channel and keep the user projects channel stable across project navigation. Add a guarded local-only tool that sets the Realtime tenant `db_pool` to 10 and verifies the live pool, then make the two-browser E2E gates fail on the target Realtime errors.

**Tech Stack:** React 19 hooks, Supabase JS/Realtime 2.87.1, local Supabase Realtime v2.68.4, TypeScript/tsx, Jest 30, Playwright 1.57, GitHub Actions, Docker/PostgreSQL.

## Global Constraints

- Keep the Sidebar at two Realtime channels: one user channel and one current project channel.
- Keep project and document channels private; do not weaken `realtime.messages` RLS.
- Do not add `documents` to `supabase_realtime`.
- Do not modify `_realtime` through an application migration or target a hosted database.
- Local `realtime-dev` `postgres_cdc_rls.settings.db_pool` must be exactly `10`.
- Do not hide, downgrade, or filter the target Realtime errors in production code.
- Preserve the existing unrelated `next-env.d.ts` worktree change.

---

### Task 1: Make Sidebar subscriptions explicit and lifecycle-stable

**Files:**
- Modify: `src/components/layout/hooks/useSidebarRealtime.ts`
- Modify: `src/components/layout/hooks/useSidebarRealtime.test.ts`

**Interfaces:**
- Consumes: `useSidebarRealtime(UseSidebarRealtimeParams)` and the existing Supabase `channel().on().subscribe()` API.
- Produces: one stable `projects:user:{userId}` channel and one current-project channel with exactly three table-specific Postgres bindings.

- [ ] **Step 1: Add a failing hook-runtime test harness and explicit-binding test**

Mock `react.useEffect` and `react.useRef` before importing the hook. Implement a test-only `HookRuntime` that retains hook slots, compares dependencies with `Object.is`, runs the previous cleanup before a changed effect, and exposes `render()` and `unmount()`. Add a chainable Supabase fake that records topics, `.on()` bindings, subscribe callbacks, and removed channels.

The first test must render project `p1` and assert the project channel has these three configs and no schema-only config:

```ts
expect(projectBindings.map(({ config }) => config)).toEqual([
  {
    event: '*',
    schema: 'public',
    table: 'libraries',
    filter: 'project_id=eq.p1',
  },
  {
    event: '*',
    schema: 'public',
    table: 'folders',
    filter: 'project_id=eq.p1',
  },
  {
    event: '*',
    schema: 'public',
    table: 'predefine_properties',
  },
]);
expect(projectBindings.every(({ config }) => 'table' in config)).toBe(true);
```

- [ ] **Step 2: Run the explicit-binding test and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/layout/hooks/useSidebarRealtime.test.ts -t "registers exactly three explicit project table bindings"
```

Expected: FAIL because the current project channel has one schema-only binding.

- [ ] **Step 3: Add failing lifecycle and stale-closure tests**

Render `p1`, then `p2`, and assert:

```ts
expect(channels.filter((channel) => channel.topic === 'projects:user:user-1')).toHaveLength(1);
expect(removeChannel).toHaveBeenCalledWith(projectP1Channel);
expect(removeChannel).not.toHaveBeenCalledWith(projectsUserChannel);
```

Trigger a `projects` DELETE payload for `p2` through the retained user channel and assert `router.push('/projects')`. On unmount, assert the remaining user/project channels are removed and the registered document-channel cleanup runs once.

- [ ] **Step 4: Run the lifecycle tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/layout/hooks/useSidebarRealtime.test.ts -t "keeps the projects user channel across project changes|uses the latest project for delete navigation"
```

Expected: FAIL because `currentProjectId` currently recreates the user channel and the callback closes over the initial ID.

- [ ] **Step 5: Implement the minimal Sidebar fix**

Add a latest-value ref:

```ts
const currentProjectIdRef = useRef(currentProjectId);
currentProjectIdRef.current = currentProjectId;
```

Read `currentProjectIdRef.current` in the project-delete navigation condition and remove `currentProjectId` from the user effect dependency list.

Replace the schema-only project binding with three `.on('postgres_changes', ...)` calls. Keep the existing handlers, but remove client-side `payload.table` branching because the server now routes each callback by table. Libraries and folders retain `project_id=eq.${currentProjectId}` filters; predefined properties remain unfiltered to preserve current behavior.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/components/layout/hooks/useSidebarRealtime.test.ts tests/unit/realtime-channel-consolidation.test.ts
```

Expected: both suites PASS. Update the static consolidation assertion to expect four Sidebar `'postgres_changes'` occurrences and three explicit table configs if it fails for the corrected implementation.

- [ ] **Step 7: Commit the Sidebar behavior fix**

```bash
git add src/components/layout/hooks/useSidebarRealtime.ts src/components/layout/hooks/useSidebarRealtime.test.ts tests/unit/realtime-channel-consolidation.test.ts
git commit -m "fix: narrow sidebar realtime subscriptions"
```

---

### Task 2: Configure and verify the local Realtime tenant pool

**Files:**
- Create: `scripts/lib/localRealtimePool.ts`
- Create: `scripts/configure-local-realtime-pool.ts`
- Create: `tests/unit/configure-local-realtime-pool.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/playwright.yml`
- Modify: `README.md`

**Interfaces:**
- Produces from `scripts/lib/localRealtimePool.ts`: `configureLocalRealtimePool(deps: PoolConfiguratorDependencies): Promise<{ restarted: boolean }>`.
- Produces from `scripts/configure-local-realtime-pool.ts`: a thin CLI that supplies the real Docker runner and maps `--check` to `checkOnly: true`.
- Produces CLI commands `npm run supabase:realtime-pool` and `npm run supabase:realtime-pool:check`.
- Consumes only local Docker containers labeled `com.supabase.cli.project=keco-studio`; it never accepts a hosted DB URL.

- [ ] **Step 1: Write failing unit tests for the configurator contract**

Import only `scripts/lib/localRealtimePool.ts`, then inject a command runner and wait function. Cover these cases with recorded Docker arguments:

```ts
it('updates and restarts when db_pool is missing', async () => {
  const result = await configureLocalRealtimePool({ run, wait, checkOnly: false });
  expect(result).toEqual({ restarted: true });
  expect(commands).toContainEqual(['restart', 'supabase_realtime_keco-studio']);
});

it('does not restart when stored and live pool sizes are ten', async () => {
  const result = await configureLocalRealtimePool({ run, wait, checkOnly: false });
  expect(result).toEqual({ restarted: false });
});

it('restarts when the stored value is ten but the live pool is stale', async () => {
  expect((await configureLocalRealtimePool({ run, wait })).restarted).toBe(true);
});

it('refuses containers with a different Supabase project label', async () => {
  await expect(configureLocalRealtimePool({ run, wait })).rejects.toThrow(
    'Refusing to configure a non-keco-studio Supabase container'
  );
});
```

Also assert the SQL string validates exactly one `realtime-dev` tenant and one `postgres_cdc_rls` extension, checks `settings` is an object, validates any existing `db_pool` is numeric, updates only `{db_pool}`, and never selects full `settings`.

- [ ] **Step 2: Run the pool tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/configure-local-realtime-pool.test.ts
```

Expected: FAIL because the configurator does not exist.

- [ ] **Step 3: Implement the guarded local configurator**

Use `execFile`/`promisify` with argument arrays, never a shell command string. Fix these local identities in the tool:

```ts
const PROJECT_ID = 'keco-studio';
const TENANT_ID = 'realtime-dev';
const POOL_SIZE = 10;
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`;
const REALTIME_CONTAINER = `supabase_realtime_${PROJECT_ID}`;
```

For both containers, require a running state and the exact
`com.supabase.cli.project` label. Execute guarded SQL through:

```ts
[
  'exec', DB_CONTAINER,
  'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql,
]
```

The SQL runs in one transaction, verifies local tenant/extension cardinality,
and uses:

```sql
settings = jsonb_set(settings, '{db_pool}', '10'::jsonb, true)
```

After apply, restart when the value changed or the live
`pg_stat_activity.application_name = 'realtime_connect'` count is not 10. Poll
until the container is healthy, stored value is 10, and live connection count is
10. `--check` performs all guards and verification but never updates or restarts.

- [ ] **Step 4: Run the pool unit tests and verify GREEN**

```bash
npm run test:unit -- --runInBand tests/unit/configure-local-realtime-pool.test.ts
```

Expected: PASS with apply, idempotency, interrupted-apply recovery, check-only,
container guard, and timeout cases covered.

- [ ] **Step 5: Wire package scripts, CI, and developer setup**

Add:

```json
"supabase:realtime-pool": "tsx scripts/configure-local-realtime-pool.ts",
"supabase:realtime-pool:check": "tsx scripts/configure-local-realtime-pool.ts --check"
```

In both workflows, add a `Configure local Realtime pool` step after the final
successful `supabase db reset`/recovery and before tests or key extraction:

```yaml
- name: Configure local Realtime pool
  run: npm run supabase:realtime-pool
```

Document the same command immediately after `supabase start`/`supabase db reset`
in `README.md`, including that it is local-only and requires Docker.

- [ ] **Step 6: Verify the real local apply is idempotent**

Run twice:

```bash
npm run supabase:realtime-pool
npm run supabase:realtime-pool
npm run supabase:realtime-pool:check
```

Expected: first run restarts if needed; second reports no restart; check exits 0.

Then verify without printing extension settings:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select settings->>'db_pool' as db_pool from _realtime.extensions where tenant_external_id='realtime-dev' and type='postgres_cdc_rls'"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select count(*) from pg_stat_activity where application_name='realtime_connect'"
```

Expected: both values are `10`.

- [ ] **Step 7: Commit the local pool tooling**

```bash
git add scripts/lib/localRealtimePool.ts scripts/configure-local-realtime-pool.ts tests/unit/configure-local-realtime-pool.test.ts package.json .github/workflows/ci.yml .github/workflows/playwright.yml README.md
git commit -m "fix: size local realtime authorization pool"
```

---

### Task 3: Add browser regression gates for Realtime pool errors

**Files:**
- Create: `tests/e2e/utils/realtime-errors.ts`
- Create: `tests/unit/realtime-error-capture.test.ts`
- Modify: `tests/e2e/specs/concurrent-editing.spec.ts`
- Modify: `tests/e2e/specs/document-collaboration.spec.ts`

**Interfaces:**
- Produces: `captureRealtimeErrors(page: Page, source: string): readonly string[]`.
- Matches only `IncreaseConnectionPool`, `Too many database timeouts`, `[Sidebar] Projects channel ERROR`, and `[Sidebar] Project channel ERROR`.

- [ ] **Step 1: Write a failing unit test for the browser error collector**

Use a small Page event fake with `on('console')` and `on('pageerror')` handlers.
Verify console messages are only inspected when `type() === 'error'`, both console
and page errors record matching messages with their source label, and unrelated
errors/warnings are ignored.

```ts
expect(errors).toEqual([
  'owner console: [Sidebar] Project channel ERROR: IncreaseConnectionPool',
  'owner pageerror: Too many database timeouts',
]);
```

- [ ] **Step 2: Run the collector test and verify RED**

```bash
npm run test:unit -- --runInBand tests/unit/realtime-error-capture.test.ts
```

Expected: FAIL because `captureRealtimeErrors` does not exist.

- [ ] **Step 3: Implement the minimal collector**

Register listeners synchronously and return the live readonly array. Use fixed
substring matching and `ConsoleMessage.text()`; do not serialize async console
arguments.

- [ ] **Step 4: Run the collector test and verify GREEN**

```bash
npm run test:unit -- --runInBand tests/unit/realtime-error-capture.test.ts
```

Expected: PASS.

- [ ] **Step 5: Install collection before login navigation in both E2E flows**

Extend `openLibrary()` and `loginAndOpen()` return values with
`realtimeErrors`. Call `captureRealtimeErrors(page, user.email)` immediately
after `context.newPage()` and before constructing/navigating `LoginPage`.

After the successful synchronization assertions and before entering `finally`,
assert all owner/editor/viewer arrays are empty:

```ts
expect([
  ...ownerSession.realtimeErrors,
  ...editorSession.realtimeErrors,
]).toEqual([]);
```

Do not place this assertion in `finally`, where it could mask the primary test
failure.

- [ ] **Step 6: Lint and run the two-browser release gates**

```bash
npx eslint tests/e2e/utils/realtime-errors.ts tests/e2e/specs/concurrent-editing.spec.ts tests/e2e/specs/document-collaboration.spec.ts
npx playwright test tests/e2e/specs/concurrent-editing.spec.ts tests/e2e/specs/document-collaboration.spec.ts --project=chromium --workers=1
```

Expected: both specs PASS and no captured target error is present.

- [ ] **Step 7: Inspect runtime Sidebar subscriptions during an authenticated browser session**

With one project page open, run:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select subscription_id, count(*) as bindings, string_agg(entity::text, ', ' order by entity::text) as tables from realtime.subscription group by subscription_id order by bindings desc, subscription_id"
```

Expected: the Sidebar project subscription has three entities
(`folders, libraries, predefine_properties`) and the Sidebar user subscription
has one (`projects`); there is no six-table schema-wide subscription.

- [ ] **Step 8: Commit the browser regression gate**

```bash
git add tests/e2e/utils/realtime-errors.ts tests/unit/realtime-error-capture.test.ts tests/e2e/specs/concurrent-editing.spec.ts tests/e2e/specs/document-collaboration.spec.ts
git commit -m "test: gate realtime connection pool errors"
```

---

### Task 4: Full verification and requirement audit

**Files:**
- Verify all files changed in Tasks 1-3.

**Interfaces:**
- Consumes the approved design at `docs/superpowers/specs/2026-07-17-realtime-connection-pool-remediation-design.md`.
- Produces fresh evidence for every acceptance criterion.

- [ ] **Step 1: Run focused unit and DB-backed verification**

```bash
npm run test:unit -- --runInBand src/components/layout/hooks/useSidebarRealtime.test.ts tests/unit/realtime-channel-consolidation.test.ts tests/unit/configure-local-realtime-pool.test.ts tests/unit/realtime-error-capture.test.ts
npm run supabase:realtime-pool:check
```

Expected: all focused tests pass and the live pool check exits 0.

- [ ] **Step 2: Run static and compile checks**

```bash
npm run lint
npm run typecheck
npm run typecheck:api
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run the full unit suite and production build**

```bash
npm run test:unit -- --runInBand
npm run build
```

Expected: all tests pass and the Next.js production build exits 0.

- [ ] **Step 4: Re-run the two-browser E2E gates against the configured local stack**

```bash
npx playwright test tests/e2e/specs/concurrent-editing.spec.ts tests/e2e/specs/document-collaboration.spec.ts --project=chromium --workers=1
```

Expected: both specs pass with collaboration still functioning and no target
Realtime error.

- [ ] **Step 5: Audit the approved requirements and worktree**

Confirm from the diff and runtime evidence:

- Sidebar has two channels and four Postgres subscription rows.
- Project navigation does not replace the user channel.
- `db_pool` and live `realtime_connect` count are both 10.
- Private flags and RLS migrations are unchanged.
- Library/folder/property/document invalidations remain wired.
- `next-env.d.ts` was not staged or reverted.

- [ ] **Step 6: Commit any verification-only test corrections**

Only if verification required a test correction, stage those exact test files
and commit:

```bash
git commit -m "test: complete realtime pool verification"
```
