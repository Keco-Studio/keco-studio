# Native Simulation Demo Integration Design

**Date:** 2026-07-21
**Status:** Approved design
**Target repository:** `keco-studio`
**Source application:** `keco-simulation-demo`

## Summary

Migrate all functionality from `keco-simulation-demo` into `keco-studio` as a native Next.js feature. The merged application will run, test, and deploy as one Studio project without an iframe, a second development server, or `NEXT_PUBLIC_SIMULATION_*` configuration.

The native simulator will retain the demo's Import, Characters, Skills, Progression, and Battle workflows and its internal visual shell. It will run at `/simulation-system` inside Studio's authenticated dashboard, alongside Studio's product-level `LeftNav`.

The first version will read real Studio projects, library schemas, and asset rows from Supabase. Imported simulation snapshots and subsequent simulator state will be persisted locally, isolated by authenticated user and Studio project. The storage boundary will allow a later Supabase-backed implementation without changing the simulation domain or UI.

## Goals

- Make `keco-studio` the only application required to run the simulator.
- Preserve all user-visible workflows and battle behavior from `keco-simulation-demo`.
- Use real, authorized Studio projects and libraries as import sources.
- Convert imported Studio data into a stable local snapshot before simulation.
- Persist simulator sessions across refreshes and isolate them by user and project.
- Remove the existing external iframe integration and its configuration.
- Establish typed, testable boundaries between Studio data access, import conversion, simulation state, storage, and battle playback.

## Non-Goals

- Do not write simulation sessions, battle results, progression, or snapshots back to Supabase in this phase.
- Do not provide live synchronization between a Studio library and an already imported simulation snapshot.
- Do not redesign the demo to match Ant Design or the standard Studio resource views.
- Do not merge or delete the separate `keco-simulation` repository.
- Do not delete the `keco-simulation-demo` checkout; it remains historical source code but is no longer a runtime dependency.
- Do not refactor unrelated Studio modules or the user's existing uncommitted document-editor changes.

## Selected Approach

Implement a native, typed simulation feature in the Studio repository. This is preferred over copying the JSX unchanged because the current demo centralizes most state and behavior in a large `App.jsx`, making real Studio data integration, error handling, and future persistence changes difficult. A separate workspace package would create build and package-management overhead that is not justified by the current feature size.

The migration should preserve behavior while separating responsibilities into components, domain functions, adapters, hooks, and repositories.

## Application Architecture

### Routing And Shell

- Keep the authenticated route at `/simulation-system` under the existing dashboard route group.
- Render the simulator natively instead of `SimulationSystemEmbed`.
- Always hide Studio's resource `Sidebar` and `TopBar` on simulation routes, independent of environment variables.
- Keep Studio's product-level `LeftNav` visible.
- Render the demo's own simulator sidebar and step header inside the remaining content area.
- Use the available dashboard content height rather than `100vh`, so the simulator cannot overflow or overlap the product rail.
- Keep the catch-all simulation route and resolve every `/simulation-system` segment to the native workbench for compatibility. No route may proxy or embed an external simulator origin.

### Feature Boundaries

Place UI code under `src/components/simulation/workbench/` and domain/integration code under `src/lib/simulation/`. The implementation plan will assign exact filenames; the following responsibilities must remain separate:

- `SimulationWorkbench`: composes the internal sidebar, header, and active workflow screen.
- `SimulationProjectProvider`: exposes the authenticated user's accessible projects, selected project, libraries, schemas, asset rows, loading states, and retry operations.
- `SimulationSessionProvider`: owns simulator sessions and persisted state for the active user/project namespace.
- `simulationImportAdapter`: validates field mappings and converts Studio library schemas and asset rows into simulation-domain data.
- `battleEngine`: contains typed, framework-independent battle calculations.
- `useBattlePlayback`: owns timers, event playback, animation state, and cleanup.
- Screen components: Import, Characters, Skills, Progression, and Battle.
- Presentation components: simulator sidebar, step header, arena, buttons, and toast.

