# Simulation Supabase Persistence Design

**Date:** 2026-07-22
**Status:** Approved design
**Target repository:** `keco-studio`

## Summary

Move the native simulation workbench's durable session state from browser
`localStorage` to Supabase PostgreSQL. Supabase becomes the only authoritative
store. State remains private to one authenticated user within one Studio
project, preserving the current user-and-project isolation while making the
state available across that user's browsers and devices.

Store one versioned JSONB snapshot per user and project. Use a monotonically
increasing revision and an atomic compare-and-swap database function to prevent
an older tab or device from silently overwriting newer cloud state.

This design supersedes the local-persistence sections of the approved native
simulation integration designs. It does not change Studio library import,
simulation domain behavior, battle execution, or the visual workbench.

## Goals

- Persist the complete `SimulationStateV1` in Supabase.
- Keep state private to the authenticated user and scoped to one project.
- Restore the same state for the user across browsers and devices.
- Detect concurrent edits and reject stale writes and stale resets.
- Keep the current reducer, versioned schema validation, and repository boundary.
- Let the current in-memory workflow continue when persistence temporarily
  fails, while clearly identifying that changes are not saved.

## Non-Goals

- Do not share simulation sessions between project members.
- Do not provide real-time collaborative simulation editing.
- Do not normalize sessions, roster entries, loadouts, or progression into
  separate relational tables.
- Do not migrate existing `localStorage` state to Supabase.
- Do not retain `localStorage` as an offline cache or fallback.
- Do not merge the older `simulation_skill_drafts`, `sim_user_progression`, or
  `sim_user_skill_levels` tables into the native workbench state model.
- Do not add server-side reporting or analytics over simulation state.

## Selected Approach

Create one `simulation_states` row for each `(user_id, project_id)` pair. The
row stores the complete versioned state as JSONB and carries a revision used for
optimistic concurrency control.

This approach matches the existing reducer, which commits coherent whole-state
transitions, and the existing storage schema, which validates and migrates a
complete `SimulationStateV1`. It keeps a save atomic without introducing
cross-table transaction and partial-update concerns. A normalized relational
model would only be justified once the product needs server-side queries over
individual simulation entities. An event log would add audit and projection
machinery without serving a current requirement.

## Database Design

### Table

Add `public.simulation_states` with:

- `user_id uuid not null references auth.users(id) on delete cascade`;
- `project_id uuid not null references public.projects(id) on delete cascade`;
- `state_version integer not null`;
- `state jsonb not null`;
- `revision bigint not null`;
- `created_at timestamptz not null default now()`;
- `updated_at timestamptz not null default now()`;
- primary key `(user_id, project_id)`.

Database checks require `state_version = 1`, `jsonb_typeof(state) = 'object'`,
and `revision >= 1`. The state itself contains its existing `version: 1` field;
the separate `state_version` makes version filtering and database validation
explicit without inspecting arbitrary JSON in every query.

Use the existing `update_updated_at_column()` trigger for `updated_at`.
Authenticated clients receive direct `select` permission only. They do not
receive direct `insert`, `update`, or `delete` grants, so every mutation must go
through the revision-aware RPC. The service role retains the direct permissions
needed for operations and tests. Direct reads remain protected by RLS.

### Row-Level Security

Every select, insert, update, and delete policy requires all of:

1. `(select auth.uid()) = user_id`; and
2. `public.is_project_owner(project_id, (select auth.uid()))` or
   `public.is_accepted_collaborator(project_id, (select auth.uid()))`.

The explicit owner/accepted-collaborator predicate is required because the
repository's older `user_has_project_access` helper does not check
`accepted_at`. Pending invitations must not grant simulation-state access.
Write policies are defense in depth for privileged paths; authenticated
application clients still lack direct table write grants.

Project owners and accepted collaborators of any role, including viewers, may
persist their own private simulation state because this does not mutate shared
project resources. A user who loses project access can no longer read, create,
update, or delete the row. No project member can access another member's state.

### Atomic Write Function

Add a security-definer function that accepts `project_id`,
`expected_revision`, `state_version`, and `state`. It derives `user_id` only
from `auth.uid()` and never accepts a caller-provided user ID.

The function validates authentication, project access, the supported state
version, JSON shape, and a nonnegative expected revision. Its transaction then:

- inserts a new row at revision `1` only when `expected_revision = 0` and no row
  exists;
