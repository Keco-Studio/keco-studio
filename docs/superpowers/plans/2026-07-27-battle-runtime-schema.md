# Battle Runtime Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan must be executed inline; the user explicitly prohibited subagents.

**Goal:** Add and deploy the complete battle-poc runtime schema through Keco Studio's canonical Supabase migration history so the hosted `player_saves` request no longer returns `PGRST205`.

**Architecture:** One current Keco migration creates the seven isolated Battle Runtime tables, RLS, grants, triggers, existing-user backfill, and deterministic seeds without changing existing Keco tables. A static Jest contract proves the migration contents before deployment; clean-database and hosted probes prove PostgreSQL behavior and the original battle-poc failure path.

**Tech Stack:** PostgreSQL 15, Supabase CLI/PostgREST/Auth/RLS, Jest 30, Next.js 16, battle-poc Next.js 15.

## Global Constraints

- Keco Studio is the only migration owner for Supabase project `lulrcirmwwvvnupmwqcq`.
- Do not relink battle-poc or apply its historical migration directory.
- Do not modify existing Keco tables or policies.
- Use one explicit transaction and finish with `notify pgrst, 'reload schema';`.
- Preserve battle-poc's current table and seed IDs.
- Do not commit credentials, browser traces, or unsanitized network captures.
- Execute inline without subagents.

---

### Task 1: Add The Failing Migration Contract

**Files:**
- Create: `tests/unit/database/battle-runtime-schema-migration.test.ts`
- Read: `docs/superpowers/specs/2026-07-27-battle-runtime-schema-design.md`

**Interfaces:**
- Consumes: the fixed migration path `supabase/migrations/20260727150000_battle_runtime_schema.sql`.
- Produces: Jest assertions for every schema, RLS, trigger, seed, transaction, and reload requirement.

- [ ] **Step 1: Create a contract test that safely reads a missing migration**

Use `existsSync` and `readFileSync` so the suite reaches behavioral assertions
instead of throwing during module initialization:

```ts
const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260727150000_battle_runtime_schema.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';
```

- [ ] **Step 2: Assert table and index contracts**

Assert all seven `create table if not exists public.<name>` statements, the
`player_saves.user_id` unique relationship, job/skill/enemy foreign keys,
progression and enum checks, and the lookup indexes used by battle-poc.

- [ ] **Step 3: Assert RLS and grants**

Assert RLS is enabled on all seven tables. Require public static read policies,
authenticated PVP select, own-save write policies, own-history select/insert,
explicit browser grants, and service-role grants. Reject authenticated static
writes and history update/delete grants.

- [ ] **Step 4: Assert trigger, backfill, seed, and deployment contracts**