Studio-specific code supplies normalized DTOs to the simulation module. Simulation domain code must not import React Query, Supabase clients, or Next.js APIs.

## Data Model And Flow

### Project Selection

1. Load the authenticated user's accessible projects using Studio's existing project hook and authorization behavior.
2. Prefer the last valid project handed off from Studio navigation.
3. If that project is no longer accessible, select the first accessible project.
4. If the user has no projects, show an empty state with a route back to `/projects`.
5. Switching projects changes the active local-storage namespace and loads that project's simulator sessions.

### Library Import

1. Load all libraries for the selected project through the existing Studio service layer.
2. Require one library for each source role: characters, skills, levels, and skill costs.
3. Load the selected libraries' actual field definitions and asset rows.
4. Map canonical simulation fields to stable Studio field IDs. Mappings must be complete and one-to-one.
5. On Import, load and validate all four source datasets before changing the active simulator session.
6. Convert valid source data into an immutable `ImportedSimulationSnapshot` containing:
   - source project ID;
   - source library IDs;
   - field mappings;
   - import timestamp;
   - normalized characters, skills, level rules, and skill-cost rules.
7. Commit the new snapshot only when all selected libraries and rows pass validation.
8. Use the snapshot for character configuration, skills, progression, and battles. Do not query Supabase during battle execution.
9. Refresh source data only when the user explicitly imports again. Studio edits must not silently mutate an existing simulation.

### Strict Validation

Import is atomic and strict. Any missing required mapping, missing required value, incompatible type, unresolved reference, duplicate canonical identifier, or invalid numeric range blocks the entire import.

Errors must identify the source library, asset row, field, and reason. The existing session and snapshot remain unchanged after a failed import. Numeric or enum values must not be guessed or silently defaulted.

### Local Persistence

Define a repository interface for loading, saving, and clearing simulation session state. The first implementation uses `localStorage` with a versioned key containing both authenticated user ID and Studio project ID.

Persist:

- simulator list and names;
- active simulator ID;
- selected source libraries and field mappings;
- imported simulation snapshot;
- roster and team assignment;
- skill loadouts and skill levels;
- character levels, experience, and skill points;
- last non-import workflow screen.

Do not persist:

- active battle timer or current playback event;
- transient battle animation state;
- toast state;
- open menus and dropdowns;
- in-progress server requests.

Persisted values must be validated against a versioned schema before use. Storage migrations are explicit functions. Corrupt or unsupported data is isolated and never allowed to crash Studio. If writing fails, the current in-memory session remains usable and the UI warns that refresh persistence is unavailable.

## State And Component Design

Use a reducer for durable simulator session transitions. Actions should represent domain events such as project changed, session created, import committed, roster changed, skill changed, progression changed, and active session selected. Persistence subscribes to durable state changes through the repository boundary rather than being scattered across event handlers.

Battle playback remains separate from durable session state. `useBattlePlayback` starts a deterministic battle result, plays its events, clears timers on stop, navigation, project/session changes, and component unmount, then commits only durable rewards and progression when a battle completes.

The battle engine remains a pure module. It accepts roster, loadout, skill levels, and a random-number source. Production uses the standard random source; tests inject a deterministic source.

CSS should use local modules plus simulation-scoped design tokens. The visual result should match the demo while preventing its global tokens and element rules from affecting Studio. Fixed navigation and board dimensions require responsive constraints so labels, controls, and battle content do not overlap on supported desktop and mobile widths.

## Loading And Error Handling

- Show distinct loading states for projects, libraries, schemas, and assets.
- A failed refresh retains current selections and existing local sessions and offers retry.
- Query keys must include project and library IDs. Responses for a previously selected project must not replace current-project data.
- A deleted, inaccessible, or moved selected library is marked unavailable and must be reselected before import.
- Import first reads and validates every source, then commits once. Partial snapshots are forbidden.
- A storage schema failure presents a reset action scoped to the affected user/project namespace.
- A local-storage write failure displays a warning without interrupting the in-memory workflow.
- Existing local sessions remain viewable when fewer than four valid source libraries exist, but creating or re-importing a session is disabled.
- Authentication and RLS errors use existing Studio authorization behavior and must not expose data from inaccessible projects.

