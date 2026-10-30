# Library Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users enter project name, game genres, design philosophies, and description during project creation, surface the new project immediately in Library, and make Settings the only project-information editor.

**Architecture:** Store project-specific Foundation values directly on `public.projects` while sharing only the GDS preset catalog, tag normalization, and tag selector UI. A new transactional RPC creates the complete project plus its Resources folder without changing the signature of legacy RPCs used by Agent and E2E fixtures. Settings owns one controlled Foundation form; project caches are patched and invalidated after create/update so Library navigation changes without a reload.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL, TanStack Query 5, Jest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-library-project-foundation-design.md`

## Global Constraints

- Foundation fields are exactly project name, game genres, design philosophies, and description.
- Project name is required; all other fields are optional.
- No Foundation field has a character-count limit.
- Genres and design philosophies allow at most 20 tags each.
- Tags are trimmed, internal whitespace is collapsed, preset spelling is canonicalized, and duplicates are removed case-insensitively.
- GDS `Suitable for`, release platforms, GDS record binding, and document simplification remain out of scope.
- Existing `create_project_with_default_resource(text, text)` and Agent idempotent creation functions keep their signatures and behavior.
- Only accepted project admins may edit project Foundation fields; editors and viewers are read-only in Settings and at the database write boundary.
- Settings is the sole project-information editor: no sidebar double-click rename and no Edit Project modal.

---

## File Structure

**Create**

- `supabase/migrations/20261030100000_project_foundation.sql`: columns, array constraints, admin-only update policy, and the new transactional creation RPC.
- `tests/unit/database/project-foundation-migration.test.ts`: static security and schema assertions for the migration.
- `src/lib/projectFoundation.ts`: shared presets, Foundation types, and deterministic tag normalization.
- `src/lib/projectFoundation.test.ts`: normalization and validation unit coverage.
- `src/components/shared/FoundationTagSelector.tsx`: reusable controlled tag selector used by GDS and project forms.
- `src/components/shared/FoundationTagSelector.module.css`: isolated selector layout and states.
- `src/components/projects/ProjectFoundationFields.tsx`: controlled project-specific name/tags/description fields.
- `src/components/projects/ProjectFoundationFields.module.css`: project Foundation form layout.
- `src/components/projects/NewProjectModal.test.tsx`: project-creation form behavior and failure retention.
- `src/components/admin/AdminSettingsPage.test.tsx`: admin edit, unchanged-save, read-only, and cache-refresh behavior.
- `src/app/api/projects/route.test.ts`: authenticated project POST compatibility and Foundation forwarding.

**Modify**

- `src/components/game-design-system/GameDesignSystemCreatePage.tsx`: consume shared presets and selector without changing GDS behavior.
- `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`: keep custom/preset tag regression coverage against the extracted selector.
- `src/lib/services/projectService.ts`: Foundation-aware project types, creation RPC, update payload, and returned project record.
- `src/app/api/projects/route.ts`: accept optional Foundation arrays while preserving old request compatibility.
- `src/components/projects/NewProjectModal.tsx`: render Foundation fields and emit the complete created project.
- `src/components/projects/NewProjectModal.module.css`: responsive Foundation dialog sizing.
- `src/components/shared/FormDialog.module.css`: remove the obsolete fixed project-dialog height and old 250-character helper styling.
- `src/app/(dashboard)/projects/page.tsx`: cache the returned complete project and prime the default-folder cache.
- `src/components/layout/Sidebar.tsx`: cache the complete created project and remove old project-edit modal wiring.
- `src/lib/queryInvalidation.ts`: add a focused project Foundation cache patch helper.
- `src/components/admin/AdminSettingsPage.tsx`: replace modal Profile rows with the inline Foundation form.
- `src/components/admin/AdminPage.module.css`: Settings form/read-only/action styles.
- `src/components/layout/components/SidebarProjectsList.tsx`: remove inline project rename and delayed single-click behavior.
- `src/components/layout/hooks/useSidebarContextMenuActions.ts`: route Project info to `/<projectId>/admin`.
- `src/components/layout/hooks/useSidebarModals.ts`: remove Edit Project state.
- `tests/unit/layout/sidebar-project-selector.test.ts`: assert immediate selection and absence of rename behavior.
- `tests/unit/layout/project-create-list-refresh.test.ts`: assert complete Foundation data and folder cache priming.
- `tests/unit/folder-recent-and-project-modal-static.test.ts`: replace obsolete fixed-height/character-limit assertions.
- `tests/unit/projects-page-create-navigation.test.tsx`: include and cache Foundation fields.
- `tests/unit/project-update-cas.test.ts`: assert tag fields participate in the same atomic/CAS update.
- `tests/unit/database/projects-update-owner-guard-rls.test.ts`: update the historical policy expectation from admin/editor to admin-only.
- `tests/e2e/fixures/projects.ts`: add optional Foundation arrays to `ProjectData`.
- `tests/e2e/pages/project.page.ts`: support optional genre/philosophy entry helpers.
- `tests/e2e/specs/edit-info.spec.ts`: replace the obsolete modal scenario with create-to-Library-to-Settings synchronization.

**Delete**

- `src/components/projects/EditProjectModal.tsx`: obsolete secondary project editor.

---

### Task 1: Persist Project Foundation and Enforce Admin-Only Writes

**Files:**
- Create: `supabase/migrations/20261030100000_project_foundation.sql`
- Create: `tests/unit/database/project-foundation-migration.test.ts`
- Modify: `tests/unit/database/projects-update-owner-guard-rls.test.ts`

**Interfaces:**
- Produces: `projects.genres text[]`, `projects.design_philosophies text[]`.
- Produces: `public.create_project_with_foundation(text, text, text[], text[]) returns json` with `{ project, folder_id }`.
- Preserves: `public.create_project_with_default_resource(text, text)` and `public.create_project_with_default_resource_idempotent(text, text, uuid)`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261030100000_project_foundation.sql',
);

describe('project Foundation migration', () => {
  it('adds non-null Foundation arrays with a 20-tag database limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/add column if not exists genres text\[\] not null default '\{\}'::text\[\]/i);
    expect(sql).toMatch(/add column if not exists design_philosophies text\[\] not null default '\{\}'::text\[\]/i);
    expect(sql).toMatch(/cardinality\(genres\) <= 20/i);
    expect(sql).toMatch(/cardinality\(design_philosophies\) <= 20/i);
  });

  it('creates an admin-only transactional Foundation RPC without replacing legacy RPCs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create or replace function public\.create_project_with_foundation/i);
    expect(sql).toMatch(/insert into public\.projects[\s\S]*genres[\s\S]*design_philosophies/i);
    expect(sql).toMatch(/insert into public\.folders[\s\S]*Resources Folder/i);
    expect(sql).toMatch(/insert into public\.project_collaborators[\s\S]*'admin'/i);
    expect(sql).toMatch(/grant execute on function public\.create_project_with_foundation\(text, text, text\[\], text\[\]\) to authenticated/i);
    expect(sql).not.toMatch(/drop function[^;]*create_project_with_default_resource/i);
  });

  it('limits project updates to accepted admins at the RLS boundary', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create or replace function public\.is_project_admin_collaborator/i);
    expect(sql).toMatch(/role = 'admin'/i);
    expect(sql).toMatch(/accepted_at is not null/i);
    expect(sql).toMatch(/create policy "projects_update_policy"[\s\S]*is_project_admin_collaborator/i);
  });
});
```

