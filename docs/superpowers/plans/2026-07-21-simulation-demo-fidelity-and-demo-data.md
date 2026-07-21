# Simulation Demo Fidelity And Demo Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native `/simulation-system` visually match `keco-simulation-demo` while adding an explicit built-in demo-data path alongside strict Studio imports.

**Architecture:** Keep the existing typed session, storage, Studio adapter, and battle engine boundaries. Add a pure built-in snapshot factory, then reshape only the workbench presentation to the source demo's component hierarchy and visual tokens. Both data paths commit the same immutable snapshot type and feed the same workflow screens.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Jest, Playwright.

---

## File Map

- `src/lib/simulation/data.ts`: create a deterministic imported snapshot from built-in demo constants.
- `src/components/simulation/workbench/ImportScreen.tsx`: expose Demo data and Studio data as explicit import paths.
- `src/components/simulation/workbench/simulationTokens.css`: mirror source demo tokens within `[data-simulation-root]`.
- `src/components/simulation/workbench/SimulationWorkbench.module.css`: mirror source layout and interaction styling without global leakage.
- `src/components/simulation/workbench/SimulationSidebar.tsx`: source-demo simulator navigation.
- `src/components/simulation/workbench/SimulationHeader.tsx`: source-demo workflow header.
- `src/components/simulation/workbench/{CharactersScreen,SkillsScreen,ProgressionScreen,BattleScreen,Arena}.tsx`: preserve the source demo's screen hierarchy and feedback.
- `tests/unit/simulation/{data,workbench-flow,workbench-static}.test.ts`: demo source and fidelity contracts.
- `tests/e2e/pages/simulation-system.page.ts`: exercise built-in demo data by default while keeping Studio import helpers.

## Task 1: Add Explicit Demo Snapshot Import

**Files:**
- Modify: `src/lib/simulation/data.ts`
- Modify: `src/components/simulation/workbench/ImportScreen.tsx`
- Modify: `tests/unit/simulation/data.test.ts`
- Modify: `tests/unit/simulation/workbench-flow.test.tsx`

- [ ] **Step 1: Write failing factory and workflow tests**

Add assertions that `createDemoImportedSnapshot('project-1', importedAt)` returns the built-in catalog/rules with `sourceLibraryIds` set to `demo:*`, and that Import renders `Use demo data` plus `Import Studio data`.

```ts
const snapshot = createDemoImportedSnapshot('project-1', '2026-07-21T00:00:00.000Z');
expect(snapshot.sourceProjectId).toBe('project-1');
expect(snapshot.catalog).toEqual(DEMO_CATALOG);
expect(snapshot.sourceLibraryIds.characters).toBe('demo:characters');
expect(snapshot.importedAt).toBe('2026-07-21T00:00:00.000Z');
```

- [ ] **Step 2: Verify RED**

Run `npx jest tests/unit/simulation/data.test.ts tests/unit/simulation/workbench-flow.test.tsx --runInBand`.
Expected: FAIL because the factory and demo import control do not exist.

- [ ] **Step 3: Implement the pure factory and UI action**

Create a deep-cloned `ImportedSimulationSnapshot` using `DEMO_CATALOG`, `DEMO_LEVEL_RULES`, `DEMO_SKILL_COST_RULES`, empty mappings, and demo source IDs. In `ImportScreen`, call:

```ts
commitImport(createDemoImportedSnapshot(selectedProjectId), name);
```

Keep the Studio selectors, mappings, validation errors, and `importSimulationSnapshot` action under the separate Studio path.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused Jest command plus `npm run typecheck`, then commit `feat: add simulation demo data source`.

## Task 2: Restore The Source Demo Shell

**Files:**
- Modify: `src/components/simulation/workbench/simulationTokens.css`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.module.css`
- Modify: `src/components/simulation/workbench/SimulationSidebar.tsx`
- Modify: `src/components/simulation/workbench/SimulationHeader.tsx`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.tsx`
- Modify: `tests/unit/simulation/workbench-static.test.ts`

