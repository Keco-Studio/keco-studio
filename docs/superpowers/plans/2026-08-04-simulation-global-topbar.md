# Simulation Global TopBar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the shared functional Studio TopBar on Simulation routes and remove the Simulation-only decorative search and avatar.

**Architecture:** `DashboardLayout` remains the owner of product-level chrome and will keep `TopBar` mounted for Simulation while continuing to hide the Studio resource sidebar and Agent chat. `SimulationHeader` remains the owner of project context and workflow navigation but no longer renders duplicate global controls.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, CSS Modules, Jest 30 static wiring tests

---

## File Structure

- Modify `src/components/layout/DashboardLayout.tsx`: show the shared `TopBar` on Simulation routes while preserving the existing Simulation sidebar/chat exclusions.
- Modify `src/components/simulation/workbench/SimulationHeader.tsx`: remove the decorative search placeholder and local avatar.
- Modify `src/components/simulation/workbench/SimulationWorkbench.module.css`: remove styles used only by the deleted Simulation header actions.
- Modify `tests/unit/layout/leftnav-wiring.test.ts`: guard the Simulation chrome contract.
- Modify `tests/unit/script-system/leftnav-script-wiring.test.ts`: replace the obsolete expectation that Simulation hides `TopBar`.
- Modify `tests/unit/simulation/workbench-static.test.ts`: guard the absence of duplicate search/profile controls and their CSS.

### Task 1: Lock The Shared TopBar Contract With Failing Tests

**Files:**
- Modify: `tests/unit/layout/leftnav-wiring.test.ts`
- Modify: `tests/unit/script-system/leftnav-script-wiring.test.ts`
- Modify: `tests/unit/simulation/workbench-static.test.ts`

- [ ] **Step 1: Update the layout wiring assertions**

Replace the Simulation layout assertion in `tests/unit/layout/leftnav-wiring.test.ts` with:

```ts
it('keeps the shared TopBar while simulation hides Studio resource chrome', () => {
  const source = read('src/components/layout/DashboardLayout.tsx');
  expect(source).toContain("import { LeftNav } from './LeftNav'");
  expect(source).toContain("import { TopBar } from './TopBar'");
  expect(source).toContain('<LeftNav');
  expect(source).toContain('<TopBar');
  expect(source).toContain("pathname?.startsWith('/simulation-system')");
  expect(source).not.toContain('hideTopBar');
  expect(source).not.toContain('SimulationOriginWarmup');
  expect(source).not.toContain('isSimulationEmbedConfigured');
});
```

In `tests/unit/script-system/leftnav-script-wiring.test.ts`, change the Script layout test so it no longer requires `hideTopBar` or `hideTopBar = hideSidebarForSimulation`:

```ts
it('DashboardLayout mounts product sidebars beside the shared TopBar', () => {
  const source = read('src/components/layout/DashboardLayout.tsx');
  expect(source).toContain('isScriptSystemPath');
  expect(source).toContain('showStudioSidebar');
  expect(source).toContain('showScriptSidebar');
  expect(source).toContain('ScriptSidebar');
  expect(source).toContain('hideChatPanel');
  expect(source).toContain('<TopBar');
  expect(source).not.toContain('hideTopBar');
  expect(source).toMatch(/showScriptSidebar\s*=\s*onScriptSystem/);
});
```

- [ ] **Step 2: Update the Simulation header presentation assertion**

Replace the decorative-search test in `tests/unit/simulation/workbench-static.test.ts` with:

```ts
it('keeps workflow navigation without duplicate global controls', () => {
  const source = read('SimulationHeader.tsx');
  const css = read('SimulationWorkbench.module.css');
  expect(source).toMatch(/<nav[^>]+aria-label=/);
  expect(source).toContain('aria-current');
  expect(source).not.toContain('Search libraries, characters, skills');
  expect(source).not.toContain('Simulator profile');
  expect(source).not.toContain('styles.headerActions');
  expect(css).not.toMatch(/\.headerActions\s*\{/);
  expect(css).not.toMatch(/\.searchIcon\s*\{/);
  expect(css).not.toMatch(/\.headerAvatar\s*\{/);
});
```