- updates an existing row and increments its revision only when the row's
  revision equals `expected_revision`;
- reports a typed conflict outcome when the expected revision is stale.

If two revision-`0` creates race, the function converts the losing primary-key
violation into the same typed conflict outcome.

The function returns the new revision on success. The implementation must not
perform an unconditional upsert because that would allow stale clients to
overwrite newer state.

### Atomic Reset Function

Add a second security-definer function that derives the current user and deletes
the user's row for a project only when its revision equals `expected_revision`.
Deleting an absent row with expected revision `0` is a successful no-op. Any
other revision mismatch reports a conflict and leaves the cloud row unchanged.

Both functions set a fixed `search_path`, revoke public execution, and grant
execution only to `authenticated` and `service_role` as appropriate.

## Application Architecture

### Repository Boundary

Keep the `SimulationStorageRepository` responsibility but change its operations
to asynchronous Supabase calls. The repository exposes:

- `load(projectId)` returning validated state plus its revision, or no state at
  revision `0`;
- `save(projectId, expectedRevision, state)` returning the new revision;
- `clear(projectId, expectedRevision)` returning success or a conflict.

The repository does not accept a user ID. Supabase authentication and database
RLS establish the user namespace. It classifies failures into unavailable/read,
write, remove, malformed, unknown-version, invalid-state, unauthorized, and
conflict outcomes so the provider can render the correct recovery action.

A row whose JSON fails validation still yields its observed revision as error
metadata. This lets the existing explicit reset action safely pass the current
revision to the reset RPC without treating invalid state as usable domain data.
Read and authorization errors that did not return a row do not expose a
revision.

Keep the Zod schemas and explicit state migrations in the storage module. Save
validates before sending data. Load validates `state_version`, parses the JSONB
snapshot, runs any supported client migration, validates all domain references,
and deep-freezes the accepted state before returning it.

`SimulationSessionProvider` obtains the existing browser Supabase client from
`useSupabase()` and constructs the repository from that client. It removes all
access to browser `localStorage`, including storage-key generation and browser
storage availability checks.

### Existing Simulation Tables

The older simulation tables serve different, legacy workflows:

- `simulation_skill_drafts` stores a user-level draft array;
- `sim_user_progression` stores one user-level character progression row;
- `sim_user_skill_levels` stores user-level skill allocations.

They do not contain the selected Studio project, imported immutable catalog,
multiple native workbench sessions, rosters, or complete reducer state. The new
repository therefore does not read or write them. Removing those tables is a
separate cleanup decision outside this work.

## Data Flow

### Hydration

On authentication, entry, or selected-project change, the provider:

1. marks the new namespace as loading and clears the previous in-memory state;
2. loads the current user's row for the selected project;
3. initializes `createFreshSimulationState()` with revision `0` when no row
   exists;
4. dispatches cloud state only after complete schema validation;
5. enables durable mutations only after hydration succeeds.

Each load captures a namespace generation. A response from an older generation
must not update the state, revision, warning, or loading status after the user
switches projects or signs out. Hydration must finish before autosave is enabled,
so an empty initial reducer state cannot overwrite cloud data.

### Autosave

Durable reducer changes schedule a short debounced save. Each namespace permits
only one save request in flight. If state changes while a request is running,
the provider keeps the newest pending snapshot and saves it after the current
request succeeds. This coalesces rapid actions while preserving revision order.

On success, the provider records the returned revision. It only clears the
unsaved indicator when the snapshot acknowledged by the server is still the
newest local snapshot; otherwise it immediately continues with the pending
state.

On a transient read or write failure, the current in-memory state remains usable
and is marked unsaved. A manual retry and a subsequent durable mutation may
retry the latest complete snapshot with the unchanged expected revision. No
state is written to browser storage.

### Conflict

When save returns a revision conflict, the provider stops autosave for that
namespace and retains the user's current in-memory state. It must not retry the
same write automatically because doing so with a refreshed revision would hide
the conflict and overwrite the other editor.

The workbench displays a persistent cloud-conflict message with a "Load cloud
version" action. That action explicitly discards the current unsaved in-memory
state, reloads and validates the latest cloud row, records its revision, and
reenables autosave. Navigating away or refreshing has the same effective data
outcome but is not required for recovery.

### Reset

