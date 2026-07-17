# Realtime Connection Pool Remediation Design

**Date:** 2026-07-17

**Status:** Approved

## Problem

The Sidebar still reports `IncreaseConnectionPool: Please increase your
connection pool size` after the channel consolidation in commits `b961be8` and
`120f65e`.

Two independent defects contribute to the failure:

1. The project channel registers one `postgres_changes` binding with only
   `schema: 'public'`. Supabase Realtime expands that binding to every table in
   the `supabase_realtime` publication. In the current local database, one
   project channel creates six subscription rows instead of the intended three.
2. Supabase Realtime v2.68.4 uses the tenant extension setting `db_pool` for
   private-channel RLS authorization. When the setting is absent it defaults to
   one connection. Concurrent Sidebar and document collaboration joins can
   exhaust that single connection and time out in the authorization queue.

The existing consolidation unit test only counts source strings. It cannot
detect server-side binding expansion, effect lifecycle churn, or browser channel
errors.

## Goals

- Keep the Sidebar at two Realtime channels: one user channel and one current
  project channel.
- Limit Sidebar Postgres Changes subscriptions to exactly four rows: one for
  `projects` and one each for `libraries`, `folders`, and
  `predefine_properties`.
- Keep project document broadcasts private and preserve the existing
  `realtime.messages` RLS policies.
- Stop rebuilding the user projects channel when only the current project
  changes.
- Configure the local Realtime tenant authorization pool to ten connections in
  a repeatable, idempotent way.
- Fail automated tests when the browser reports this connection-pool error.

## Non-Goals

- Do not replace Supabase Realtime or the document collaboration transport.
- Do not make project or document channels public.
- Do not add `documents` to the `supabase_realtime` publication.
- Do not modify managed Supabase internal tables through an application
  migration.
- Do not redesign library collaboration, Presence, or Yjs synchronization.

## Selected Approach

Use explicit table bindings inside the existing project channel, stabilize the
user-channel effect with a current-project ref, and configure the local tenant's
`db_pool` through a guarded local setup script.

This retains the channel consolidation while avoiding schema-wide subscription
expansion. It also fixes the direct authorization bottleneck without weakening
private-channel access control.

Alternatives rejected:

- Application-only changes leave the local tenant authorization pool at one
  connection and remain vulnerable during concurrent private joins.
- A project-wide replacement transport for Sidebar, document collaboration,
  and Presence would reduce channel count further but requires a much larger
  security and synchronization redesign.

## Runtime Design

### User Projects Channel

`useSidebarRealtime` creates `projects:user:{userId}` only when the authenticated
user or stable Supabase/Query/Router dependencies change. A ref tracks the
latest `currentProjectId`. The project-delete handler reads the ref when deciding
whether to navigate to `/projects`.

Changing routes between projects must not remove and recreate this channel.

### Current Project Channel

For the current project, `useSidebarRealtime` creates the existing private
`folders:project:{projectId}` topic and attaches:

- one `postgres_changes` binding for `libraries` with
  `project_id=eq.{projectId}`;
- one `postgres_changes` binding for `folders` with
  `project_id=eq.{projectId}`;
- one `postgres_changes` binding for `predefine_properties` without a project
  filter, preserving current behavior;
- the existing `document-updated` broadcast handler.

The library, folder, predefined-property, and document query invalidation logic
remains unchanged. Cleanup unregisters the shared document channel and removes
the project channel.

### Local Realtime Pool

Add an idempotent local setup script that:

1. verifies it is targeting the local `realtime-dev` tenant;
2. updates only the `db_pool` key in the `postgres_cdc_rls` extension settings
   to `10`;
3. verifies the stored value;
4. restarts the local Realtime container only when necessary so the tenant pool
   is recreated with the new size;
5. avoids printing credentials or encrypted extension settings.

Supabase CLI does not expose this setting in `config.toml`, so adding an
unsupported configuration key is explicitly forbidden. CI workflows that start
or recover local Supabase invoke the setup script after the service is running.

Hosted Supabase pool sizing remains an operational project setting and is not
changed by repository migrations.

## Error Handling

`IncreaseConnectionPool`, `Too many database timeouts`, and Sidebar
`CHANNEL_ERROR` messages remain treated as failures. The implementation must not
hide, downgrade, or filter these errors merely to make browser checks pass.

The local pool script fails with a clear message if the expected tenant,
extension, database container, or Realtime container is absent. It must not
silently report success after a partial configuration.

## Functional Compatibility

- Library and folder changes still invalidate Sidebar caches.
- Predefined-property changes still refresh related library data.
- Document create, rename, move, delete, and save broadcasts still refresh the
  Sidebar and open document queries.
- Project deletion still removes cached entries and navigates away when the
  deleted project is active.
- Component cleanup still removes both channels.
- Existing private Broadcast authorization remains unchanged.

## Performance Impact

Explicit table bindings reduce subscription registration and irrelevant event
delivery compared with the schema-wide binding. Stabilizing the projects effect
removes an unnecessary leave/join cycle during project navigation.

Increasing local `db_pool` from one to ten permits private-channel RLS
authorization transactions to run concurrently instead of waiting for the
single connection. The trade-off is up to nine additional local PostgreSQL
connections and a small memory increase. The local database allows 100
connections, leaving sufficient headroom for this development and CI workload.

Restarting Realtime adds a few seconds to environment setup only. It does not
affect response time after startup.

## Testing

### Unit Behavior Tests

Replace source-count confidence with hook behavior coverage using a controlled
Supabase channel fake:

- assert the project channel registers exactly the three intended table
  bindings and no schema-only binding;
- assert changing `currentProjectId` replaces only the project channel;
- assert the projects channel remains stable across project changes;
- assert unmount removes both active channels.

Keep focused invalidation tests for library, folder, predefined-property, and
document payload handling.

### Local Configuration Tests

Test the pool setup script's guarded SQL and idempotency. After applying it to
local Supabase, verify that the `postgres_cdc_rls` extension has `db_pool = 10`
and that `pg_stat_activity` can create the expected `realtime_connect` pool under
concurrent private joins.

### Browser Regression

Open the same document or library in two independent authenticated browser
contexts. Capture console and page errors from both contexts and fail on:

- `IncreaseConnectionPool`;
- `Too many database timeouts`;
- `[Sidebar] Projects channel ERROR`;
- `[Sidebar] Project channel ERROR`.

Exercise a Sidebar-visible data update and document collaboration update to
prove the absence of errors is not caused by disabled Realtime functionality.

## Acceptance Criteria

- Runtime database inspection shows four Sidebar Postgres subscription rows,
  not a schema-wide expansion.
- Project navigation does not create a new projects channel.
- The local Realtime tenant setting reports `db_pool = 10` after setup.
- Two-browser library and document workflows synchronize without any target
  console or page error.
- Existing unit, type, lint, build, and relevant E2E suites pass.
- No private channel or RLS policy is removed or weakened.
