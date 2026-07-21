# Native Simulation Demo Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the complete `keco-simulation-demo` workflow into `keco-studio` as a native, project-aware `/simulation-system` feature with local, project-scoped persistence.

**Architecture:** Keep the demo's visual workflow but split its domain logic, Studio data adapter, durable session reducer, local repository, and React workbench into separate modules. The Studio dashboard owns authentication and the product rail; the simulation feature owns its inner sidebar/header and workflow screens. Supabase is read-only during import, while all simulation state after import is local.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase services already in `keco-studio`, React Query, Jest, Playwright, CSS Modules.

---

## File Map

Create the following focused modules:

- `src/lib/simulation/types.ts`: simulation domain types, DTOs, mapping keys, snapshots, sessions, and errors.
- `src/lib/simulation/data.ts`: typed demo defaults, simulation field definitions, constants, and pure helpers.
- `src/lib/simulation/battleEngine.ts`: typed pure battle engine with injectable randomness.
- `src/lib/simulation/importAdapter.ts`: strict Studio schema/asset conversion and validation.
- `src/lib/simulation/studioData.ts`: authorized project/library/schema/asset loading facade.
- `src/lib/simulation/projectPreference.ts`: last valid native Studio project selection.
- `src/lib/simulation/storage.ts`: versioned local repository and schema migration/validation.
- `src/lib/simulation/sessionReducer.ts`: durable simulator session state and actions.
- `src/lib/simulation/useBattlePlayback.ts`: event playback and timer cleanup.
- `src/lib/simulation/SimulationProjectProvider.tsx`: project/library source context.
- `src/lib/simulation/SimulationSessionProvider.tsx`: reducer, repository, and active-session context.
- `src/components/simulation/workbench/*`: migrated screens and presentation components.
- `src/app/(dashboard)/simulation-system/SimulationWorkbenchPage.tsx`: route-level composition.
- `src/app/(dashboard)/simulation-system/SimulationWorkbenchPage.module.css`: dashboard-aware sizing.

Create focused tests under `tests/unit/simulation/` and one Playwright spec under `tests/e2e/specs/simulation-system.spec.ts`.

Modify only the simulation route/layout and simulation-specific Studio helpers after checking their current callers. Do not revert or stage the existing unrelated document-editor changes in the worktree.

## Task 1: Define Simulation Domain Types And Port Pure Defaults

**Files:**
- Create: `src/lib/simulation/types.ts`
- Create: `src/lib/simulation/data.ts`
- Create: `tests/unit/simulation/data.test.ts`

- [ ] **Step 1: Write failing tests for typed helpers and default behavior**

Add tests for `needExp`, `skillCost`, `skillPower`, `sortRosterByTeam`, `createCharSnapshot`, and `autoMapFields`. The first test should import the new module and fail because it does not exist. Defaults use `DEMO_CATALOG`, `DEMO_LEVEL_RULES`, and `DEMO_SKILL_COST_RULES`, while every helper also accepts imported rules/catalogs.

