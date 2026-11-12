# Project Template Picker UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace project-level game-design fields with a representative project-template picker plus project name and description, while preserving legacy metadata during Settings saves.

**Architecture:** A typed local template catalog feeds a controlled `ProjectTemplatePicker`; a shared `ProjectIdentityFields` component owns name and description inputs in both Create Project and Settings. The selected template remains local UI state in this phase, while existing project creation and update services continue handling persistence and compatibility values.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CSS Modules, Ant Design icons, Jest, React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-project-template-picker-ui-design.md`

## Global Constraints

- Project creation collects only project name and project description.
- The UI must not display or edit project genres or design philosophies.
- The catalog contains exactly Blank project plus six representative starters from the spec.
- Template selection is local UI state and is not sent to or persisted by project services.
- Existing `projects.genres` and `projects.design_philosophies` data must remain unchanged when Settings saves name or description.
- Use existing Ant Design icons and the existing white/gray/blue application visual language.
- Cards use at most an 8px border radius and collapse from two columns to one on narrow screens.
- Do not change Game Design System creation, generation, or versioning behavior.

---

### Task 1: Typed Template Catalog And Controlled Picker

**Files:**
- Create: `src/components/projects/projectTemplates.ts`
- Create: `src/components/projects/ProjectTemplatePicker.tsx`
- Create: `src/components/projects/ProjectTemplatePicker.module.css`
- Create: `src/components/projects/ProjectTemplatePicker.test.tsx`

**Interfaces:**
- Produces: `ProjectTemplateKey`, `ProjectTemplateDefinition`, `PROJECT_TEMPLATES`, and `DEFAULT_PROJECT_TEMPLATE_KEY`.
- Produces: `ProjectTemplatePicker({ value, onChange, disabled? })` where `value: ProjectTemplateKey` and `onChange: (key: ProjectTemplateKey) => void`.

- [ ] **Step 1: Write the failing picker tests**

Create `ProjectTemplatePicker.test.tsx` with a controlled harness and assertions equivalent to:

```tsx
function Harness() {
  const [value, setValue] = useState<ProjectTemplateKey>(DEFAULT_PROJECT_TEMPLATE_KEY);
  return <ProjectTemplatePicker value={value} onChange={setValue} />;
}

it('renders blank plus six representative templates', () => {
  render(<Harness />);
  expect(screen.getAllByRole('button')).toHaveLength(7);
  expect(screen.getByRole('button', { name: /Blank project/ })).toHaveAttribute('aria-pressed', 'true');
  for (const name of [
    'Tactical deckbuilder', 'Narrative adventure', 'Survival builder',
    'Management simulation', 'Action roguelike', 'Cooperative puzzle',
  ]) expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
});

it('reports and exposes the selected template', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: /Narrative adventure/ }));
  expect(screen.getByRole('button', { name: /Narrative adventure/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: /Blank project/ })).toHaveAttribute('aria-pressed', 'false');
});
```

- [ ] **Step 2: Run the picker tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/ProjectTemplatePicker.test.tsx
```

Expected: FAIL because the catalog and picker modules do not exist.

- [ ] **Step 3: Implement the catalog**

Create a frozen catalog with these exact stable keys and display names:

```ts
export type ProjectTemplateKey =
  | 'blank'
  | 'tactical-deckbuilder'
  | 'narrative-adventure'
  | 'survival-builder'
  | 'management-simulation'
  | 'action-roguelike'
  | 'cooperative-puzzle';

export type ProjectTemplateDefinition = {
  key: ProjectTemplateKey;
  name: string;
  description: string;
  icon: 'blank' | 'cards' | 'story' | 'survival' | 'management' | 'action' | 'cooperative';
};

export const DEFAULT_PROJECT_TEMPLATE_KEY: ProjectTemplateKey = 'blank';
export const PROJECT_TEMPLATES: readonly ProjectTemplateDefinition[] = [
  { key: 'blank', name: 'Blank project', description: 'An empty workspace for a custom structure.', icon: 'blank' },
  { key: 'tactical-deckbuilder', name: 'Tactical deckbuilder', description: 'Card synergies, encounter pacing, and progression.', icon: 'cards' },
  { key: 'narrative-adventure', name: 'Narrative adventure', description: 'Characters, branching choices, and consequences.', icon: 'story' },
  { key: 'survival-builder', name: 'Survival builder', description: 'Gathering, crafting, survival pressure, and base growth.', icon: 'survival' },
  { key: 'management-simulation', name: 'Management simulation', description: 'Resources, production chains, and long-term tradeoffs.', icon: 'management' },
  { key: 'action-roguelike', name: 'Action roguelike', description: 'Responsive combat, run variation, and meta progression.', icon: 'action' },
  { key: 'cooperative-puzzle', name: 'Cooperative puzzle', description: 'Shared information, complementary roles, and communication.', icon: 'cooperative' },
] as const;
```

- [ ] **Step 4: Implement the controlled picker and responsive CSS**