- [ ] **Step 1: Write failing fidelity contracts**

Assert the scoped tokens contain source values `#0B99FF`, `#FA89B9`, `#F6F8FB`, `#FFFFFF`, `#152235`, the sidebar is light with the `KS` logo and explanatory copy, and header steps keep the source Import/Characters/Skills/Progression/Battle order.

- [ ] **Step 2: Verify RED**

Run `npx jest tests/unit/simulation/workbench-static.test.ts --runInBand` and confirm current dark-shell expectations fail.

- [ ] **Step 3: Port source shell styling**

Translate `/home/ltt/project/keco-simulation-demo/src/styles/tokens.css`, `components/Sidebar.jsx`, and `components/Header.jsx` into scoped CSS Module classes and typed components. Preserve the dashboard-height constraint and Studio `LeftNav`; do not use `100vh`, global element selectors, or external font imports.

- [ ] **Step 4: Verify GREEN and commit**

Run focused Jest, targeted ESLint, and typecheck, then commit `style: restore simulation demo shell`.

## Task 3: Restore Source Workflow And Arena Styling

**Files:**
- Modify: `src/components/simulation/workbench/ImportScreen.tsx`
- Modify: `src/components/simulation/workbench/CharactersScreen.tsx`
- Modify: `src/components/simulation/workbench/SkillsScreen.tsx`
- Modify: `src/components/simulation/workbench/ProgressionScreen.tsx`
- Modify: `src/components/simulation/workbench/BattleScreen.tsx`
- Modify: `src/components/simulation/workbench/Arena.tsx`
- Modify: `src/components/simulation/workbench/SimulationButton.tsx`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.module.css`
- Modify: `tests/unit/simulation/workbench-static.test.ts`

- [ ] **Step 1: Write failing presentation contracts**

Assert source-demo landmarks: import binding diagram, character catalog and snapshot roster, fighter tabs and six-skill table, progression skill cards, two-column battle log/arena, HP and MP values, actor lunge, target hit, and floating damage/heal text.

- [ ] **Step 2: Verify RED**

Run `npx jest tests/unit/simulation/workbench-static.test.ts tests/unit/simulation/workbench-flow.test.tsx --runInBand`.

- [ ] **Step 3: Port each source screen without changing domain behavior**

Use the original screen hierarchy and exact token values while retaining existing provider calls (`updateRoster`, `updateSkills`, `updateProgression`) and playback hook. Keep fixed-format grids responsive with explicit desktop and mobile tracks.

- [ ] **Step 4: Verify GREEN and commit**

Run all simulation Jest tests, typecheck, and targeted ESLint, then commit `style: match native simulator to source demo`.

## Task 4: Update Flow Coverage And Verify

**Files:**
- Modify: `tests/e2e/pages/simulation-system.page.ts`
- Modify: `tests/e2e/specs/simulation-system.spec.ts`
- Modify: `README.md`
- Modify: `docs/architecture/ARCHITECTURE.md`

- [ ] **Step 1: Cover the demo-data happy path**

Make the primary E2E flow choose `Use demo data`, configure both teams, assign skills, run battle, and verify refresh restoration. Retain a focused page-object method for real Studio imports.

- [ ] **Step 2: Document both sources**

State that one Next.js server hosts the route, built-in demo data is available for demonstrations, Studio library import remains available, and resulting sessions are local/user/project scoped.

- [ ] **Step 3: Run complete verification**

Run in order: `npm run lint`, `npm run typecheck`, `npm run typecheck:api`, `npm run test:unit -- --runInBand`, `npm run build`, then Playwright collection and full E2E when host Chromium dependencies are present.

- [ ] **Step 4: Review and commit**

Run `git diff --check`, inspect the complete diff for generated artifacts or unrelated files, and commit `test: verify simulation demo fidelity`.