```ts
import { describe, expect, it } from '@jest/globals';
import { autoMapFields, createCharSnapshot, needExp, skillCost, sortRosterByTeam } from '@/lib/simulation/data';

describe('simulation data helpers', () => {
  it('keeps the demo progression formulas', () => {
    expect(needExp(1)).toBe(100);
    expect(needExp(3)).toBe(420);
    expect(skillCost(1)).toBe(1);
    expect(skillCost(5)).toBeNull();
  });

  it('maps canonical fields without reusing a Studio column', () => {
    const mapping = autoMapFields('characters', {});
    expect(mapping.id).toBe('char_id');
    expect(new Set(Object.values(mapping)).size).toBe(Object.values(mapping).length);
  });

  it('creates snapshots and orders Team A before Team B', () => {
    expect(createCharSnapshot('ignara')).toMatchObject({ name: 'Ignara', lv: 1 });
    expect(sortRosterByTeam([
      { uid: 'b', tmplId: 'ignara', team: 'B' },
      { uid: 'a', tmplId: 'bramwell', team: 'A' },
    ])[0].team).toBe('A');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the missing-module failure**

Run `npx jest tests/unit/simulation/data.test.ts --runInBand`. Expected: FAIL with a module-not-found error for `@/lib/simulation/data`.

- [ ] **Step 3: Port the demo constants and helpers into typed modules**

Copy the demo's `CHARS`, `BASIC`, `SKILLS`, `EL`, `STRONG`, `LIB_DEFS`, `SIM_FIELDS`, and `STEPS` into `data.ts`, replacing implicit JS objects with exported TypeScript types from `types.ts`. Preserve IDs and formulas exactly. Define `RosterEntry`, `Loadout`, `SkillLevels`, `ProgressionState`, `LibraryRole`, `FieldMapping`, `SimulationCatalog`, `LevelRule`, and `SkillCostRule` in `types.ts`. `createCharSnapshot` and roster sorting accept a catalog, while `needExp` and `skillCost` accept imported rule arrays. Keep demo defaults only for unit fixtures and a pre-import preview; imported sessions always use their snapshot catalog and rules.

Declare strict canonical requirements in `SIM_FIELDS`: characters require `id`, `name`, `el`, `hp`, `atk`, `def`, `spd`, and `mp`; skills require `id`, `name`, `el`, `mp`, `power`, `cd`, and `kind`, with optional `status` and `fx`; level rules require `level`, `exp`, and `sp`; skill-cost rules require `lv` and `cost`. Valid `kind` values are `dmg`, `heal`, and `buff`; valid status values are `burn`, `dot`, `freeze`, `stun`, or empty.

- [ ] **Step 4: Run the focused tests and typecheck the new modules**

Run `npx jest tests/unit/simulation/data.test.ts --runInBand` and `npx tsc --noEmit`. Expected: PASS and no new TypeScript errors.

- [ ] **Step 5: Commit the domain data port**

```bash
git add src/lib/simulation/types.ts src/lib/simulation/data.ts tests/unit/simulation/data.test.ts
git commit -m "feat: add typed simulation domain data"
```

## Task 2: Port And Stabilize The Battle Engine

**Files:**
- Create: `src/lib/simulation/battleEngine.ts`
- Create: `tests/unit/simulation/battleEngine.test.ts`

- [ ] **Step 1: Write deterministic battle tests**

Test elemental multipliers, fighter construction, a recorded battle winner, event snapshots, and batch-compatible non-recorded output. Inject a fixed random function instead of relying on `Math.random`.

```ts
import { describe, expect, it } from '@jest/globals';
import { eleMult, simulate } from '@/lib/simulation/battleEngine';
import { DEMO_CATALOG } from '@/lib/simulation/data';

const roster = [
  { uid: 'a', tmplId: 'ignara', team: 'A' as const, snapshot: null },
  { uid: 'b', tmplId: 'bramwell', team: 'B' as const, snapshot: null },
];

describe('battle engine', () => {
  it('preserves the demo elemental rules', () => {
    expect(eleMult('Fire', 'Earth')).toBe(1.5);
    expect(eleMult('Earth', 'Fire')).toBe(0.7);
    expect(eleMult('Physical', 'Light')).toBe(1);
  });

  it('returns a winner and recorded snapshots with deterministic randomness', () => {
    const result = simulate(DEMO_CATALOG, roster, { a: ['fireball'], b: ['stoneskin'] }, { a: { fireball: 1 }, b: { stoneskin: 1 } }, true, () => 0.5);
    expect(['A', 'B']).toContain(result.winner);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].snap[0]).toHaveProperty('uid');
  });
});
```

- [ ] **Step 2: Run the test to capture the expected missing implementation**

Run `npx jest tests/unit/simulation/battleEngine.test.ts --runInBand`. Expected: FAIL because the module and typed `simulate` signature do not exist.

- [ ] **Step 3: Port the engine without behavior changes**

Move the demo algorithm into `battleEngine.ts`. Change the public signature to `simulate(catalog, roster, loadout, skillLv, record, random = Math.random)`, pass the same `SimulationCatalog` to `buildFighters`, and replace every lookup of module-global `CHARS`/`SKILLS` with catalog lookup. Replace each random call with `random()`. Keep the 40-round cap, status effects, damage formulas, event tags, and winner fallback unchanged. Export `buildFighters`, `displayUnits`, `eleMult`, and `simulate`.

- [ ] **Step 4: Run battle tests and compare the old demo output**

Run `npx jest tests/unit/simulation/battleEngine.test.ts --runInBand`, then run `npm run build` in `/home/ltt/project/keco-simulation-demo`. Expected: the deterministic tests pass and the unchanged source demo still builds as the behavior reference.

- [ ] **Step 5: Commit the engine port**

```bash
git add src/lib/simulation/battleEngine.ts tests/unit/simulation/battleEngine.test.ts
git commit -m "feat: port deterministic simulation battle engine"
```

## Task 3: Add Strict Studio Import Adapter And Read Facade

**Files:**
- Create: `src/lib/simulation/importAdapter.ts`
- Create: `src/lib/simulation/studioData.ts`
- Create: `tests/unit/simulation/fixtures.ts`
- Create: `tests/unit/simulation/importAdapter.test.ts`

- [ ] **Step 1: Write failing adapter tests for success and every strict error class**

Cover valid characters/skills/level/skill-cost conversion, missing required mapping, missing required value, invalid number, duplicate IDs, invalid enum, and unresolved references. Assert each error contains role, asset ID/name, and field label.

```ts
import { makeValidSources, validMappings } from './fixtures';

