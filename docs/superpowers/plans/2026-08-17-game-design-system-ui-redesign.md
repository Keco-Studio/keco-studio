# Game Design System UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the stacked Game Design System manager with a single-page, real-data workspace while retaining all current version, generation, security, and project-binding behavior.

**Architecture:** DashboardLayout continues to own the Keco product rail and top bar. GameDesignSystemsPage owns scope, selection, workspace mode, and queries; focused child components own the library, selected-system views, and staged create flow. Existing REST endpoints remain the source of truth.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, Ant Design icons, CSS Modules, Jest, Testing Library, Playwright.

## Global Constraints

- Keep the Keco global product rail and top bar unchanged.
- Use the existing Ant Design dependency; do not add another component library.
- Workspace view changes and Create rendering use local React state, not route navigation.
- Official remains visible and empty until official systems exist.
- Every visible record and count comes from a real API response or a deterministic derivation.
- Preserve immutable-version, authorization, redaction, durable-job, and pinned-binding semantics.
- At widths below 900px the product rail remains and no command disappears.

---

### Task 1: Workspace shell and real system library

**Files:**
- Modify: src/components/game-design-system/GameDesignSystemsPage.tsx
- Create: src/components/game-design-system/GameDesignSystemLibrary.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.module.css
- Test: src/components/game-design-system/GameDesignSystemsPage.test.tsx

**Interfaces:**
- Consumes: fetchGameDesignSystems(), fetchGameDesignSystem(id), useAuth().
- Produces: GameDesignSystemLibrary props with systems, scope, search, selectedId, onSelect, onScopeChange, and onCreate.

- [x] **Step 1: Write failing library and view-switch tests**

Add rendered-control tests that assert:

~~~tsx
expect(await screen.findByRole('navigation', { name: 'Game Design System views' })).toBeVisible();
await user.click(screen.getByRole('tab', { name: 'Official' }));
expect(screen.getByText('No official systems yet.')).toBeVisible();
expect(screen.queryByText('Tactical Rules')).not.toBeInTheDocument();
await user.click(screen.getByRole('button', { name: 'Create Game Design System' }));
expect(screen.getByRole('heading', { name: 'Create Game Design System' })).toBeVisible();
expect(push).not.toHaveBeenCalled();
~~~

- [x] **Step 2: Run the focused test and verify failure**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: FAIL because the current page routes to /create and has no workspace navigation or official empty state.

- [x] **Step 3: Implement the library and top-level modes**

GameDesignSystemsPage must keep:

~~~ts
type Scope = 'mine' | 'official';
type WorkspaceMode = 'system' | 'create';
type SystemView = 'overview' | 'rules' | 'versions' | 'sources' | 'projects';
~~~

The Create command sets WorkspaceMode to create. Selecting a system sets mode to system. GameDesignSystemLibrary filters My Systems by source=user and owner_id=current user, and Official by source=official.

- [x] **Step 4: Run the focused tests**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: PASS.

### Task 2: Real selected-system views

**Files:**
- Create: src/components/game-design-system/GameDesignSystemWorkspace.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.module.css
- Test: src/components/game-design-system/GameDesignSystemsPage.test.tsx

**Interfaces:**
- Consumes: GameDesignSystemDetail, GameDesignSystemVersion, ProjectOption[], mutation callbacks.
- Produces: accessible Overview, Rules, Versions, Sources, and Projects tab panels.

- [x] **Step 1: Write failing view tests**

Add tests that click each tab and assert real payload values:

~~~tsx
await user.click(screen.getByRole('tab', { name: 'Overview' }));
expect(screen.getByText('1 rule')).toBeVisible();
await user.click(screen.getByRole('tab', { name: 'Versions' }));
expect(screen.getByText('Version 1')).toBeVisible();
await user.click(screen.getByRole('tab', { name: 'Sources' }));
expect(screen.getByText('No source snapshots for this version.')).toBeVisible();
await user.click(screen.getByRole('tab', { name: 'Projects' }));
expect(await screen.findByText('Project A')).toBeVisible();
~~~

- [x] **Step 2: Verify the tests fail**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: FAIL because the stacked page does not expose the specified tab panels.

- [x] **Step 3: Implement view tabs and panels**

Overview derives counts from selectedVersion.rules.rules, detail.versions, and selectedVersion.source_snapshots. Versions uses real diff and conflicts. Sources uses real redacted snapshots. Projects uses /api/projects and fetchProjectGameDesignSystem(projectId), and existing apply/clear mutations.

- [x] **Step 4: Run focused tests**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: PASS.

### Task 3: Structured local rule-set draft

**Files:**
- Create: src/components/game-design-system/GameDesignSystemRuleEditor.tsx
- Modify: src/components/game-design-system/GameDesignSystemWorkspace.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.module.css
- Test: src/components/game-design-system/GameDesignSystemsPage.test.tsx