- [ ] **Step 2: Run the test and verify the migration is missing**

Run: `npx jest --runInBand tests/unit/database/project-foundation-migration.test.ts`

Expected: FAIL because `20261030100000_project_foundation.sql` does not exist.

- [ ] **Step 3: Add the migration**

Implement the migration with these exact database boundaries:

```sql
alter table public.projects
  add column if not exists genres text[] not null default '{}'::text[],
  add column if not exists design_philosophies text[] not null default '{}'::text[];

alter table public.projects
  add constraint projects_genres_limit check (cardinality(genres) <= 20),
  add constraint projects_design_philosophies_limit check (cardinality(design_philosophies) <= 20);

create or replace function public.is_project_admin_collaborator(
  p_project_id uuid,
  p_user_id uuid
) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.project_collaborators
    where project_id = p_project_id
      and user_id = p_user_id
      and role = 'admin'
      and accepted_at is not null
  );
$$;

revoke all on function public.is_project_admin_collaborator(uuid, uuid)
  from public, anon;
grant execute on function public.is_project_admin_collaborator(uuid, uuid)
  to authenticated;

drop policy if exists projects_update_policy on public.projects;
drop policy if exists "projects_update_policy" on public.projects;
create policy "projects_update_policy"
  on public.projects for update
  using (public.is_project_admin_collaborator(id, (select auth.uid())))
  with check (public.is_project_admin_collaborator(id, (select auth.uid())));
```