it('rejects a required numeric field with its source location', () => {
  const sources = makeValidSources();
  sources.characters.assets[0].propertyValues.base_hp = 'not-a-number';
  const result = convertImportedLibraries(sources, validMappings);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors[0]).toMatchObject({ role: 'characters', field: 'Base HP', assetName: 'Ignara' });
  }
});
```

- [ ] **Step 2: Run adapter tests and confirm they fail before implementation**

Run `npx jest tests/unit/simulation/importAdapter.test.ts --runInBand`. Expected: FAIL because `convertImportedLibraries` is not defined.

- [ ] **Step 3: Implement normalized DTOs and strict conversion**

Define `StudioLibrarySource` as `{ library: Library; fields: PropertyConfig[]; assets: AssetRow[] }`. Add `fixtures.ts` builders that use this exact DTO shape and the four canonical mappings. Normalize field IDs to the exact `propertyValues` keys returned by `getLibraryAssetsWithProperties`. Convert only explicit string/number/boolean/enum values. Return `{ ok: true, snapshot }` or `{ ok: false, errors }` without mutating any caller state. `ImportedSimulationSnapshot` contains `catalog`, sorted `levelRules`, sorted `skillCostRules`, source IDs, field mappings, and import timestamp so all downstream calculations use imported data.

- [ ] **Step 4: Implement the authorized read facade**

In `studioData.ts`, expose `loadSimulationProjectSources(supabase, projectId, libraryIds)`. Use `listLibraries` for project libraries, `getLibrarySchema` for fields, and `getLibraryAssetsWithProperties` for rows. Validate that every selected library belongs to the selected project and rely on existing authorization checks. Return normalized sources keyed by `LibraryRole`.

- [ ] **Step 5: Run adapter and existing service tests**

Run `npx jest tests/unit/simulation/importAdapter.test.ts src/lib/services/scriptImportService.test.ts --runInBand` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit the import boundary**

```bash
git add src/lib/simulation/importAdapter.ts src/lib/simulation/studioData.ts tests/unit/simulation/fixtures.ts tests/unit/simulation/importAdapter.test.ts
git commit -m "feat: add strict Studio simulation import adapter"
```

## Task 4: Add Versioned Project-Scoped Storage And Session Reducer

**Files:**
- Create: `src/lib/simulation/storage.ts`
- Create: `src/lib/simulation/sessionReducer.ts`
- Create: `tests/unit/simulation/storage.test.ts`
- Create: `tests/unit/simulation/sessionReducer.test.ts`

- [ ] **Step 1: Write failing storage tests**

Test key isolation, JSON round-trip, schema version migration, malformed JSON, unsupported versions, and a `setItem` exception. Use a fake `Storage` object injected into `createSimulationRepository(storage)`.

```ts
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

