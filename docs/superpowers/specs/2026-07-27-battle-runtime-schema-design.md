# Battle Runtime Schema Design

## Context

`battle-poc` and Keco Studio use the same hosted Supabase project,
`lulrcirmwwvvnupmwqcq`. Keco Studio owns the canonical migration history for
that database. The battle application currently receives PostgREST `PGRST205`
responses for `public.player_saves` because its historical runtime migrations
were applied only to an obsolete Supabase project.

The active shared database has `public.simulation_states`, but it does not have
the seven runtime tables consumed by battle-poc:

- `skills`
- `job_classes`
- `job_class_skills`
- `player_saves`
- `battle_history`
- `enemy_templates`
- `map_enemies`

## Goal

Add the complete battle runtime schema to Keco Studio's canonical migration
history, deploy it to the shared hosted Supabase project, and prove that the
existing Google-authenticated battle-poc user can read and write runtime data
without `PGRST205`.

## Ownership And Deployment

- Keco Studio is the sole migration owner for the shared Supabase database.
- Add one current migration after `20260724100000_mcp_account_connections.sql`.
- Do not relink battle-poc and push its historical migration directory.
- Do not apply an untracked SQL Editor patch.
- The new migration consolidates the battle-poc historical runtime migrations
  into one reviewable, repeatable unit.
- No existing Keco Studio table, function, policy, or seed row may be modified
  except the existing shared `public.update_updated_at_column()` function is
  reused by new table triggers.

## Schema

### Static game data

`skills` stores the application skill catalog and its battle parameters.
`job_classes` stores class base stats and level growth. `job_class_skills`
provides the many-to-many class loadout and signature mapping.

`enemy_templates` stores enemy blueprints. `map_enemies` stores map placements
and per-instance JSON overrides.

All five tables enable RLS and allow read-only access to `anon` and
`authenticated`. Browser roles receive no insert, update, or delete grants.
`service_role` retains full management privileges.

### Player saves

`player_saves` stores exactly one row per `auth.users.id`. It retains the
battle-poc column contract for identity, character name, class, progression,
position, equipment, inventory, carried skills, and timestamps.

RLS permits authenticated users to insert, update, and delete only their own
row. Authenticated select remains intentionally project-wide because the
current battle-poc PVP opponent query reads
`user_id, character_name, level, carried_skill_ids` directly from this table.
Unauthenticated callers cannot read player saves.

Character names are globally unique after case-folding and trimming. Default
names use `Adventurer-` plus the complete user UUID, so signup and backfill do
not collide with other generated defaults.

### Battle history

`battle_history` stores completed PVE and PVP results. Authenticated users may
select and insert only rows whose `user_id` equals `auth.uid()`. Browser roles
cannot update or delete history rows.

## Triggers And Existing Users

- Install `updated_at` triggers for `skills`, `player_saves`, and
  `enemy_templates` using `public.update_updated_at_column()`.
- Install `public.handle_new_user_save()` as a `security definer` function with
  an empty `search_path` and fully-qualified identifiers.
- Recreate `on_auth_user_created_save` on `auth.users` so every future user gets
  one save row.
- Backfill every existing `auth.users` row into `player_saves` with deterministic
  unique default names and `on conflict (user_id) do nothing`.
- Function execution is revoked from `public`, `anon`, and `authenticated`;
  only the trigger invokes it.

## Seeds

The migration preserves the deterministic battle-poc seed catalog:

- the complete skill catalog from `20260424000005_seed_skills.sql`;
- six job classes and their class-skill mappings from
  `20260424000006_seed_job_classes.sql`;
- five enemy templates and thirteen map placements from
  `20260424000008_seed_enemy_data.sql`.

All seed writes use `on conflict` behavior so retrying the migration converges
on the same authored values. Static IDs remain unchanged because battle-poc
code and persisted player loadouts reference them.

## Transaction And Retry Safety

The migration is enclosed in one explicit transaction. Tables and indexes use
`if not exists`. Policies and triggers are dropped by their exact names before
recreation. Functions use `create or replace`. Seeds use deterministic IDs and
upserts. A failed migration therefore commits none of its changes, while a
deliberate replay converges without duplicate rows, policies, or triggers.

The target database was inspected before implementation and none of the seven
tables exists, so the migration does not need to reconcile an unknown partial
legacy schema.

## PostgREST

The migration ends with:

```sql
notify pgrst, 'reload schema';
```

After deployment, a REST request to `player_saves` must return an authorized
data response or an RLS response, never `PGRST205`.

## Error Handling

- Constraint violations abort the transaction.
- Invalid battle result/type, negative progression, invalid class/range enums,
  and empty names are rejected by database checks.
- Foreign keys cascade or clear references according to runtime ownership.
- Seed references are inserted only after their referenced skills and jobs.
- The deployment is not considered successful until migration history, REST
  schema visibility, RLS behavior, and battle-poc runtime operations all pass.

## Test Strategy

### Static migration contract

A Jest test reads the exact new migration and asserts:

- all seven tables, required columns, constraints, indexes, and foreign keys;
- RLS and exact policy boundaries;
- browser and service-role grants;
- update and new-user triggers;
- existing-user backfill and unique generated names;
- deterministic seed sentinels and conflict handling;
- explicit transaction and PostgREST schema reload.

The test must fail because the migration does not exist before implementation.

### Local database behavior

Apply the complete Keco migration history to a clean local Supabase database
and verify table existence, seed counts, trigger backfill, RLS ownership, PVP
read behavior, and battle-history append/read behavior. If the local Supabase
stack cannot run, the static contract and hosted post-deployment probes remain
mandatory and the missing local gate is reported explicitly.

### Hosted acceptance

After pushing the Keco branch and deploying the migration:

1. confirm remote migration history includes the new version;
2. confirm all seven tables exist through read-only SQL or REST;
3. confirm the existing Google user has exactly one `player_saves` row;
4. authenticate as that user and verify own save read/upsert;
5. insert and read back one battle-history probe row, then remove only that
   probe row through an authorized administrative cleanup;
6. verify static catalogs and map placements are readable;
7. reload battle-poc on port 3002 and confirm the original player-save request
   no longer returns 404/PGRST205.

No credential, access token, refresh token, service-role key, raw browser trace,
or unsanitized network capture may be committed as evidence.

## Acceptance Criteria

1. Keco Studio's canonical history contains one reviewed Battle Runtime
   migration after `20260724100000`.
2. The hosted database exposes all seven runtime tables.
3. Existing and future auth users each receive exactly one uniquely named save.
4. Own-save writes, authenticated PVP reads, and own battle-history operations
   obey the documented RLS rules.
5. Static skills, classes, mappings, enemy templates, and placements are seeded
   deterministically.
6. battle-poc no longer emits `PGRST205` for `player_saves`.
7. Existing Keco Studio tests, type checks, and production build do not regress.