Require drop/recreate semantics for all four triggers, hardened
`handle_new_user_save`, deterministic existing-user backfill, the complete UUID
in generated names, representative skill/job/enemy/map seeds, `on conflict`,
`begin`, `commit`, and PostgREST reload.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/database/battle-runtime-schema-migration.test.ts
```

Expected: assertions fail because `sql` is empty and the migration file does
not exist. The failure must mention a missing expected `create table` contract,
not a TypeScript/import error.

- [ ] **Step 6: Commit the verified failing test**

```bash
git add tests/unit/database/battle-runtime-schema-migration.test.ts
git commit -m "test: define battle runtime migration contract"
```

---

### Task 2: Implement The Canonical Migration

**Files:**
- Create: `supabase/migrations/20260727150000_battle_runtime_schema.sql`
- Test: `tests/unit/database/battle-runtime-schema-migration.test.ts`
- Reference: battle-poc `supabase/migrations/20260424000001` through
  `20260428100600`

**Interfaces:**
- Consumes: the existing `public.update_updated_at_column()` trigger function,
  `auth.users`, and the historical static IDs used by battle-poc.
- Produces: seven PostgREST-visible tables and `public.handle_new_user_save()`.

- [ ] **Step 1: Open one explicit transaction and create static tables**

Create `skills`, `job_classes`, `job_class_skills`, `enemy_templates`, and
`map_enemies` with the exact battle-poc columns, constraints, indexes, and
foreign-key actions. Include `map_enemies.overrides` in the initial definition.

- [ ] **Step 2: Create user-owned tables**

Create `player_saves` and `battle_history` with the exact battle-poc runtime
columns. Add the unique user constraint, case-insensitive trimmed character-name
index, progression checks, result/type checks, and query indexes.

- [ ] **Step 3: Install retry-safe triggers and backfill**

Drop each named trigger if it exists, then recreate update triggers. Define
`handle_new_user_save()` as `security definer set search_path = ''`, insert
`'Adventurer-' || new.id::text`, revoke browser execution, recreate the auth
trigger, and backfill all `auth.users` with the same deterministic name.

- [ ] **Step 4: Install RLS, policies, and explicit grants**

Drop exact policy names before creation. Static tables allow read-only access
to `anon` and `authenticated`. Player saves allow authenticated global select
for the existing PVP query and own insert/update/delete. Battle history allows
own select/insert. Revoke browser writes not in those contracts and grant full
access to `service_role`.

- [ ] **Step 5: Consolidate deterministic seeds**

Copy the exact skill rows from `20260424000005`, the six jobs and mappings from
`20260424000006`, and the five templates plus thirteen placements from
`20260424000008`. Preserve all `on conflict` behavior and insert order.

- [ ] **Step 6: Reload PostgREST and commit the transaction**

End the migration with:

```sql
notify pgrst, 'reload schema';
commit;
```

- [ ] **Step 7: Run the focused test and verify GREEN**

```bash
npm run test:unit -- --runInBand tests/unit/database/battle-runtime-schema-migration.test.ts
```

Expected: one suite passes with all contract tests green.

- [ ] **Step 8: Check SQL and commit**

```bash
git diff --check
git add supabase/migrations/20260727150000_battle_runtime_schema.sql
git commit -m "fix: add battle runtime schema to shared database"
```

---

### Task 3: Verify A Clean Database And The Keco Repository

**Files:**
- Verify: all Keco migrations and test/build targets
- Do not create persistent credential or evidence files

**Interfaces:**
- Consumes: the complete Keco migration history ending in
  `20260727150000_battle_runtime_schema.sql`.
- Produces: fresh local and repository verification evidence.

- [ ] **Step 1: Start or reset the local Supabase stack**

```bash
supabase start
supabase db reset
```

Expected: the complete migration history applies without SQL errors.

- [ ] **Step 2: Query local schema and seeds**

Use the local database connection reported by `supabase status` and verify:

```sql
select to_regclass('public.player_saves');
select count(*) from public.skills;
select count(*) from public.job_classes;
select count(*) from public.enemy_templates;
select count(*) from public.map_enemies;
```

Expected: `player_saves` exists; jobs = 6, templates = 5, placements = 13;
skills are non-empty and match the historical catalog count.

- [ ] **Step 3: Verify trigger and RLS behavior locally**

Create isolated local auth fixtures inside a transaction. Verify new-user
backfill creates one uniquely named save, an authenticated user can upsert only
their own save, can read another user's four PVP fields, cannot update the other
user, and can insert/read only their own battle history. Roll the fixture
transaction back.

- [ ] **Step 4: Run focused and full unit tests**

```bash
npm run test:unit -- --runInBand tests/unit/database/battle-runtime-schema-migration.test.ts
npm run test:unit -- --runInBand
```

Expected: all enabled Jest suites pass.

- [ ] **Step 5: Run static project gates**

```bash
npm run typecheck
npm run typecheck:api
npm run check:mcp
npm run build
git diff --check
```

Expected: every command exits zero. Existing warnings must be reported rather
than hidden.

- [ ] **Step 6: Commit any test-only correction**

If verification required a contract correction, commit only that reviewed
correction with `test: harden battle runtime migration verification`. Otherwise
do not create an empty commit.

---

### Task 4: Push, Deploy, And Reproduce The Original Scenario

**Files:**
- Push branch: `codex/battle-runtime-schema`
- Target repository: `Keco-Studio/keco-studio`
- Target Supabase project: `lulrcirmwwvvnupmwqcq`

**Interfaces:**
- Consumes: a clean, verified Keco branch and the existing Supabase CLI link.
- Produces: hosted schema migration and end-to-end acceptance evidence.

- [ ] **Step 1: Confirm remote migration history before mutation**

```bash
supabase migration list --linked
```

Expected: remote history ends at `20260724100000`; local additionally contains
`20260727150000`.

- [ ] **Step 2: Push the reviewed Git branch**

```bash
git push -u origin codex/battle-runtime-schema
```

- [ ] **Step 3: Apply only the pending canonical migration**

```bash
supabase db push --linked
```

Review the pending list before confirmation. Expected: exactly
`20260727150000_battle_runtime_schema.sql` is applied.

- [ ] **Step 4: Verify hosted migration and schema visibility**

Run `supabase migration list --linked`, then query all seven `to_regclass`
values through the existing read-only SQL path. Verify PostgREST no longer
returns `PGRST205` for `player_saves`.

- [ ] **Step 5: Verify the existing Google user**

For user `33b7f9c6-7310-4100-b51d-fff916e38ab2`, verify exactly one save row
exists. Authenticate through battle-poc's existing browser session and verify
own read/upsert succeeds without exposing credentials.

- [ ] **Step 6: Verify battle history with reversible probe data**

Insert one uniquely marked PVE battle-history row as the user, read it back,
then remove only that exact probe row using the existing authorized
administrative path. Record counts, not tokens.

- [ ] **Step 7: Re-run battle-poc on port 3002**

Reload the authenticated app, open the profile/save and battle panels, and
verify the browser/network log contains no `player_saves` 404 or `PGRST205`.
Confirm Keco Studio import tables and their sentinel values remain unchanged.

- [ ] **Step 8: Create or update the GitHub PR**

Create a PR from `codex/battle-runtime-schema` to `main` with the root cause,
schema boundaries, local verification, hosted migration result, and sanitized
acceptance evidence. Do not merge until required checks pass.