Render the choices in a labeled group. Use a full-width blank option followed by a two-column grid. Map catalog icon identifiers to existing `@ant-design/icons`; add `CheckOutlined` only on the selected card. Every card is a native button with `type="button"`, `aria-pressed`, a visible `:focus-visible` outline, stable icon dimensions, wrapping text, and `disabled` support. At `max-width: 42rem`, change the grid to one column.

- [ ] **Step 5: Run the picker tests and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/ProjectTemplatePicker.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit the picker**

```bash
git add src/components/projects/projectTemplates.ts \
  src/components/projects/ProjectTemplatePicker.tsx \
  src/components/projects/ProjectTemplatePicker.module.css \
  src/components/projects/ProjectTemplatePicker.test.tsx
git commit -m "feat: add project template picker"
```

---

### Task 2: Shared Project Identity Fields

**Files:**
- Create: `src/components/projects/ProjectIdentityFields.tsx`
- Create: `src/components/projects/ProjectIdentityFields.module.css`
- Create: `src/components/projects/ProjectIdentityFields.test.tsx`
- Delete: `src/components/projects/ProjectFoundationFields.tsx`
- Delete: `src/components/projects/ProjectFoundationFields.module.css`
- Delete: `src/components/projects/ProjectFoundationFields.test.tsx`

**Interfaces:**
- Produces: `ProjectIdentityDraft = { name: string; description: string }`.
- Produces: `ProjectIdentityFields({ value, onChange, disabled?, readOnly?, showName? })` with the same controlled update semantics as the old fields component.

- [ ] **Step 1: Write failing identity-field tests**

Test two simultaneous forms for unique label targets, verify only `Project name` and `Description` exist, and assert that `Game genres` and `Design philosophies` are absent:

```tsx
const draft = { name: '', description: '' };
render(<ProjectIdentityFields value={draft} onChange={jest.fn()} />);
expect(screen.getByLabelText('Project name')).toBeInTheDocument();
expect(screen.getByLabelText('Description')).toBeInTheDocument();
expect(screen.queryByLabelText('Game genres')).toBeNull();
expect(screen.queryByLabelText('Design philosophies')).toBeNull();
```

- [ ] **Step 2: Run identity-field tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/ProjectIdentityFields.test.tsx
```

Expected: FAIL because `ProjectIdentityFields` does not exist.

- [ ] **Step 3: Implement identity fields and remove foundation fields**

Implement a controlled full-width name input and description textarea. Use description placeholder `Give collaborators a short overview of this project.` Keep disabled/read-only behavior, existing input focus styling, mobile width safety, and unique IDs from `useId`. Remove the obsolete foundation component and its tests after both consumers move in Tasks 3 and 4.

- [ ] **Step 4: Run identity-field tests and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/ProjectIdentityFields.test.tsx
```

Expected: all identity tests pass.

- [ ] **Step 5: Keep the task uncommitted until consumers compile**

The old component cannot be deleted safely until Tasks 3 and 4 update both imports. Carry these changes forward and commit them with the final consumer migration in Task 4.

---

### Task 3: Create Project Dialog Integration

**Files:**
- Modify: `src/components/projects/NewProjectModal.tsx`
- Modify: `src/components/projects/NewProjectModal.module.css`
- Modify: `src/components/projects/NewProjectModal.test.tsx`
- Modify: `src/components/shared/FormDialog.module.css`
- Modify: `tests/unit/folder-recent-and-project-modal-static.test.ts`

**Interfaces:**
- Consumes: `ProjectTemplatePicker`, `ProjectTemplateKey`, `DEFAULT_PROJECT_TEMPLATE_KEY`, `ProjectIdentityFields`, and `ProjectIdentityDraft`.
- Preserves: `CreatedProjectPayload` and all existing callers of `NewProjectModal`.

- [ ] **Step 1: Rewrite modal tests for the new behavior**

Replace the all-foundation-fields helper with name and description entry. Add assertions that:

```tsx
expect(screen.getByRole('button', { name: /Blank project/ })).toHaveAttribute('aria-pressed', 'true');
expect(screen.queryByLabelText('Game genres')).toBeNull();
expect(screen.queryByLabelText('Design philosophies')).toBeNull();
```

On submit, expect exactly:

```tsx
expect(createProject).toHaveBeenCalledWith(expect.anything(), {
  name: 'Harbor Signal',
  description: 'A cooperative mystery.',
});
```

For failure retention, select Narrative adventure before submitting and assert its pressed state, name, and description remain after the error. For successful creation, close and reopen the controlled modal and assert Blank project is selected again.

- [ ] **Step 2: Run modal tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/NewProjectModal.test.tsx tests/unit/folder-recent-and-project-modal-static.test.ts
```

Expected: FAIL because the old form still renders game-design fields and has no template picker.

- [ ] **Step 3: Integrate picker and identity state**

Change modal state to:

```ts
const [draft, setDraft] = useState<ProjectIdentityDraft>({ name: '', description: '' });
const [selectedTemplateKey, setSelectedTemplateKey] =
  useState<ProjectTemplateKey>(DEFAULT_PROJECT_TEMPLATE_KEY);