## Removing The Iframe Integration

Remove the external integration after the native route is wired:

- `SimulationSystemEmbed` and its iframe-specific styles;
- `SimulationOriginWarmup`;
- external-origin and self-embed configuration helpers;
- iframe URL construction;
- `NEXT_PUBLIC_SIMULATION_ENABLED`, `NEXT_PUBLIC_SIMULATION_ORIGIN`, and `NEXT_PUBLIC_SIMULATION_WARMUP` documentation and runtime branches.

Retain the project handoff concept only if it is still needed to restore the last Studio project when entering `/simulation-system`. Rename or relocate it into the native simulation module so it no longer implies an iframe contract.

## Testing Strategy

### Unit Tests

- Port battle-engine behavior tests and add deterministic random-source coverage for winners, damage events, healing, progression rewards, and batch results.
- Test experience requirements, skill upgrade/reset costs, team ordering, and snapshot helpers.
- Test automatic field matching, one-to-one mapping enforcement, and every strict validation category.
- Test conversion from real Studio schema/asset DTO shapes to the simulation snapshot.
- Test reducer transitions without React or browser dependencies.
- Test storage namespace isolation by user and project, refresh restoration, schema migration, corrupt values, unsupported versions, and write failures.
- Test timer cleanup and durable progression commits at the battle-playback boundary.

### Component And Integration Tests

- No accessible project and return-to-projects action.
- Project and library loading failures with retry.
- Project switching and per-project session restoration.
- Deleted or unauthorized selected libraries.
- Failed import retaining the prior snapshot.
- Successful import enabling the four downstream screens.
- Restoring an existing simulator session after remount.
- Native route layout preserving `LeftNav` while hiding Studio's resource sidebar and top bar.
- Static assertions that external iframe code and `NEXT_PUBLIC_SIMULATION_*` references are gone.

### End-To-End Test

Add a focused Playwright flow using seeded Studio data:

1. Authenticate and enter a Studio project.
2. Open the simulation system through `LeftNav`.
3. Select four real libraries and map their fields.
4. Import successfully.
5. Configure characters, teams, and skills.
6. Run a battle and observe completion.
7. Refresh and confirm the project-scoped simulator session is restored.

### Verification Commands

Run the focused simulation tests first, then:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Run the focused Playwright scenario when the required local Supabase and seeded test environment are available. If that environment is unavailable, report the E2E test as not run rather than treating it as passed.

## Acceptance Criteria

- `keco-studio` alone installs, starts, builds, and serves the complete simulation workflow.
- `/simulation-system` contains no iframe and requires no external simulator origin.
- Studio `LeftNav` remains visible; the resource sidebar and Studio top bar are hidden on the simulation route.
- The Import screen lists only projects and libraries accessible to the current user.
- Imports use real field definitions and asset rows from the four selected Studio libraries.
- Invalid source data blocks import with actionable row/field errors and does not mutate the current snapshot.
- All five demo workflows remain usable with equivalent battle and progression behavior.
- Simulator state survives refresh and is isolated by authenticated user and Studio project.
- No simulation data is written to Supabase in this phase.
- Old iframe code and `NEXT_PUBLIC_SIMULATION_*` configuration are removed.
- Focused tests plus lint, typecheck, unit tests, and production build pass.

## Rollout And Compatibility

The native route replaces the iframe in one change; no runtime feature flag is retained. Existing iframe-only browser state is not migrated because it belongs to a different origin and has no reliable same-origin access path. Users create or import native simulator sessions after deployment.

The source `keco-simulation-demo` repository is left untouched. Once the native implementation is accepted, repository owners may archive it separately, but archiving is outside this work.