The RPC must copy the profile bootstrap, Resources Folder insert, and owner-collaborator insert from the current legacy function, reject more than 20 values per array, and return the inserted project row rather than synthesizing timestamps client-side:

```sql
create or replace function public.create_project_with_foundation(
  p_name text,
  p_description text default null,
  p_genres text[] default '{}'::text[],
  p_design_philosophies text[] default '{}'::text[]
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_folder_id uuid;
  v_user uuid := auth.uid();
  v_user_email text;
begin
  if v_user is null then raise exception 'Unauthorized: auth.uid() is null'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Project name required'; end if;
  if cardinality(coalesce(p_genres, '{}'::text[])) > 20 then raise exception 'At most 20 game genres are allowed'; end if;
  if cardinality(coalesce(p_design_philosophies, '{}'::text[])) > 20 then raise exception 'At most 20 design philosophies are allowed'; end if;

  select email into v_user_email from auth.users where id = v_user;
  insert into public.profiles (id, email, created_at, updated_at)
  values (v_user, v_user_email, now(), now()) on conflict (id) do nothing;

  insert into public.projects (owner_id, name, description, genres, design_philosophies)
  values (
    v_user,
    btrim(p_name),
    nullif(btrim(p_description), ''),
    coalesce(p_genres, '{}'::text[]),
    coalesce(p_design_philosophies, '{}'::text[])
  ) returning * into v_project;

  insert into public.folders (project_id, name, description)
  values (v_project.id, 'Resources Folder', 'Default resources folder')
  returning id into v_folder_id;

  insert into public.project_collaborators
    (user_id, project_id, role, invited_by, invited_at, accepted_at)
  values (v_user, v_project.id, 'admin', null, now(), now())
  on conflict (user_id, project_id) do nothing;

  return json_build_object('project', row_to_json(v_project), 'folder_id', v_folder_id);
end;
$$;

revoke all on function public.create_project_with_foundation(text, text, text[], text[])
  from public, anon;
grant execute on function public.create_project_with_foundation(text, text, text[], text[])
  to authenticated;
notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run static and live database verification**

Run: `npx jest --runInBand tests/unit/database/project-foundation-migration.test.ts tests/unit/database/projects-update-owner-guard-rls.test.ts`

Expected: PASS after updating the older owner-guard test so it no longer asserts editor access to project metadata.

Run: `npm run test:unit:db`

Expected: PASS; if local Supabase is unavailable, record that exact environmental blocker before proceeding.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/20261030100000_project_foundation.sql tests/unit/database/project-foundation-migration.test.ts tests/unit/database/projects-update-owner-guard-rls.test.ts
git commit -m "feat: add project foundation storage"
```

---

### Task 2: Extract Shared Foundation Presets and Tag Behavior

**Files:**
- Create: `src/lib/projectFoundation.ts`
- Create: `src/lib/projectFoundation.test.ts`
- Create: `src/components/shared/FoundationTagSelector.tsx`
- Create: `src/components/shared/FoundationTagSelector.module.css`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`

**Interfaces:**
- Produces: `GAME_GENRE_PRESETS`, `DESIGN_PHILOSOPHY_PRESETS`, `PROJECT_FOUNDATION_TAG_LIMIT`.
- Produces: `normalizeFoundationTag(value, presets)`, `normalizeFoundationTags(values, presets)`.
- Produces: `<FoundationTagSelector id label singularLabel placeholder presets values onChange maxLength? />`.

- [ ] **Step 1: Write failing normalization tests**

```ts
import {
  GAME_GENRE_PRESETS,
  normalizeFoundationTag,
  normalizeFoundationTags,
} from '@/lib/projectFoundation';