```

Render `ProjectTemplatePicker` under a `Start from a template` section, then `ProjectIdentityFields` under `Project details`. Submit only trimmed name and description. On success reset both draft and selected key before closing; on failure retain both. Do not include template key, genres, or philosophies in the service call.

- [ ] **Step 4: Implement modal layout styling**

Use a vertically spaced scrollable body, compact section headings, and a divider between template selection and project details. Set `FormDialog.projectModal` to `width: min(52rem, calc(100vw - 2rem))` while retaining its viewport-bounded height. Update the static test to assert the picker grid has two columns, a one-column `max-width: 42rem` rule, and card radius no greater than 8px.

- [ ] **Step 5: Run modal tests and verify GREEN**

Run:

```bash
npm run test:unit -- --runInBand src/components/projects/NewProjectModal.test.tsx tests/unit/folder-recent-and-project-modal-static.test.ts
```

Expected: modal behavior and static visual-contract tests pass.

- [ ] **Step 6: Commit modal integration**

```bash
git add src/components/projects/NewProjectModal.tsx \
  src/components/projects/NewProjectModal.module.css \
  src/components/projects/NewProjectModal.test.tsx \
  src/components/shared/FormDialog.module.css \
  tests/unit/folder-recent-and-project-modal-static.test.ts
git commit -m "feat: redesign project creation around templates"
```

---

### Task 4: Settings Migration, Compatibility, And Visual Verification

**Files:**
- Modify: `src/components/admin/AdminSettingsPage.tsx`
- Modify: `src/components/admin/AdminSettingsPage.test.tsx`
- Include pending Task 2 files and deletions.

**Interfaces:**
- Consumes: `ProjectIdentityFields` and `ProjectIdentityDraft`.
- Preserves: existing `updateProject` service contract and existing stored `genres` / `design_philosophies` values.

- [ ] **Step 1: Rewrite Settings tests for identity-only editing**

Set the loaded project fixture to legacy values such as `genres: ['Strategy']` and `design_philosophies: ['Readable Systems']`. Assert those controls are absent, edit name and description, then expect:

```tsx
expect(updateProject).toHaveBeenCalledWith(expect.anything(), 'project-1', {
  name: 'New name',
  description: 'New description',
  genres: ['Strategy'],
  designPhilosophies: ['Readable Systems'],
  expectedUpdatedAt: project.updated_at,
});
```

Retain tests for dirty state, read-only roles, failed saves, invalid names, cache patching, and breadcrumb updates.

- [ ] **Step 2: Run Settings tests and verify RED**

Run:

```bash
npm run test:unit -- --runInBand src/components/admin/AdminSettingsPage.test.tsx
```

Expected: FAIL because Settings still renders and edits the old foundation controls.

- [ ] **Step 3: Migrate Settings to identity fields**

Store only `{ name, description }` in the draft and dirty comparison. Render `ProjectIdentityFields`. When calling `updateProject`, pass normalized identity fields plus `projectQuery.data.genres ?? []` and `projectQuery.data.design_philosophies ?? []` unchanged. Remove project-foundation preset and normalization imports from the page.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npm run test:unit -- --runInBand \
  src/components/projects/ProjectTemplatePicker.test.tsx \
  src/components/projects/ProjectIdentityFields.test.tsx \
  src/components/projects/NewProjectModal.test.tsx \
  src/components/admin/AdminSettingsPage.test.tsx \
  tests/unit/folder-recent-and-project-modal-static.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript exits 0.

- [ ] **Step 5: Verify the running interface at desktop and mobile widths**

Keep the app on `dev-ting` at `http://localhost:3000`. Use Playwright to open the Projects view, open Create Project, and capture desktop (1440x1000) and mobile (390x844) screenshots. Confirm:

- no overlap or clipped card text;
- two desktop columns and one mobile column;
- modal header, body scroll, and Create action remain reachable;
- selected state is visible and keyboard focus is visible;
- genres and design philosophies do not appear.

- [ ] **Step 6: Run final regression verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit -- --runInBand \
  src/components/projects/ProjectTemplatePicker.test.tsx \
  src/components/projects/ProjectIdentityFields.test.tsx \
  src/components/projects/NewProjectModal.test.tsx \
  src/components/admin/AdminSettingsPage.test.tsx \
  tests/unit/folder-recent-and-project-modal-static.test.ts \
  tests/unit/layout/project-create-list-refresh.test.ts
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 7: Commit the identity migration**

```bash
git add src/components/projects/ProjectIdentityFields.tsx \
  src/components/projects/ProjectIdentityFields.module.css \
  src/components/projects/ProjectIdentityFields.test.tsx \
  src/components/projects/ProjectFoundationFields.tsx \
  src/components/projects/ProjectFoundationFields.module.css \
  src/components/projects/ProjectFoundationFields.test.tsx \
  src/components/admin/AdminSettingsPage.tsx \
  src/components/admin/AdminSettingsPage.test.tsx
git commit -m "refactor: keep game design out of project identity"
```