it('isolates state by user and Studio project', async () => {
  const repo = createSimulationRepository(new MemoryStorage());
  const state = { version: 1 as const, activeSessionId: null, sessions: [] };
  await repo.save('user-1', 'project-a', state);
  expect(await repo.load('user-1', 'project-b')).toBeNull();
  expect(await repo.load('user-1', 'project-a')).toMatchObject({ version: 1 });
});
```

- [ ] **Step 2: Write failing reducer tests**

Test `SESSION_CREATED`, `IMPORT_COMMITTED`, `ROSTER_UPDATED`, `SKILL_UPDATED`, `PROGRESSION_UPDATED`, `ACTIVE_SESSION_SELECTED`, and `PROJECT_CHANGED`. Assert unrelated simulator sessions remain untouched.

- [ ] **Step 3: Implement the repository and schema guard**

Use a key such as `keco.simulation.v1:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`. Parse and validate the envelope before returning it. Return `null` for missing/corrupt/unsupported values and expose a `clear` method. Catch write errors and return a typed result so the provider can show a persistence warning.

- [ ] **Step 4: Implement the reducer and initial state helpers**

Keep durable state separate from battle playback. Reducer actions must be serializable and preserve immutable updates. Use a migration helper to upgrade prior versions before reducer initialization.

- [ ] **Step 5: Run storage and reducer tests**

Run `npx jest tests/unit/simulation/storage.test.ts tests/unit/simulation/sessionReducer.test.ts --runInBand` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit the state boundary**

```bash
git add src/lib/simulation/storage.ts src/lib/simulation/sessionReducer.ts tests/unit/simulation/storage.test.ts tests/unit/simulation/sessionReducer.test.ts
git commit -m "feat: persist project-scoped simulation sessions locally"
```

## Task 5: Migrate Presentation Components And Scoped Styles

**Files:**
- Create: `src/components/simulation/workbench/SimulationSidebar.tsx`
- Create: `src/components/simulation/workbench/SimulationHeader.tsx`
- Create: `src/components/simulation/workbench/SimulationButton.tsx`
- Create: `src/components/simulation/workbench/SimulationToast.tsx`
- Create: `src/components/simulation/workbench/Arena.tsx`
- Create: `src/components/simulation/workbench/SimulationWorkbench.module.css`
- Create: `src/components/simulation/workbench/simulationTokens.css`
- Create: `tests/unit/simulation/workbench-static.test.ts`

- [ ] **Step 1: Add a static migration test**

Assert the new components expose accessible labels for Import, project selection, simulator sessions, collapse/expand, and each workflow step. Assert no component imports from `keco-simulation-demo` or uses global `document.body` styles.

- [ ] **Step 2: Port presentation components from the demo**

Convert JSX to TSX props with explicit types from `types.ts`. Preserve labels, colors, interaction states, and icon markup. Replace demo globals (`var(--surface-3)`, etc.) with selectors rooted under `.simulationRoot` and the new token file. Use buttons for all clickable controls and `aria-current` for active steps.

- [ ] **Step 3: Port Arena and verify layout constraints**

Keep the demo's token, health bars, effects, and log presentation. Add `min-width: 0`, `min-height: 0`, bounded grid columns, and a mobile media query that stacks the log and arena. Do not use a second full-page `100vh` inside the Dashboard content area.

- [ ] **Step 4: Run lint and the static test**

Run `npx jest tests/unit/simulation/workbench-static.test.ts --runInBand` and `npm run lint -- --quiet`. Expected: new components pass without introducing global CSS lint errors.

- [ ] **Step 5: Commit presentation components**

```bash
git add src/components/simulation/workbench tests/unit/simulation/workbench-static.test.ts
git commit -m "feat: add native simulation workbench presentation"
```

## Task 6: Add Project And Session Providers Plus Battle Playback

**Files:**
- Create: `src/lib/simulation/SimulationProjectProvider.tsx`
- Create: `src/lib/simulation/SimulationSessionProvider.tsx`
- Create: `src/lib/simulation/useBattlePlayback.ts`
- Create: `tests/unit/simulation/providers-static.test.ts`

- [ ] **Step 1: Write provider contract tests**

Assert the project provider uses `useSidebarProjects`, query keys include project/library IDs, and the session provider uses the storage repository rather than direct `localStorage` calls. Assert playback registers and clears its interval on stop and unmount.

- [ ] **Step 2: Implement `SimulationProjectProvider`**

Use the authenticated user profile and existing `useSidebarProjects`. Keep selected project in provider state, restore the last valid project handoff, and query project libraries with `listLibraries`. Expose `loadSources`, `retry`, `loading`, `error`, and `unavailableLibraryIds`. Never return a source for a project that is not current.

- [ ] **Step 3: Implement `SimulationSessionProvider`**

Load state when both user ID and selected project ID are present. Dispatch reducer actions for simulator edits and debounce repository saves. Expose `activeSession`, `simulators`, `importSnapshot`, `commitImport`, `selectSession`, `startFreshImport`, and a persistence warning. Keep the failed-import path free of any reducer commit.

- [ ] **Step 4: Implement `useBattlePlayback`**

Run the pure engine once, store events in refs, advance one event per interval, expose `start`, `stop`, `phase`, `units`, `logs`, `result`, and active actor/target state, and clear every interval in the effect cleanup. On completion, return a progression reward payload for the session provider to commit.

- [ ] **Step 5: Run provider static tests and typecheck**

Run `npx jest tests/unit/simulation/providers-static.test.ts --runInBand` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit providers and playback**

```bash
git add src/lib/simulation/SimulationProjectProvider.tsx src/lib/simulation/SimulationSessionProvider.tsx src/lib/simulation/useBattlePlayback.ts tests/unit/simulation/providers-static.test.ts
git commit -m "feat: connect simulation project data and session state"
```

## Task 7: Migrate The Five Workflow Screens Into The Workbench

**Files:**
- Create: `src/components/simulation/workbench/ImportScreen.tsx`
- Create: `src/components/simulation/workbench/CharactersScreen.tsx`
- Create: `src/components/simulation/workbench/SkillsScreen.tsx`
- Create: `src/components/simulation/workbench/ProgressionScreen.tsx`
- Create: `src/components/simulation/workbench/BattleScreen.tsx`
- Create: `src/components/simulation/workbench/SimulationWorkbench.tsx`
- Create: `src/components/simulation/workbench/SimulationWorkbench.module.css` (extend from Task 5)
- Create: `tests/unit/simulation/workbench-flow.test.tsx`

- [ ] **Step 1: Write failing workflow component tests**

Cover Import's four roles and strict error display, Characters team assignment/removal, Skills six-skill limit, Progression skill cost/refund, and Battle start/batch controls. Mock providers at their public context boundaries.

- [ ] **Step 2: Port Import screen against provider contracts**

Replace demo library option strings with the selected project's real `Library` objects. Display real field labels and rows from the provider. Keep automatic mapping, allow manual mapping, call `loadSources` then `convertImportedLibraries`, and call `commitImport` only on `{ ok: true }`. Show source-location validation errors without clearing the current session.

- [ ] **Step 3: Port Characters, Skills, and Progression screens**

Use snapshot characters, skills, level rules, and skill-cost rules instead of hard-coded demo lists. Preserve team balancing, active character selection, six-skill cap, skill upgrade/refund costs, level bounds defined by the imported rules, SP adjustment, and navigation guards. Dispatch provider actions rather than maintaining duplicated screen-local durable state.

- [ ] **Step 4: Port Battle screen and playback wiring**

Use `useBattlePlayback` with `activeSession.snapshot.catalog`, retain the arena/log/result/batch presentation, and calculate/commit winner EXP and level-ups from `snapshot.levelRules` only after playback completes. Stop playback before navigation, fresh import, project switch, and session switch.

- [ ] **Step 5: Implement `SimulationWorkbench` composition**

Render the simulation root, inner sidebar, header, active screen, toast, project/library loading states, and no-project empty state. Keep `LeftNav` outside this component in `DashboardLayout`.

- [ ] **Step 6: Run workflow tests and typecheck**

Run `npx jest tests/unit/simulation/workbench-flow.test.tsx --runInBand` and `npx tsc --noEmit`.

- [ ] **Step 7: Commit the workflow migration**

```bash
git add src/components/simulation/workbench tests/unit/simulation/workbench-flow.test.tsx
git commit -m "feat: migrate simulation import and battle workflows"
```

## Task 8: Replace The Iframe Route And Remove External Configuration

**Files:**
- Create: `src/app/(dashboard)/simulation-system/SimulationWorkbenchPage.tsx`
- Create: `src/app/(dashboard)/simulation-system/SimulationWorkbenchPage.module.css`
- Create: `src/lib/simulation/projectPreference.ts`
- Modify: `src/app/(dashboard)/simulation-system/[[...segments]]/page.tsx`
- Modify: `src/app/(dashboard)/simulation-system/layout.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/lib/contexts/NavigationContext.tsx`
- Delete: `src/app/(dashboard)/simulation-system/SimulationSystemEmbed.tsx`
- Delete: `src/app/(dashboard)/simulation-system/SimulationSystemEmbed.module.css`
- Delete: `src/components/simulation/SimulationOriginWarmup.tsx`
- Delete: `src/lib/simulationClientConfig.ts`
- Delete: `src/lib/simulationEmbedSrc.ts`
- Delete: `src/lib/simulationProjectHandoff.ts`
- Delete: `env.simulation.example`
- Modify: README/config references found by `rg -n "SIMULATION_|SimulationSystemEmbed|simulation embed" . -g '!node_modules' -g '!.next'`
- Modify: `tests/unit/layout/leftnav-wiring.test.ts`

- [ ] **Step 1: Write failing static route assertions**

Change the existing embed test to assert the catch-all page imports the native workbench, `DashboardLayout` no longer imports warmup/config gates, and no source/config file contains `NEXT_PUBLIC_SIMULATION_`, `SimulationSystemEmbed`, or an iframe URL.

- [ ] **Step 2: Add the native route page**

Make `SimulationWorkbenchPage.tsx` a client boundary that renders `SimulationProjectProvider`, `SimulationSessionProvider`, and `SimulationWorkbench`. Keep the catch-all page's Suspense fallback and route all segments to this page.

- [ ] **Step 3: Update dashboard layout behavior**

Derive `hideSidebarForSimulation` only from the pathname prefix. Keep `LeftNav` mounted. Remove `SimulationOriginWarmup` and all external-origin checks. Ensure the main content has `min-width: 0` and the native workbench fills available height.

- [ ] **Step 4: Remove iframe code and stale configuration**

Delete unused embed components/helpers and remove their environment example and README instructions. Move the storage key and read/write behavior from `simulationProjectHandoff.ts` into `src/lib/simulation/projectPreference.ts`, rename its public API to `readSimulationProjectPreference` and `writeSimulationProjectPreference`, and update `NavigationContext.tsx` plus the project provider to use it. Do not remove unrelated Studio configuration.

- [ ] **Step 5: Run static route tests and typecheck**

Run `npx jest tests/unit/layout/leftnav-wiring.test.ts tests/unit/simulation --runInBand` and `npx tsc --noEmit`. Expected: no stale iframe references and no missing imports.

- [ ] **Step 6: Commit the route replacement**

```bash
git add -A src/app/'(dashboard)'/simulation-system src/components/layout/DashboardLayout.tsx src/components/simulation src/lib/simulation src/lib/simulationClientConfig.ts src/lib/simulationEmbedSrc.ts src/lib/simulationProjectHandoff.ts src/lib/contexts/NavigationContext.tsx env.simulation.example tests/unit/layout/leftnav-wiring.test.ts
git commit -m "feat: replace simulation iframe with native Studio route"
```

## Task 9: Add End-To-End Coverage, Run Verification, And Update Docs

**Files:**
- Create: `tests/e2e/specs/simulation-system.spec.ts`
- Create: `tests/e2e/pages/simulation-system.page.ts`
- Modify: `README.md`
- Modify: `docs/architecture/ARCHITECTURE.md`

- [ ] **Step 1: Add the Playwright page object and focused flow**

Use existing auth helpers and seeded project/library factories. Cover login, opening `/simulation-system`, selecting four real libraries, mapping required fields, successful import, configuring both teams, starting a battle, and refreshing to restore the project-scoped session. Add stable `data-testid` attributes only where semantic roles are insufficient.

- [ ] **Step 2: Run the focused E2E test in the configured environment**

Run `npx playwright test tests/e2e/specs/simulation-system.spec.ts --workers=1`. Expected: PASS when local Supabase and seeded credentials are available. If unavailable, record the exact prerequisite failure and continue with unit/build verification.

- [ ] **Step 3: Update user-facing run instructions**

Document that `npm run dev` starts both Studio and the native `/simulation-system`; remove instructions for a sibling simulator server, iframe environment variables, or external origins. Document that imported simulation state is local and project-scoped.

- [ ] **Step 4: Run the complete verification suite**

Run, in order:

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run test:unit -- --runInBand
npm run build
```