- [ ] **Step 3: Run the focused tests and verify the new contract fails**

Run:

```bash
npx jest --runInBand tests/unit/layout/leftnav-wiring.test.ts tests/unit/script-system/leftnav-script-wiring.test.ts tests/unit/simulation/workbench-static.test.ts
```

Expected: FAIL because `DashboardLayout` still contains `hideTopBar`, and `SimulationHeader` still contains the decorative search/profile controls.

### Task 2: Mount The Shared TopBar And Remove Duplicate Controls

**Files:**
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/components/simulation/workbench/SimulationHeader.tsx`
- Modify: `src/components/simulation/workbench/SimulationWorkbench.module.css`

- [ ] **Step 1: Keep `TopBar` mounted in `DashboardLayout`**

Remove the `hideTopBar` constant and replace the conditional render:

```tsx
<div className={styles.main}>
  <TopBar />
  <div className={styles.workspace}>
```

Keep these existing Simulation exclusions unchanged:

```ts
const showStudioSidebar = !hideSidebarForSimulation && !onScriptSystem;
const hideChatPanel = hideSidebarForSimulation || onScriptSystem;
```

- [ ] **Step 2: Remove local actions from `SimulationHeader`**

Delete the entire `headerActions` block after the project title/workflow conditional so the component ends as:

```tsx
      )}
    </header>
  );
}
```

- [ ] **Step 3: Remove orphaned Simulation header action styles**

Delete the `.headerActions`, `.search`, `.search > span:last-child`, `.searchIcon`, `.searchIcon::after`, and `.headerAvatar` rules from `SimulationWorkbench.module.css`. Also remove `.search { display: none; }` from the `max-width: 1180px` block.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
npx jest --runInBand tests/unit/layout/leftnav-wiring.test.ts tests/unit/script-system/leftnav-script-wiring.test.ts tests/unit/simulation/workbench-static.test.ts
```

Expected: PASS for all three suites.

- [ ] **Step 5: Commit the functional change**

```bash
git add src/components/layout/DashboardLayout.tsx src/components/simulation/workbench/SimulationHeader.tsx src/components/simulation/workbench/SimulationWorkbench.module.css tests/unit/layout/leftnav-wiring.test.ts tests/unit/script-system/leftnav-script-wiring.test.ts tests/unit/simulation/workbench-static.test.ts
git commit -m "fix: use global topbar in simulation"
```

### Task 3: Verify The Integrated Change

**Files:**
- Verify: `src/components/layout/DashboardLayout.tsx`
- Verify: `src/components/simulation/workbench/SimulationHeader.tsx`
- Verify: `src/components/simulation/workbench/SimulationWorkbench.module.css`

- [ ] **Step 1: Run TypeScript checking**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript errors. If unrelated pre-existing errors occur, record their exact files and confirm none are in the files changed by this plan.

- [ ] **Step 2: Run the broader Simulation unit coverage**

Run:

```bash
npx jest --runInBand tests/unit/simulation tests/unit/layout/leftnav-wiring.test.ts tests/unit/script-system/leftnav-script-wiring.test.ts
```

Expected: PASS for all selected suites.

- [ ] **Step 3: Check formatting integrity and the scoped diff**

Run:

```bash
git diff --check HEAD~1 -- src/components/layout/DashboardLayout.tsx src/components/simulation/workbench/SimulationHeader.tsx src/components/simulation/workbench/SimulationWorkbench.module.css tests/unit/layout/leftnav-wiring.test.ts tests/unit/script-system/leftnav-script-wiring.test.ts tests/unit/simulation/workbench-static.test.ts
```

Expected: exit code 0 and no output.

- [ ] **Step 4: Start the application for browser verification**

Run:

```bash
npm run dev
```

Expected: Next.js reports a local URL. Open `/simulation-system` and confirm the shared global search is visible in the top row, its result dropdown opens, workflow navigation remains below it, and no Simulation-local search/avatar is present.