**Interfaces:**
- Consumes: parent GameDesignSystemVersion and onCreateVersion(rules, parentVersionId).
- Produces: one validated GameDesignRuleSet only after explicit review and confirmation.

- [x] **Step 1: Write failing edit-session tests**

~~~tsx
await user.click(screen.getByRole('button', { name: 'New version' }));
await user.click(screen.getByRole('button', { name: 'Readable state' }));
await user.clear(screen.getByLabelText('Rule statement'));
await user.type(screen.getByLabelText('Rule statement'), 'Show all decision inputs.');
expect(createVersion).not.toHaveBeenCalled();
await user.click(screen.getByRole('button', { name: 'Review changes' }));
await user.click(screen.getByRole('button', { name: 'Create version' }));
expect(createVersion).toHaveBeenCalledWith(
  expect.objectContaining({ rules: expect.arrayContaining([expect.objectContaining({ statement: 'Show all decision inputs.' })]) }),
  'version-1',
);
~~~

- [x] **Step 2: Verify the test fails**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: FAIL because the current editor is a raw JSON textarea.

- [x] **Step 3: Implement the local draft editor**

Clone the parent rule set with structuredClone. Support rule selection, field updates, add, delete, reorder, system settings, table guidance, cancel, and review. Call parseRuleSet before opening review. Never call the version mutation during field edits.

- [x] **Step 4: Run focused tests**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: PASS.

### Task 4: Embedded staged creation and real durable progress

**Files:**
- Modify: src/components/game-design-system/GameDesignSystemCreatePage.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.tsx
- Modify: src/components/game-design-system/GameDesignSystemsPage.module.css
- Test: src/components/game-design-system/GameDesignSystemCreatePage.test.tsx
- Test: src/components/game-design-system/GameDesignSystemsPage.test.tsx

**Interfaces:**
- GameDesignSystemCreatePage props: embedded?: boolean, onCancel?: () => void, onCompleted?: (systemId: string) => void.
- Existing route remains a compatibility wrapper.

- [x] **Step 1: Write failing staged-flow tests**

~~~tsx
expect(screen.getByRole('tab', { name: 'Foundation' })).toHaveAttribute('aria-selected', 'true');
await user.type(screen.getByLabelText('System name'), 'Tactical Rules');
await user.click(screen.getByRole('button', { name: 'RPG' }));
await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
expect(screen.getByLabelText('Source project')).toBeVisible();
await user.click(screen.getByRole('button', { name: 'Review input' }));
expect(screen.getByText('Validated structured rules')).toBeVisible();
~~~

- [x] **Step 2: Verify the tests fail**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemCreatePage.test.tsx

Expected: FAIL because the current form renders all inputs at once.

- [x] **Step 3: Implement local stages**

Foundation owns design direction fields, Sources owns real resource and reference inputs, Review shows normalized real input. Submission and retry reuse the existing generation functions and polling state. Embedded completion selects the generated system without router navigation.

- [x] **Step 4: Run focused tests**

Run: npx jest --runInBand src/components/game-design-system/GameDesignSystemCreatePage.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx

Expected: PASS.

### Task 5: Responsive layout and regression verification

**Files:**
- Modify: src/components/game-design-system/GameDesignSystemsPage.module.css
- Modify: tests/e2e/specs/game-design-system.spec.ts

**Interfaces:**
- Consumes all components above.
- Produces desktop and mobile workspaces without horizontal overflow or hidden commands.

- [x] **Step 1: Add browser assertions**

Assert the existing product rail remains visible, tabs switch without URL changes, Official is empty, Create stays on /game-design-systems, and mobile scrollWidth minus clientWidth is at most 1.

- [x] **Step 2: Implement responsive CSS**

At 900px the library becomes an overlay drawer, Rules becomes one column with a rule selector, inspector moves below the form, tabs scroll horizontally, and forms become one column.

- [x] **Step 3: Run complete focused verification**

Run:

~~~bash
npx jest --runInBand src/components/game-design-system/GameDesignSystemsPage.test.tsx src/components/game-design-system/GameDesignSystemCreatePage.test.tsx src/lib/game-design-system/agentEvidence.test.ts src/lib/game-design-system/agentPolicy.test.ts src/lib/game-design-system/ruleSchema.test.ts src/lib/game-design-system/sourceSnapshots.test.ts src/lib/game-design-system/sourceVisibility.test.ts src/lib/game-design-system/worker.test.ts src/lib/gameDesignSystemGeneration.test.ts src/lib/services/gameDesignSystemService.test.ts
npm run typecheck
~~~

Expected: all selected suites and typecheck pass.

- [x] **Step 4: Run the browser workflow**

Run: npx playwright test tests/e2e/specs/game-design-system.spec.ts --workers=1

Expected: desktop and mobile workflow passes when its Supabase and LLM environment is configured. If unavailable, record the environment blocker and run local screenshot checks against the development server.