The existing reset operation calls the atomic reset function using the current
revision. A successful reset replaces memory with a fresh state at revision `0`.
A conflict leaves both local memory and cloud state unchanged, enters the same
conflict mode, and offers "Load cloud version". Reset never deletes a newer row
created by another tab.

## Loading And Error Experience

- While initial cloud hydration is pending, show a simulation loading state and
  disable actions that mutate durable session state.
- A transient load failure shows a retry action and does not initialize an
  autosavable empty state.
- A transient save failure shows a persistent unsaved warning and retry action;
  the in-memory workflow remains available for the current page lifetime.
- A conflict has distinct wording from a network failure, stops autosave, and
  offers "Load cloud version".
- Unsupported or invalid cloud state is never dispatched and is never
  automatically overwritten. The UI reports the validation problem and leaves
  reset as an explicit user action.
- Authorization failures follow Studio's existing inaccessible-project behavior
  and do not reveal whether another user's simulation row exists.
- Project switches never send the previous project's pending state under the new
  project ID. Results and timers belonging to the old namespace are ignored.

## Local Data And Rollout

The cloud implementation starts from cloud state only. It does not inspect,
import, delete, or update existing `keco.simulation.sessions:*` local-storage
keys. A user with only old local data sees an empty cloud simulation state and
must import or create a session again. Leaving old keys untouched makes rollout
non-destructive while ensuring they can never become an accidental fallback.

The migration must be deployed before application code that calls the new table
and functions. No runtime feature flag or dual-write period is introduced.

Update architecture documentation to identify Supabase as the durable store for
simulation sessions and remove statements that simulation mutations are local
only.

## Testing Strategy

### Repository Unit Tests

- Load an absent row as fresh state at revision `0`.
- Validate and deep-freeze a valid cloud snapshot.
- Reject malformed, unsupported-version, invalid-reference, and wrong-project
  snapshots.
- Create at expected revision `0`, update at the current revision, and return the
  new server revision.
- Classify stale save and stale reset as conflicts.
- Classify authorization, read, write, reset, and unavailable-client failures.
- Verify the repository never accepts or sends a caller-provided user ID.

Remove tests that only assert local-storage key encoding, `Storage` exceptions,
and per-key browser isolation. Retain version migration and complete schema
validation tests at the repository boundary.

### Provider Tests

- Hydrate before enabling autosave.
- Never save the reducer's empty initial state over pending cloud data.
- Coalesce rapid state changes with one request in flight.
- Save a newer pending snapshot after an earlier snapshot succeeds.
- Keep memory usable and mark it unsaved after a transient failure.
- Retry the newest snapshot with the same revision after a transient failure.
- Stop autosave after a conflict and load cloud state only after the explicit
  recovery action.
- Ignore late load and save results after project or user namespace changes.
- Reset with the current revision and reject stale resets.

### Database And RLS Tests

- An authenticated user can read their own state and can create, update, and
  delete it only through the revision-aware RPCs.
- Owners and accepted collaborators of each role can maintain only their own
  state.
- Users cannot access another user's row in the same project.
- Users without current project access cannot access a state row.
- Callers cannot select a different user through either RPC.
- Pending collaborators cannot read state or call either mutation RPC.
- Authenticated clients cannot bypass revision checks with direct table writes.
- Create starts at revision `1`; each successful update increments exactly once.
- Concurrent calls using the same expected revision yield one success and one
  conflict without lost updates.
- A stale reset cannot delete a newer row.
- User and project deletion cascade to simulation state.

### Existing Coverage And Verification

Keep reducer, import adapter, battle engine, workbench, and route coverage. Run
focused simulation and database tests first, followed by:

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run test:unit
npm run build
```

Run the focused Playwright simulation flow when the configured Supabase test
environment is available. Report it as not run when the environment is absent.

## Acceptance Criteria

- Simulation state survives refresh and appears on another browser or device for
  the same authenticated user and Studio project.
- A different user, including a collaborator in the same project, cannot read or
  mutate that state.
- Existing browser-local simulation data is neither loaded nor migrated.
- No native workbench session state is written to `localStorage`.
- A stale tab cannot overwrite or reset newer cloud state.
- Network or service failures preserve the current in-memory workflow and show
  an unsaved warning.
- Conflict recovery requires an explicit load of the latest cloud version.
- Invalid cloud state cannot crash the workbench or be silently overwritten.
- Architecture documentation and tests describe Supabase, rather than browser
  storage, as the durable simulation persistence layer.