describe('project Foundation tags', () => {
  it('collapses whitespace and restores canonical preset spelling', () => {
    expect(normalizeFoundationTag('  visual   novel ', GAME_GENRE_PRESETS)).toBe('Visual Novel');
  });

  it('deduplicates case-insensitively and keeps at most 20 tags', () => {
    const values = ['rpg', 'RPG', ...Array.from({ length: 25 }, (_, index) => `Custom ${index}`)];
    const result = normalizeFoundationTags(values, GAME_GENRE_PRESETS);
    expect(result[0]).toBe('RPG');
    expect(result).toHaveLength(20);
    expect(new Set(result.map((value) => value.toLowerCase())).size).toBe(20);
  });

  it('drops blank tags without imposing a character limit', () => {
    const long = 'A'.repeat(500);
    expect(normalizeFoundationTags([' ', long], [])).toEqual([long]);
  });
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `npx jest --runInBand src/lib/projectFoundation.test.ts`

Expected: FAIL with module resolution errors for `@/lib/projectFoundation`.

- [ ] **Step 3: Implement the shared model and selector**

Define the shared data contract in `src/lib/projectFoundation.ts`:

```ts
export const PROJECT_FOUNDATION_TAG_LIMIT = 20;
export const GAME_GENRE_PRESETS = [
  'RPG', 'Strategy', 'Deckbuilder', 'Roguelike', 'Simulation', 'Narrative',
  'Action', 'Puzzle', 'Management', 'Adventure', 'Platformer', 'Shooter',
  'Survival', 'Horror', 'Sandbox', 'Sports', 'Visual Novel', 'Metroidvania',
] as const;
export const DESIGN_PHILOSOPHY_PRESETS = [
  'Meaningful Decisions', 'Readable Systems', 'System Driven', 'Narrative First',
  'Player Agency', 'Emergent Play', 'Competitive Fairness',
  'Expressive Customization', 'Accessibility First',
  'Easy to Learn, Hard to Master', 'Risk and Reward', 'Fail Forward',
  'Mastery Through Practice', 'Cooperative Play',
] as const;

export type ProjectFoundationDraft = {
  name: string;
  genres: string[];
  designPhilosophies: string[];
  description: string;
};

export function normalizeFoundationTag(value: string, presets: readonly string[]): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return presets.find((preset) => preset.toLowerCase() === normalized.toLowerCase()) ?? normalized;
}

export function normalizeFoundationTags(values: readonly string[], presets: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeFoundationTag(value, presets);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length === PROJECT_FOUNDATION_TAG_LIMIT) break;
  }
  return result;
}
```

Move the controlled tag rendering from `GameDesignSystemCreatePage.tsx` into `FoundationTagSelector.tsx`. Accept optional `maxLength?: number`; omit the HTML attribute when it is undefined. Use the shared limit and normalizer for typed and preset values. Keep buttons accessible with `Remove <singularLabel> <value>` and `Add <singularLabel>` labels.

- [ ] **Step 4: Replace GDS-local constants and selector**

Import the shared presets and component, then replace:

```tsx
<FoundationTagSelector
  id="gds-genres"
  label="Game genres"
  singularLabel="game genre"
  placeholder="Custom genre"
  presets={GAME_GENRE_PRESETS}
  values={genres}
  maxLength={80}
  onChange={setGenres}
/>
```

Use `maxLength={120}` for GDS design philosophies. Remove GDS-local `GENRES`, `PHILOSOPHIES`, `TAG_LIMIT`, `TagSelector`, and tag-specific imports/state. Project forms omit `maxLength`, so project tags remain unrestricted while GDS retains its current validation behavior.

- [ ] **Step 5: Run focused shared and GDS tests**

Run: `npx jest --runInBand src/lib/projectFoundation.test.ts src/components/game-design-system/GameDesignSystemCreatePage.test.tsx`

Expected: PASS, including existing custom tag, preset toggle, removal, and duplicate tests.

- [ ] **Step 6: Commit the shared Foundation UI**

```bash
git add src/lib/projectFoundation.ts src/lib/projectFoundation.test.ts src/components/shared/FoundationTagSelector.tsx src/components/shared/FoundationTagSelector.module.css src/components/game-design-system/GameDesignSystemCreatePage.tsx src/components/game-design-system/GameDesignSystemCreatePage.test.tsx
git commit -m "refactor: share foundation tag controls"
```

---

### Task 3: Make Project Services Foundation-Aware

**Files:**
- Modify: `src/lib/services/projectService.ts`
- Modify: `src/app/api/projects/route.ts`
- Create: `src/app/api/projects/route.test.ts`
- Modify: `tests/unit/project-update-cas.test.ts`

**Interfaces:**
- Produces: `Project` with `genres: string[]` and `design_philosophies: string[]`.
- Produces: `CreateProjectInput`/`UpdateProjectInput` with `genres` and `designPhilosophies`.
- Produces: `createProject(...): Promise<{ project: Project; defaultFolderId: string }>`.
- Produces: `updateProject(...): Promise<Project>`.

- [ ] **Step 1: Extend service tests before implementation**

Add assertions to `project-update-cas.test.ts` that the update is one atomic row write:

```ts
await updateProject(client, projectId, {
  name: 'New',
  description: 'Updated',
  genres: ['RPG'],
  designPhilosophies: ['Player Agency'],
  expectedUpdatedAt: updatedAt,
});

expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
  name: 'New',
  description: 'Updated',
  genres: ['RPG'],
  design_philosophies: ['Player Agency'],
}));
```

Create `src/app/api/projects/route.test.ts` using the same `withAuth` mock pattern as the other colocated route tests. Assert that old `{ name, description }` requests pass empty arrays and new requests pass normalized Foundation arrays to `create_project_with_foundation`.

- [ ] **Step 2: Run focused service/route tests and verify failure**

Run: `npx jest --runInBand tests/unit/project-update-cas.test.ts src/app/api/projects/route.test.ts`

Expected: FAIL because the service types and route do not forward Foundation arrays.

- [ ] **Step 3: Implement Foundation-aware service types and RPC parsing**

Use the exact public fields:

```ts
export type Project = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  genres: string[];
  design_philosophies: string[];
  created_at: string;
  updated_at: string;
  default_library_id?: string;
  assets_workspace_enabled?: boolean;
};

export type ProjectFoundationInput = {
  name: string;
  description?: string;
  genres?: string[];
  designPhilosophies?: string[];
};
```

Normalize arrays with `normalizeFoundationTags`, call `create_project_with_foundation`, validate that `result.project` has a string ID and `result.folder_id` is a string, and return the database project row. Update `updateProject` to write all four Foundation fields in one `.update(...)`, retain optional CAS on `updated_at`, select the updated row, and return it.

- [ ] **Step 4: Update `/api/projects` without breaking old callers**

Treat missing arrays as `[]`, reject non-array inputs with HTTP 400, normalize valid strings, call `create_project_with_foundation`, and return:

```ts
return NextResponse.json(
  { ...project, default_folder_id: folderId },
  { status: 201 },
);
```

Keep GET response behavior unchanged apart from the two additional database columns naturally included by `select('*')`.

- [ ] **Step 5: Run service, route, and type checks**

Run: `npx jest --runInBand tests/unit/project-update-cas.test.ts src/app/api/projects/route.test.ts tests/unit/agent/project-tools.test.ts`

Expected: PASS; Agent tests continue to assert the legacy idempotent RPC.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the service contract**

```bash
git add src/lib/services/projectService.ts src/app/api/projects/route.ts src/app/api/projects/route.test.ts tests/unit/project-update-cas.test.ts
git commit -m "feat: persist project foundation data"
```

---

### Task 4: Expand Create Project and Prime Library Caches

**Files:**
- Create: `src/components/projects/ProjectFoundationFields.tsx`
- Create: `src/components/projects/ProjectFoundationFields.module.css`
- Create: `src/components/projects/NewProjectModal.test.tsx`
- Modify: `src/components/projects/NewProjectModal.tsx`
- Modify: `src/components/projects/NewProjectModal.module.css`
- Modify: `src/components/shared/FormDialog.module.css`
- Modify: `src/app/(dashboard)/projects/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/lib/queryInvalidation.ts`
- Modify: `tests/unit/projects-page-create-navigation.test.tsx`
- Modify: `tests/unit/layout/project-create-list-refresh.test.ts`
- Modify: `tests/unit/folder-recent-and-project-modal-static.test.ts`

**Interfaces:**
- Consumes: shared selectors and `createProject` from Tasks 2-3.
- Produces: `CreatedProjectPayload = { project: Project; defaultFolderId: string }`.
- Produces: `patchProjectFoundationCaches(queryClient, project)`.

- [ ] **Step 1: Write failing Create Project component tests**

Mock `createProject`, render the modal, fill project name and description, choose `RPG` and `Player Agency`, and assert:

```ts
expect(createProject).toHaveBeenCalledWith(expect.anything(), {
  name: 'Harbor Signal',
  description: 'A cooperative mystery.',
  genres: ['RPG'],
  designPhilosophies: ['Player Agency'],
});
expect(onCreated).toHaveBeenCalledWith({
  project: createdProject,
  defaultFolderId: 'folder-1',
});
```

Add a rejection case: after `createProject` rejects, assert the dialog remains open and every entered value/tag remains visible.

- [ ] **Step 2: Run the modal tests and verify the old form fails**

Run: `npx jest --runInBand src/components/projects/NewProjectModal.test.tsx`

Expected: FAIL because genre and philosophy controls do not exist.

- [ ] **Step 3: Build controlled project Foundation fields**

`ProjectFoundationFields` receives:

```ts
type ProjectFoundationFieldsProps = {
  value: ProjectFoundationDraft;
  onChange: (value: ProjectFoundationDraft) => void;
  disabled?: boolean;
  readOnly?: boolean;
  showName?: boolean;
};
```

Render semantic labels `Project name`, `Game genres`, `Design philosophies`, and `Description`. Do not render character counters or pass `maxLength` from this project component. Use the shared selectors and project-specific responsive CSS.

- [ ] **Step 4: Replace the old creation fields and payload**

Keep one `ProjectFoundationDraft` state object. Validate project name with `validateName`, normalize both tag arrays, submit through the new service contract, and reset the form only after success. Replace the fixed `616px x 370px` dialog with `width: min(46rem, calc(100vw - 2rem))`, `max-height: calc(100vh - 2rem)`, and internal scrolling so 20 tags cannot overflow the viewport.

- [ ] **Step 5: Add a complete cache patch helper and use it at both creation entry points**

Add to `queryInvalidation.ts`:

```ts
export function patchProjectFoundationCaches(queryClient: QueryClient, project: Project): void {
  upsertProjectInListCache(queryClient, project);
  queryClient.setQueryData(queryKeys.project(project.id), project);
  queryClient.setQueriesData(
    { queryKey: ['project', project.id] },
    (old: unknown) => old && !Array.isArray(old) ? { ...(old as object), ...project } : old,
  );
}
```

In Projects page and Sidebar creation handlers, call it synchronously and prime `queryKeys.projectFolders(project.id)` before navigation with this complete optimistic folder shape:

```ts
const optimisticFolder: Folder = {
  id: defaultFolderId,
  project_id: project.id,
  parent_folder_id: null,
  name: 'Resources Folder',
  description: 'Default resources folder',
  created_at: project.created_at,
  updated_at: project.created_at,
  updated_by: project.owner_id,
};
queryClient.setQueryData<Folder[]>(queryKeys.projectFolders(project.id), [optimisticFolder]);
```

Then invalidate project folders and `['folders-libraries', project.id]` in the background so Library replaces the optimistic folder with canonical data.

- [ ] **Step 6: Run creation and cache tests**

Run: `npx jest --runInBand src/components/projects/NewProjectModal.test.tsx tests/unit/projects-page-create-navigation.test.tsx tests/unit/layout/project-create-list-refresh.test.ts tests/unit/folder-recent-and-project-modal-static.test.ts`

Expected: PASS, including immediate navigation while invalidations are pending and complete Foundation values in the list cache.

- [ ] **Step 7: Commit the create-to-Library flow**

```bash
git add src/components/projects/ProjectFoundationFields.tsx src/components/projects/ProjectFoundationFields.module.css src/components/projects/NewProjectModal.tsx src/components/projects/NewProjectModal.module.css src/components/projects/NewProjectModal.test.tsx src/components/shared/FormDialog.module.css src/app/\(dashboard\)/projects/page.tsx src/components/layout/Sidebar.tsx src/lib/queryInvalidation.ts tests/unit/projects-page-create-navigation.test.tsx tests/unit/layout/project-create-list-refresh.test.ts tests/unit/folder-recent-and-project-modal-static.test.ts
git commit -m "feat: create projects with foundation data"
```

---

### Task 5: Make Settings the Single Project Editor

**Files:**
- Create: `src/components/admin/AdminSettingsPage.test.tsx`
- Modify: `src/components/admin/AdminSettingsPage.tsx`
- Modify: `src/components/admin/AdminPage.module.css`
- Delete: `src/components/projects/EditProjectModal.tsx`
- Modify: `src/components/layout/components/SidebarProjectsList.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Modify: `src/components/layout/hooks/useSidebarModals.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `tests/unit/layout/sidebar-project-selector.test.ts`
- Modify: `tests/unit/layout/recent-admin-nav.test.ts`

**Interfaces:**
- Consumes: `ProjectFoundationFields`, `updateProject`, `patchProjectFoundationCaches`.
- Produces: one inline Settings Profile form with admin edit and collaborator read-only modes.
- Produces: Project info context action navigation to `/<projectId>/admin`.

- [ ] **Step 1: Write failing Settings behavior tests**

Mock role, project query, `updateProject`, and query client. Cover these exact cases:

```ts
it('saves all four Foundation fields and refreshes project caches', async () => {
  renderSettings({ role: 'admin', project });
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'New name');
  await user.clear(screen.getByLabelText('Description'));
  await user.type(screen.getByLabelText('Description'), 'New description');
  await user.click(screen.getByRole('button', { name: 'Strategy' }));
  await user.click(screen.getByRole('button', { name: 'Readable Systems' }));
  await user.click(screen.getByRole('button', { name: 'Save project information' }));
  expect(updateProject).toHaveBeenCalledWith(expect.anything(), 'project-1', {
    name: 'New name',
    description: 'New description',
    genres: ['Strategy'],
    designPhilosophies: ['Readable Systems'],
    expectedUpdatedAt: project.updated_at,
  });
  expect(patchProjectFoundationCaches).toHaveBeenCalledWith(expect.anything(), updatedProject);
});

it('disables Save until the draft differs from persisted values', () => {
  renderSettings({ role: 'admin', project });
  expect(screen.getByRole('button', { name: 'Save project information' })).toBeDisabled();
});

it.each(['editor', 'viewer'])('renders %s Foundation fields read-only', (role) => {
  renderSettings({ role, project });
  expect(screen.getByLabelText('Project name')).toBeDisabled();
  expect(screen.getByLabelText('Description')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save project information' })).toBeNull();
});

it('retains the draft and reports a failed save', async () => {
  jest.mocked(updateProject).mockRejectedValueOnce(new Error('Save failed'));
  renderSettings({ role: 'admin', project });
  await user.clear(screen.getByLabelText('Project name'));
  await user.type(screen.getByLabelText('Project name'), 'Unsaved name');
  await user.click(screen.getByRole('button', { name: 'Save project information' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(screen.getByLabelText('Project name')).toHaveValue('Unsaved name');
});
```

Define `renderSettings` in the test file to supply the mocked project-role query and project query; define `user = userEvent.setup()` in `beforeEach` and return `updatedProject` from the successful `updateProject` mock.

- [ ] **Step 2: Run Settings tests and verify the modal-based UI fails**

Run: `npx jest --runInBand src/components/admin/AdminSettingsPage.test.tsx`

Expected: FAIL because Profile only opens `EditProjectModal`.

- [ ] **Step 3: Implement inline Settings Profile editing**

Select `id, owner_id, name, description, genres, design_philosophies, created_at, updated_at`. Hydrate a controlled draft when the project query changes. Compare normalized draft values with persisted values to compute `dirty`. For admins, render `Save project information`; for editors/viewers, render the same fields disabled/read-only with no save command.

On save, call `updateProject` once with `expectedUpdatedAt`, patch caches with the returned row, replace the draft with returned values, show success, and refetch the Settings query. On error, leave draft state untouched and show a form-local alert.

- [ ] **Step 4: Remove sidebar editing paths**

In `SidebarProjectsList`, delete editing state, rename input, double-click handler, delayed click timer, and `onSaveRename`. A project item click now selects immediately.

In `useSidebarContextMenuActions`, replace project rename handling with:

```ts
if (action === 'rename' && contextMenu.type === 'project') {
  closeContextMenu();
  router.push(`/${contextMenu.id}/admin`);
  return;
}
```

Remove Edit Project modal state from `useSidebarModals`, imports/rendering from `Sidebar`, and delete `EditProjectModal.tsx`. Keep `handleSaveRename` for folders/documents/libraries that still use inline rename.

- [ ] **Step 5: Update static navigation assertions**

Change the sidebar selector test to require no `startRename`, no rename input, no double-click handler, and immediate `selectProject(project.id)`. Update admin navigation coverage to assert Project info routes to Settings and `AdminSettingsPage` no longer imports `EditProjectModal`.

- [ ] **Step 6: Run Settings and navigation tests**

Run: `npx jest --runInBand src/components/admin/AdminSettingsPage.test.tsx tests/unit/layout/sidebar-project-selector.test.ts tests/unit/layout/recent-admin-nav.test.ts tests/unit/layout/sidebar-modal-layering.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the single editing entry**

```bash
git add src/components/admin/AdminSettingsPage.tsx src/components/admin/AdminSettingsPage.test.tsx src/components/admin/AdminPage.module.css src/components/layout/components/SidebarProjectsList.tsx src/components/layout/hooks/useSidebarContextMenuActions.ts src/components/layout/hooks/useSidebarModals.ts src/components/layout/Sidebar.tsx tests/unit/layout/sidebar-project-selector.test.ts tests/unit/layout/recent-admin-nav.test.ts tests/unit/layout/sidebar-modal-layering.test.ts
git rm src/components/projects/EditProjectModal.tsx
git commit -m "feat: edit project foundation in settings"
```

---

### Task 6: Verify the Full Library and Settings Workflow

**Files:**
- Modify: `tests/e2e/fixures/projects.ts`
- Modify: `tests/e2e/pages/project.page.ts`
- Modify: `tests/e2e/specs/edit-info.spec.ts`

**Interfaces:**
- Consumes: final accessible labels and routes from Tasks 4-5.
- Produces: end-to-end evidence for create, Library linkage, Settings update, and no alternate editor.

- [ ] **Step 1: Rewrite the obsolete project-modal E2E scenario**

Update the project page object so optional arrays select preset buttons by accessible name. Replace the old Project Info modal case with one serial flow:

```ts
await projectPage.createProject({
  name: projectName,
  description: 'A cooperative mystery.',
  genres: ['RPG'],
  designPhilosophies: ['Player Agency'],
});
await expect(page.getByTestId('project-selector-trigger')).toContainText(projectName);
await expect(page.getByRole('tree')).toContainText('Resources Folder');
const projectId = new URL(page.url()).pathname.split('/')[1];

// Project info routes to Settings, never a modal.
await openProjectInfoFromSelector(page, projectName);
await expect(page).toHaveURL(new RegExp(`/${projectId}/admin$`));
await expect(page.getByText('Edit Project')).toHaveCount(0);

await page.getByLabel('Project name').fill(renamedProject);
await page.getByLabel('Description').fill('An updated cooperative mystery.');
await page.getByRole('button', { name: 'Strategy' }).click();
await page.getByRole('button', { name: 'Readable Systems' }).click();
await page.getByRole('button', { name: 'Save project information' }).click();
await expect(page.getByTestId('project-selector-trigger')).toContainText(renamedProject);
await expect(page.getByRole('button', { name: renamedProject })).toBeVisible();
```

Keep the existing Library and Folder rename scenarios because only project editing is being centralized.

- [ ] **Step 2: Run the focused E2E test**

Run: `npm run test:e2e:edit-info -- --workers=1`

Expected: PASS against a running local Supabase and Next.js environment. If credentials or local services are unavailable, record the exact skipped dependency and still run the unit/static suite.

- [ ] **Step 3: Run the complete focused regression suite**

Run:

```bash
npx jest --runInBand \
  tests/unit/database/project-foundation-migration.test.ts \
  src/lib/projectFoundation.test.ts \
  src/components/game-design-system/GameDesignSystemCreatePage.test.tsx \
  src/components/projects/NewProjectModal.test.tsx \
  src/components/admin/AdminSettingsPage.test.tsx \
  tests/unit/project-update-cas.test.ts \
  src/app/api/projects/route.test.ts \
  tests/unit/projects-page-create-navigation.test.tsx \
  tests/unit/layout/project-create-list-refresh.test.ts \
  tests/unit/layout/sidebar-project-selector.test.ts \
  tests/unit/layout/recent-admin-nav.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run: `npm run typecheck && npm run lint`

Expected: both commands exit 0.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Commit E2E coverage and final adjustments**

```bash
git add tests/e2e/fixures/projects.ts tests/e2e/pages/project.page.ts tests/e2e/specs/edit-info.spec.ts
git commit -m "test: cover project foundation library flow"
```

---

## Final Review Checklist

- [ ] Existing Agent project creation still calls the legacy idempotent RPC unchanged.
- [ ] Existing direct E2E calls to `create_project_with_default_resource` still succeed.
- [ ] New projects have non-null empty Foundation arrays when optional fields are omitted.
- [ ] A failed creation does not leave a project without its Resources folder.
- [ ] Editor and viewer roles cannot update project metadata through UI or RLS.
- [ ] Project creation immediately updates the Library project selector and Resources folder tree.
- [ ] Settings is the only project-information editor.
- [ ] GDS Foundation preset/custom-tag behavior remains unchanged.
- [ ] No project Foundation input has a character counter or `maxLength`; GDS retains its existing 80/120 tag limits.
- [ ] Both tag groups enforce the 20-item limit in UI, service normalization, and database constraints.