Expected: all commands exit 0. If an existing unrelated dirty-file failure appears, separate it from simulation failures and report it without reverting the user's changes.

- [ ] **Step 5: Review the diff and commit documentation/test changes**

Run `git diff --check`, `git status --short`, and `git diff --stat HEAD~1`. Confirm no `node_modules`, `.next`, generated reports, or unrelated document-editor files are staged.

```bash
git add tests/e2e/specs/simulation-system.spec.ts tests/e2e/pages/simulation-system.page.ts README.md docs/architecture/ARCHITECTURE.md
git commit -m "test: verify native simulation workflow"
```

## Final Acceptance Checklist

- [ ] `keco-studio` runs the complete simulator without a second server.
- [ ] `/simulation-system` contains no iframe or external-origin dependency.
- [ ] Studio `LeftNav` remains visible and the resource sidebar/top bar are hidden only for the simulation route.
- [ ] Import reads authorized project libraries, field definitions, and asset rows.
- [ ] Strict conversion is atomic and reports source row/field errors.
- [ ] Characters, Skills, Progression, Battle, and batch simulation preserve demo behavior.
- [ ] Local storage is versioned and isolated by user/project.
- [ ] Refresh restores simulator sessions without writing simulation state to Supabase.
- [ ] Unit, typecheck, lint, build, and available E2E verification are recorded with evidence.
