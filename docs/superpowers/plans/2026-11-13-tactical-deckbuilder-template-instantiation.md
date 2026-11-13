# Tactical Deckbuilder Project Template Instantiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Tactical deckbuilder` create a complete, editable dark-fantasy starter project with linked tables, a bound GDS, a GDD, and 15 bundled image/character assets.

**Architecture:** Keep blank creation on the existing RPC and route non-blank creation through an authenticated synchronous server orchestrator. A validated versioned manifest supplies logical resource keys; the orchestrator resolves them to new UUIDs, uses existing domain services, records idempotency in PostgreSQL, and compensates failures through the existing project deletion/storage cleanup boundary.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL/Storage, Zod, Jest, Testing Library, Playwright, Sharp.

**Spec:** `docs/superpowers/specs/2026-11-13-tactical-deckbuilder-template-instantiation-design.md`

**Implementation note (2026-11-14):** Bundled image generation is deferred. The first delivery uses an empty asset descriptor list, skips Art Resource activation, and retains the uploader/orchestrator branch for a later asset batch.

## Global Constraints

- The template identity is exactly `tactical-deckbuilder@1`; clients never select a version.
- User-entered project name and description remain authoritative; “Ashfall Tactics” names the starter setting only.
- `blank` remains behaviorally unchanged.
- Only Blank and Tactical deckbuilder are enabled; the other five cards remain visible, disabled, and labeled `Coming soon`.
- The manifest is server-owned, versioned, deterministic, and contains no environment UUIDs.
- Template creation invokes no LLM, embedding, PixelLab, map, dialogue, or paid generation service.
- Bundled assets use original dark-fantasy art and must not reproduce third-party characters or artwork.
- All project asset writes use the existing quota reservation/completion and cleanup-outbox paths.
- Character portraits are manual `project_game_assets` rows in category `character`, not PixelLab `character_assets` rows.
- Private signed URLs are never persisted in tables or manifests.
- Every task follows RED → GREEN → focused regression → commit.

---

## File Map

### New focused modules

- `src/lib/project-templates/schema.ts` — manifest types, Zod parsing, and logical-reference validation.
- `src/lib/project-templates/tacticalDeckbuilder.ts` — all version-1 table, GDS, GDD, and asset descriptors; no I/O.
- `src/lib/project-templates/registry.server.ts` — server-only allowlist and current-version resolution.
- `src/lib/project-templates/instantiate.server.ts` — synchronous orchestration, verification, and compensation.
- `src/lib/project-templates/instantiationStore.server.ts` — typed wrappers around claim/complete/fail/cleanup RPCs.
- `src/lib/server/projectGameAssetUpload.ts` — reusable quota-aware registration of trusted in-memory files.
- `public/project-templates/tactical-deckbuilder/v1/*.png` — 15 immutable version-1 source assets.
- `supabase/migrations/20261113100000_project_template_instantiation.sql` — idempotency state and service-role RPCs.

### Existing boundaries to modify

- `src/components/projects/projectTemplates.ts` — availability metadata.
- `src/components/projects/ProjectTemplatePicker.tsx` and `.module.css` — unavailable-card semantics and label.
- `src/components/projects/NewProjectModal.tsx` — template key and stable request ID submission.
- `src/lib/services/projectService.ts` — tactical-template API branch while preserving blank RPC behavior.
- `src/app/api/projects/route.ts` — authenticated template request validation and orchestrator call.
- `src/app/api/projects/[projectId]/game-assets/route.ts` — reuse extracted trusted-buffer upload primitives without changing browser upload behavior.
- `tests/e2e/pages/project.page.ts` and `tests/e2e/fixures/projects.ts` — optional template selection.

---

### Task 1: Expose Template Availability and Stable Creation Intent

**Files:**
- Modify: `src/components/projects/projectTemplates.ts`
- Modify: `src/components/projects/ProjectTemplatePicker.tsx`
- Modify: `src/components/projects/ProjectTemplatePicker.module.css`
- Modify: `src/components/projects/ProjectTemplatePicker.test.tsx`
- Modify: `src/components/projects/NewProjectModal.tsx`
- Modify: `src/components/projects/NewProjectModal.test.tsx`
- Modify: `src/lib/services/projectService.ts`

**Interfaces:**
- Produces: `ProjectTemplateDefinition['availability']: 'available' | 'coming-soon'`.
- Produces: `CreateProjectInput.templateKey?: ProjectTemplateKey` and `CreateProjectInput.templateRequestId?: string`.
- Produces: `createBlankProject(supabase, input)` containing the current RPC implementation for reuse by the orchestrator.
- Consumes: existing `createProject(supabase, input)` return shape.

- [ ] **Step 1: Write failing picker and modal tests**

Replace the picker selection test so it selects Tactical deckbuilder, then add assertions that all other non-blank templates are disabled and expose `Coming soon`. Update the modal service assertion to require a template key and UUID-shaped request ID, and verify the same request ID is retained after a failed tactical submission.

```tsx
expect(screen.getByRole('button', { name: /Tactical deckbuilder/ })).not.toBeDisabled();
for (const name of ['Narrative adventure', 'Survival builder', 'Management simulation', 'Action roguelike', 'Cooperative puzzle']) {
  expect(screen.getByRole('button', { name: new RegExp(`${name}.*Coming soon`) })).toBeDisabled();
}

await user.click(screen.getByRole('button', { name: /Tactical deckbuilder/ }));
await enterIdentityDraft();
await user.click(screen.getByRole('button', { name: 'Create' }));
expect(createProject).toHaveBeenCalledWith(expect.anything(), {
  name: 'Harbor Signal',
  description: 'A cooperative mystery.',
  templateKey: 'tactical-deckbuilder',
  templateRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npx jest --runInBand src/components/projects/ProjectTemplatePicker.test.tsx src/components/projects/NewProjectModal.test.tsx
```

Expected: failures because catalog entries have no availability, coming-soon cards are clickable, and the modal omits template submission fields.

- [ ] **Step 3: Implement availability and request-ID lifecycle**

Add availability to every catalog item; only `blank` and `tactical-deckbuilder` are `available`. Disable a button when the whole picker is disabled or its definition is unavailable. Include the label in visible/accessibility text.

```ts
export type ProjectTemplateAvailability = 'available' | 'coming-soon';

export type ProjectTemplateDefinition = {
  key: ProjectTemplateKey;
  name: string;
  description: string;
  icon: ProjectTemplateIcon;
  availability: ProjectTemplateAvailability;
};
```

In `NewProjectModal`, hold `templateRequestId` as nullable state. Create it once at the beginning of a valid submission with `crypto.randomUUID()`, preserve it on failure, and clear it on successful reset, close, or a change to name/description/template after a failed attempt. Call:

```ts
createProject(supabase, {
  name: trimmed,
  description: draft.description.trim(),
  templateKey: selectedTemplateKey,
  templateRequestId: requestId,
});
```

Extract the current `createProject` RPC body into exported `createBlankProject`. Let `createProject` delegate to it for every input until Task 6, so runtime behavior does not change while Task 5 gains a non-recursive base-project primitive.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
npx jest --runInBand src/components/projects/ProjectTemplatePicker.test.tsx src/components/projects/NewProjectModal.test.tsx src/lib/services/projectService.test.ts
npm run typecheck
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/projects src/lib/services/projectService.ts
git commit -m "feat: expose available project templates"
```

---

### Task 2: Add the Validated Version-1 Manifest and Original Artwork

**Files:**
- Create: `src/lib/project-templates/schema.ts`
- Create: `src/lib/project-templates/tacticalDeckbuilder.ts`
- Create: `src/lib/project-templates/registry.server.ts`
- Create: `src/lib/project-templates/tacticalDeckbuilder.test.ts`
- Create: `public/project-templates/tactical-deckbuilder/v1/key-art.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/card-ember-lance.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/card-ash-guard.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/card-echoing-hex.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/icon-burn.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/icon-guard.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/icon-mark.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/icon-exhaust.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/icon-echo.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/hero-cinder-warden.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/hero-veil-seer.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/enemy-ashling.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/enemy-iron-husk.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/enemy-veil-cultist.png`
- Create: `public/project-templates/tactical-deckbuilder/v1/enemy-cinder-tyrant.png`

**Interfaces:**
- Produces: `ProjectTemplateManifest`, `TemplateRowReference`, and `parseProjectTemplateManifest(value)`.
- Produces: `resolveProjectTemplate('tactical-deckbuilder')` returning the immutable parsed version-1 manifest.
- Produces: logical keys used by Task 5; no database UUIDs.

- [ ] **Step 1: Write the failing manifest contract test**

```ts
expect(manifest.key).toBe('tactical-deckbuilder');
expect(manifest.version).toBe(1);
expect(manifest.folders.map((item) => item.key)).toEqual(['game-design', 'cards-combat', 'content']);
expect(manifest.tables.map((item) => [item.key, item.rows.length])).toEqual([
  ['cards', 12], ['keywords', 5], ['heroes', 2],
  ['enemies', 4], ['encounters', 3], ['rewards', 4],
]);
expect(manifest.assets).toHaveLength(15);
expect(manifest.assets.filter((asset) => asset.category === 'character')).toHaveLength(6);
expect(() => parseProjectTemplateManifest({ ...manifest, assets: [...manifest.assets, manifest.assets[0]] })).toThrow(/duplicate asset key/i);
expect(() => parseProjectTemplateManifest({
  ...manifest,
  tables: manifest.tables.map((table) => table.key === 'heroes'
    ? { ...table, rows: [{ ...table.rows[0], values: { ...table.rows[0].values, startingDeck: { rowRefs: ['card.missing'] } } }, ...table.rows.slice(1)] }
    : table),
})).toThrow(/card\.missing/);
```

Also assert `parseRuleSet(manifest.gds.rules)`, `parseGameDesignDocument(manifest.gds.document)`, all asset files exist, all PNG signatures are valid, and every relative path remains beneath `public/project-templates/tactical-deckbuilder/v1`.

- [ ] **Step 2: Run the contract test and confirm RED**

```bash
npx jest --runInBand src/lib/project-templates/tacticalDeckbuilder.test.ts
```

Expected: module-not-found failure for the manifest modules.

- [ ] **Step 3: Implement the manifest schema and cross-reference validator**

Use these exact core shapes:

```ts
export type TemplateScalar = string | number | boolean | string[];
export type TemplateRowReference = { rowRefs: string[] };
export type TemplateCellValue = TemplateScalar | TemplateRowReference;

export type ProjectTemplateManifest = {
  key: 'tactical-deckbuilder';
  version: 1;
  theme: 'Ashfall Tactics';
  folders: Array<{ key: string; name: string; description: string }>;
  tables: Array<{
    key: string;
    folderKey: string;
    name: string;
    description: string;
    fields: Array<{
      key: string;
      label: string;
      dataType: 'string' | 'string_array' | 'int' | 'boolean' | 'enum' | 'reference';
      required?: boolean;
      enumOptions?: string[];
      referenceTableKeys?: string[];
    }>;
    rows: Array<{ key: string; name: string; values: Record<string, TemplateCellValue> }>;
  }>;
  gdd: { description: string; markdown: string };
  gds: { summary: string; rules: GameRulesKernel; document: GameDesignDocument; artStyle: GameArtStyleSnapshot };
  assets: Array<{ key: string; fileName: string; displayName: string; category: GameAssetCategory; mimeType: 'image/png' }>;
};
```

The parser must reject duplicate folder/table/field/row/asset keys, missing folder keys, values for undeclared fields, invalid enum values, reference values on non-reference fields, references outside declared target tables, missing asset files, absolute paths, `..`, and invalid GDS/document/art-style data.

- [ ] **Step 4: Add exact starter content**

Use these row names and relationships:

```text
Keywords: Burn, Guard, Mark, Exhaust, Echo
Cards: Ember Lance, Ash Guard, Kindle, Scorching Brand, Bastion Oath,
       Reprisal, Veil Step, Echoing Hex, Cull the Mark, Cinder Storm,
       Purging Flame, Last Ember
Heroes: Cinder Warden, Veil Seer
Enemies: Ashling, Iron Husk, Veil Cultist, Cinder Tyrant
Encounters: Charred Crossing, Iron Chapel, Tyrant's Pyre
Rewards: Common Draft, Focused Upgrade, Relic Cache, Elite Bounty
```

Use `reference` fields for Cards → Keywords, Heroes → Cards, Encounters → Enemies/Rewards, and Rewards → Cards. The first hero starts with defensive/Burn cards; the second starts with Mark/Echo cards. `Art Resource Name` values exactly match their portrait display names.

Create a schema-version-2 GDS with at least one required rule for each of `player`, `objective`, `action`, `object_state`, `sequence`, `resource_cost`, `resolution_feedback`, and `fallback`. Use the retained `hand-painted-2d@1` preset with customization:

```ts
{
  direction: 'Dark fantasy card illustrations with charcoal silhouettes, ember orange focal light, and readable iconography at small sizes.',
  referenceGames: [],
  avoid: 'No copied characters, logos, interface layouts, muddy silhouettes, photorealism, or illegible ornamental text.',
}
```

The GDD Markdown must include these headings in order: `Game Overview`, `Player Fantasy`, `Core Loop`, `Combat Rules`, `Deckbuilding`, `Heroes`, `Enemies and Encounters`, `Progression and Rewards`, `UI and Readability`, `Art Direction`, `Content Production Checklist`.

- [ ] **Step 5: Generate and normalize the 15 original PNG assets**

Use the `imagegen` skill. Generate an original cohesive hand-painted dark-fantasy set with ember orange, charcoal, bone, and muted teal; no text, logos, existing characters, or recognizable third-party composition. Use 1024×1024 for key/card art and 768×768 for portraits; use 256×256 transparent-background symbols for keyword icons. Normalize final files with Sharp to PNG, strip metadata, and keep each below the existing per-file project asset limit.

Character prompts must preserve distinct silhouettes:

```text
Cinder Warden — armored guardian, broad furnace shield, ember-lined cloak, defensive silhouette.
Veil Seer — agile occult tactician, crescent staff, muted teal veil, precise spellcasting silhouette.
Ashling — small scorched scavenger, quick and fragile.
Iron Husk — massive hollow armor, slow defensive elite.
Veil Cultist — masked ranged hex caster, thin angular silhouette.
Cinder Tyrant — crowned furnace knight, boss-scale silhouette, no logo or text.
```

- [ ] **Step 6: Run manifest, image, and type checks**

```bash
npx jest --runInBand src/lib/project-templates/tacticalDeckbuilder.test.ts
npm run typecheck
```

Expected: manifest parses, counts match exactly, every file exists and has a PNG signature, and typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/project-templates public/project-templates/tactical-deckbuilder
git commit -m "feat: add tactical deckbuilder template manifest"
```

---

### Task 3: Add Idempotent Instantiation State and Cleanup RPCs

**Files:**
- Create: `supabase/migrations/20261113100000_project_template_instantiation.sql`
- Create: `tests/unit/database/project-template-instantiation-migration.test.ts`
- Create: `tests/unit/database/project-template-instantiation.behavior.test.ts`
- Create: `src/lib/project-templates/instantiationStore.server.ts`
- Create: `src/lib/project-templates/instantiationStore.server.test.ts`

**Interfaces:**
- Produces: `claimProjectTemplateInstantiation`, `checkpointProjectTemplateInstantiation`, `completeProjectTemplateInstantiation`, `failProjectTemplateInstantiation`, and `cleanupProjectTemplateInstantiation`.
- Produces: `TemplateInstantiationClaim` with `id`, `claimed`, `status`, `projectId`, `defaultFolderId`, and `designSystemId`.

- [ ] **Step 1: Write failing migration and store tests**

Static tests must assert the table is RLS-enabled, authenticated users receive no direct grants, `(owner_id, request_id)` is unique, status is constrained to `running|completed|failed`, and every mutation function is service-role-only. Behavior tests must create an owner and verify first claim wins, concurrent claim does not win, completed replay returns stored IDs, failed claim can be reclaimed, and cleanup removes both the project and template-created GDS while returning durable storage cleanup job IDs.

```ts
expect(first.claimed).toBe(true);
expect(second).toMatchObject({ claimed: false, status: 'running' });
expect(replay).toMatchObject({ claimed: false, status: 'completed', project_id: projectId });
expect(reclaimed).toMatchObject({ claimed: true, status: 'running' });
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
npx jest --runInBand tests/unit/database/project-template-instantiation-migration.test.ts src/lib/project-templates/instantiationStore.server.test.ts
```

Expected: missing migration and store module failures.

- [ ] **Step 3: Implement the migration**

Create the table with this durable state:

```sql
create table public.project_template_instantiations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  template_key text not null,
  template_version integer not null check (template_version > 0),
  status text not null check (status in ('running','completed','failed')),
  project_id uuid references public.projects(id) on delete set null,
  default_folder_id uuid references public.folders(id) on delete set null,
  design_system_id uuid references public.game_design_systems(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, request_id)
);
```

Implement service-role-only security-definer RPCs that:

- atomically insert and return `claimed=true`, or lock the existing row;
- reject the same request ID with a different key/version;
- return completed/running rows with `claimed=false`;
- transition failed → running only after its `project_id` and `design_system_id` are null;
- checkpoint the new project/default folder immediately after base creation and checkpoint the GDS immediately after GDS creation;
- complete only a running row owned by the expected user;
- clean up by calling `delete_project_and_enqueue_storage_cleanup(project_id)`, deleting the now-unbound GDS, nulling resource IDs, and marking the row failed with a bounded error code.

- [ ] **Step 4: Implement the typed store wrapper**

```ts
export type TemplateInstantiationClaim = {
  id: string;
  claimed: boolean;
  status: 'running' | 'completed' | 'failed';
  projectId: string | null;
  defaultFolderId: string | null;
  designSystemId: string | null;
};

export async function claimProjectTemplateInstantiation(
  serviceClient: SupabaseClient,
  input: { ownerId: string; requestId: string; templateKey: string; templateVersion: number },
): Promise<TemplateInstantiationClaim>;
```

Strictly validate every UUID/status/boolean returned by RPCs. Convert key/version conflicts to `ProjectTemplateRequestConflictError` and concurrent running results to `ProjectTemplateInProgressError` at the caller boundary.

- [ ] **Step 5: Reset local Supabase and run behavior tests**

```bash
npm run supabase:reset
npm run test:unit:db -- tests/unit/database/project-template-instantiation.behavior.test.ts
```

Expected: all behavior tests pass with no skips and project/GDS cleanup is observable.

- [ ] **Step 6: Run focused regression and commit**

```bash
npx jest --runInBand tests/unit/database/project-template-instantiation-migration.test.ts src/lib/project-templates/instantiationStore.server.test.ts
git add supabase/migrations/20261113100000_project_template_instantiation.sql tests/unit/database/project-template-instantiation* src/lib/project-templates/instantiationStore.server*
git commit -m "feat: add project template instantiation state"
```

---

### Task 4: Extract a Quota-Aware Trusted-Buffer Asset Uploader

**Files:**
- Create: `src/lib/server/projectGameAssetUpload.ts`
- Create: `tests/unit/project-game-asset-upload.test.ts`
- Modify: `src/app/api/projects/[projectId]/game-assets/route.ts`
- Modify: `tests/unit/project-game-assets-route.test.ts`

**Interfaces:**
- Produces: `registerProjectGameAssetBuffer(input): Promise<RegisteredProjectGameAsset>`.
- Consumes: `reserveProjectStorage`, `releaseProjectStorage`, Sharp, existing content/MIME contracts, storage bucket `project-assets`, and `complete_project_game_asset_storage_upload_v2`.

- [ ] **Step 1: Write failing buffer-uploader tests**

Cover a successful PNG, quota reservation failure, storage upload failure with reservation release, completion failure with object removal and reservation release, path confinement, and metadata/hash computation.

```ts
const result = await registerProjectGameAssetBuffer({
  client: supabase,
  userId: USER_ID,
  projectId: PROJECT_ID,
  category: 'character',
  fileName: 'hero-cinder-warden.png',
  mimeType: 'image/png',
  bytes: pngBytes,
});
expect(result).toMatchObject({ assetId: ASSET_ID, category: 'character', width: 2, height: 2 });
expect(rpc).toHaveBeenCalledWith('complete_project_game_asset_storage_upload_v2', expect.objectContaining({
  p_project_id: PROJECT_ID,
  p_category: 'character',
  p_sha256: createHash('sha256').update(pngBytes).digest('hex'),
}));
```

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx jest --runInBand tests/unit/project-game-asset-upload.test.ts tests/unit/project-game-assets-route.test.ts
```

Expected: missing uploader module failure.

- [ ] **Step 3: Implement the reusable server service**

```ts
export type RegisterProjectGameAssetBufferInput = {
  client: SupabaseClient;
  userId: string;
  projectId: string;
  category: GameAssetCategory;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
};

export type RegisteredProjectGameAsset = {
  assetId: string;
  storagePath: string;
  category: GameAssetCategory;
  sha256: string;
  width: number | null;
  height: number | null;
};
```

Validate filename, extension, MIME, content signature, size, UUIDs, and image metadata before reserving. Use `${userId}/${projectId}/${randomUUID()}-${safeName}`. Reserve with `sourceKind: 'project_asset'`, upload with `upsert:false`, then call the existing completion RPC. On every post-reservation failure, remove any uploaded object and release the reservation. Return only strictly validated completion data.

- [ ] **Step 4: Refactor the browser route to use shared validation/completion helpers**

Keep the current two-phase signed upload API and response contract unchanged. Move common MIME validation, Sharp metadata, hash, completion-RPC parsing, and cleanup helpers into the new module; do not make browser completion upload the file twice.

- [ ] **Step 5: Run upload security regressions**

```bash
npx jest --runInBand tests/unit/project-game-asset-upload.test.ts tests/unit/project-game-assets-route.test.ts tests/unit/project-asset-browser-upload.test.ts tests/unit/project-asset-content.test.ts
npm run check:storage-writes
npm run typecheck
```

Expected: all tests and the storage-write audit pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/projectGameAssetUpload.ts src/app/api/projects/\[projectId\]/game-assets/route.ts tests/unit/project-game-asset-upload.test.ts tests/unit/project-game-assets-route.test.ts
git commit -m "refactor: share project asset registration"
```

---

### Task 5: Implement the Synchronous Template Orchestrator

**Files:**
- Create: `src/lib/project-templates/instantiate.server.ts`
- Create: `src/lib/project-templates/instantiate.server.test.ts`
- Modify: `src/lib/project-templates/instantiationStore.server.ts`

**Interfaces:**
- Produces: `instantiateProjectTemplate(input): Promise<{ project: Project; defaultFolderId: string }>`.
- Consumes: manifest registry, instantiation store, project/folder/library/field/row/document/GDS services, trusted-buffer uploader, and project deletion cleanup jobs.

- [ ] **Step 1: Write failing orchestration tests with injected dependencies**

Inject a dependency object so the unit test records calls without mocking module-loader internals. Assert creation order, logical reference resolution, derived names, exact counts, idempotent replay, concurrent rejection, and compensation after failures at a table step, GDS step, and asset step.

```ts
expect(events.slice(0, 5)).toEqual([
  'claim:tactical-deckbuilder@1',
  'project:create',
  'folder:create:game-design',
  'folder:create:cards-combat',
  'folder:create:content',
]);
expect(created).toMatchObject({ defaultFolderId: 'folder-root' });
expect(events.filter((event) => event.startsWith('table:create:'))).toHaveLength(6);
expect(events.filter((event) => event.startsWith('row:create:'))).toHaveLength(30);
expect(events.filter((event) => event.startsWith('asset:upload:'))).toHaveLength(15);
expect(heroStartingDeck).toEqual(['db-row-ember-lance', 'db-row-ash-guard', 'db-row-kindle']);
```

- [ ] **Step 2: Run the orchestrator test and confirm RED**

```bash
npx jest --runInBand src/lib/project-templates/instantiate.server.test.ts
```

Expected: missing orchestrator module failure.

- [ ] **Step 3: Implement the orchestration dependency contract**

```ts
export type InstantiateProjectTemplateInput = {
  authClient: SupabaseClient;
  serviceClient: SupabaseClient;
  userId: string;
  requestId: string;
  templateKey: Exclude<ProjectTemplateKey, 'blank'>;
  name: string;
  description: string | null;
};

export async function instantiateProjectTemplate(
  input: InstantiateProjectTemplateInput,
  dependencies: ProjectTemplateInstantiationDependencies = productionDependencies,
): Promise<{ project: Project; defaultFolderId: string }>;
```

The production dependency object wraps existing services rather than duplicating inserts. Keep helper functions focused: `createFolders`, `createTablesAndFields`, `createRows`, `resolveReferenceValues`, `createGdd`, `createAndBindGds`, `uploadAssets`, and `verifyInstantiation`.

- [ ] **Step 4: Implement creation and logical-ID resolution**

Perform these phases in order:

```text
claim → base project → project checkpoint → folders → tables → fields
      → scalar rows → reference values → GDD → GDS/version → GDS checkpoint
      → project binding → enable Art Resource → assets → verify → complete
```

Create the base through `createBlankProject(authClient, { name, description })`, then checkpoint its IDs before creating children. Create all row shells with scalar values first and then call `updateAsset(authClient, rowId, rowName, resolvedReferenceValues)` so forward references are valid. Use existing field-group compatibility columns through `addLibraryField`. Create the GDS with `createGameDesignSystem(serviceClient, userId, ...)`, title `${project.name} Game Design System`, provenance `{ source: 'project-template', templateKey, templateVersion }`, checkpoint its ID, and bind its `current_version_id` with `setProjectGameDesignSystem(authClient, ...)`.

Read bundled files only after resolving and confining them beneath the template asset root:

```ts
const absolute = path.resolve(assetRoot, descriptor.fileName);
if (!absolute.startsWith(`${assetRoot}${path.sep}`)) throw new Error('Template asset path escaped its root');
const bytes = await readFile(absolute);
```

- [ ] **Step 5: Implement verification, replay, and compensation**

Before completion, verify 3 child folders, 6 tables, 30 rows, one GDD, one bound GDS current version, 15 project game assets, and `assets_workspace_enabled=true`. A completed duplicate fetches and returns the recorded project/root folder. A running duplicate throws a safe in-progress domain error.

On failure after project creation, call `cleanupProjectTemplateInstantiation`, then synchronously attempt each returned `project_storage_cleanup_jobs` ID with `processProjectStorageCleanupJob`; a failed physical cleanup remains in the durable outbox. Preserve the original safe error category and never return the partial project.

- [ ] **Step 6: Run orchestrator and domain regressions**

```bash
npx jest --runInBand src/lib/project-templates/instantiate.server.test.ts src/lib/project-templates/tacticalDeckbuilder.test.ts src/lib/services/gameDesignSystemService.test.ts
npm run typecheck
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/project-templates/instantiate.server* src/lib/project-templates/instantiationStore.server.ts
git commit -m "feat: instantiate tactical deckbuilder projects"
```

---

### Task 6: Connect the Authenticated API and Client Creation Flow

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Modify: `src/app/api/projects/route.test.ts`
- Modify: `src/lib/services/projectService.ts`
- Modify: `src/lib/services/projectService.test.ts`
- Modify: `src/components/projects/NewProjectModal.test.tsx`

**Interfaces:**
- Consumes: `instantiateProjectTemplate` from Task 5.
- Preserves: API success response `{ ...project, default_folder_id: string }`.
- Preserves: client service return `{ project, defaultFolderId }`.

- [ ] **Step 1: Write failing route and service tests**

Test exact branching:

```ts
expect(rpc).toHaveBeenCalledWith('create_project_with_foundation', expect.anything()); // blank
expect(instantiateProjectTemplate).not.toHaveBeenCalled();

expect(instantiateProjectTemplate).toHaveBeenCalledWith(expect.objectContaining({
  userId: USER_ID,
  requestId: REQUEST_ID,
  templateKey: 'tactical-deckbuilder',
  name: 'Tactics',
  description: 'A starter.',
}));
expect(rpc).not.toHaveBeenCalledWith('create_project_with_foundation', expect.anything());
```

Also test missing/invalid request UUID, `coming-soon` key, unknown key, request conflict, in-progress response, quota error, and safe generic failure. In `projectService.test.ts`, assert blank still calls Supabase RPC while tactical performs one authenticated `POST /api/projects` and converts `default_folder_id`.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
npx jest --runInBand src/app/api/projects/route.test.ts src/lib/services/projectService.test.ts src/components/projects/NewProjectModal.test.tsx
```

Expected: tactical requests still use the blank RPC or are ignored.

- [ ] **Step 3: Extend the project API schema and branch**

Accept only this optional template envelope:

```ts
const templateSchema = z.discriminatedUnion('templateKey', [
  z.object({ templateKey: z.literal('blank'), templateRequestId: z.string().uuid().optional() }),
  z.object({ templateKey: z.literal('tactical-deckbuilder'), templateRequestId: z.string().uuid() }),
]);
```

Omitted `templateKey` remains blank for backward compatibility. Resolve the service client only in the tactical branch. Map conflict/in-progress to 409, quota exceeded to 409, forbidden to 403, invalid input to 400, and unexpected failures to a sanitized 500. Preserve the flattened existing success response.

- [ ] **Step 4: Branch `createProject` without changing blank behavior**

```ts
if (!input.templateKey || input.templateKey === 'blank') {
  return createBlankProject(supabase, input);
}
const session = await supabase.auth.getSession();
const response = await fetch('/api/projects', {
  method: 'POST',
  headers: { 'content-type': 'application/json', Authorization: `Bearer ${session.data.session?.access_token ?? ''}` },
  body: JSON.stringify({
    name,
    description,
    templateKey: input.templateKey,
    templateRequestId: input.templateRequestId,
  }),
});
```

Strictly validate the response contains a project object with string `id` and a string `default_folder_id`. Surface safe server messages; use `Failed to create project from template` for malformed or unexpected responses.

- [ ] **Step 5: Run API, service, component, and auth regression tests**

```bash
npx jest --runInBand src/app/api/projects/route.test.ts src/lib/services/projectService.test.ts src/components/projects/NewProjectModal.test.tsx tests/unit/api-error-sanitization.test.ts tests/unit/auth/route-auth.test.ts
npm run typecheck
npm run typecheck:api
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/projects/route.test.ts src/lib/services/projectService* src/components/projects/NewProjectModal*
git commit -m "feat: create projects from tactical template"
```

---

### Task 7: Add Local Database and Browser Acceptance Coverage

**Files:**
- Create: `tests/unit/database/tactical-project-template.behavior.test.ts`
- Create: `tests/e2e/specs/project-template-instantiation.spec.ts`
- Modify: `tests/e2e/pages/project.page.ts`
- Modify: `tests/e2e/fixures/projects.ts`

**Interfaces:**
- Consumes: public UI creation flow and local Supabase records.
- Produces: durable acceptance evidence for exact structure, idempotency, and representative UI navigation.

- [ ] **Step 1: Write the failing database acceptance test**

Create a temporary authenticated owner, call `instantiateProjectTemplate` using the owner client and service client, and assert exact results:

```ts
expect(folderNames).toEqual(['Cards & Combat', 'Content', 'Game Design', 'Resources Folder']);
expect(Object.fromEntries(libraries.map((row) => [row.name, row.asset_count]))).toEqual({
  Cards: 12, Keywords: 5, Heroes: 2, Enemies: 4, Encounters: 3, Rewards: 4,
});
expect(documents).toEqual([expect.objectContaining({ name: `${projectName} GDD` })]);
expect(binding).toMatchObject({ project_id: project.id });
expect(gameAssets).toHaveLength(15);
expect(gameAssets.filter((row) => row.category === 'character')).toHaveLength(6);
expect(project.assets_workspace_enabled).toBe(true);
```

Resolve one hero starting-deck reference and one encounter enemy/reward reference all the way to the expected row names. Submit the same request ID again and assert the same project ID and only one owned project with that name.

- [ ] **Step 2: Run the DB test and confirm RED**

```bash
npm run test:unit:db -- tests/unit/database/tactical-project-template.behavior.test.ts
```

Expected: failure until all production dependencies and storage accounting work together.

- [ ] **Step 3: Fix integration-only issues without weakening assertions**

Limit fixes to real contract mismatches found by the test: use the owner client for project-scoped RLS writes, encode reference cells as arrays of row UUID strings, bind the GDS system and current-version UUIDs together, pass the Storage API object creation timestamp into completion, and process every cleanup job ID returned by compensation. Do not replace integration assertions with mocks.

```ts
await updateAsset(ownerClient, heroRowId, 'Cinder Warden', {
  [startingDeckFieldId]: [emberLanceRowId, ashGuardRowId, kindleRowId],
});
await setProjectGameDesignSystem(ownerClient, projectId, system.id, system.current_version_id!, ownerId);
```

- [ ] **Step 4: Extend the Playwright page object**

```ts
export interface ProjectData {
  name: string;
  description?: string;
  templateKey?: 'blank' | 'tactical-deckbuilder';
}
```

After filling identity fields and before clicking Create:

```ts
if (project.templateKey === 'tactical-deckbuilder') {
  await dialog.getByRole('button', { name: /Tactical deckbuilder/ }).click();
}
```

Keep blank as default so all existing E2E callers remain unchanged.

- [ ] **Step 5: Write the failing browser acceptance test**

Create a tactical project and verify representative user-visible results: sidebar contains Cards and the GDD, the Cards table shows Ember Lance, the GDD shows `Core Loop`, the project GDS page shows the derived system title, and Art Resource shows Cinder Warden plus a working preview image. Confirm a coming-soon card is disabled in the creation dialog.

- [ ] **Step 6: Run focused browser acceptance**

```bash
npx playwright test tests/e2e/specs/project-template-instantiation.spec.ts --project=chromium --workers=1
```

Expected: pass without `LLM_API_KEY`, `EMBEDDING_API_KEY`, or PixelLab credentials.

- [ ] **Step 7: Commit**

```bash
git add tests/unit/database/tactical-project-template.behavior.test.ts tests/e2e/specs/project-template-instantiation.spec.ts tests/e2e/pages/project.page.ts tests/e2e/fixures/projects.ts
git commit -m "test: cover tactical project template creation"
```

---

### Task 8: Final Regression, Documentation Alignment, and Delivery

**Files:**
- Modify only if verification exposes a real defect: files already owned by Tasks 1–7.
- Verify: `docs/superpowers/specs/2026-11-13-tactical-deckbuilder-template-instantiation-design.md`
- Verify: `docs/superpowers/plans/2026-11-13-tactical-deckbuilder-template-instantiation.md`

**Interfaces:**
- Consumes: the complete feature.
- Produces: clean worktree, reproducible verification evidence, and pushed `dev-ting` only when explicitly authorized by the user.

- [ ] **Step 1: Run focused unit and migration suites**

```bash
npx jest --runInBand \
  src/components/projects/ProjectTemplatePicker.test.tsx \
  src/components/projects/NewProjectModal.test.tsx \
  src/lib/project-templates \
  src/app/api/projects/route.test.ts \
  src/lib/services/projectService.test.ts \
  tests/unit/project-game-asset-upload.test.ts \
  tests/unit/project-game-assets-route.test.ts \
  tests/unit/database/project-template-instantiation-migration.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run local database behavior gates**

```bash
npm run test:unit:db -- \
  tests/unit/database/project-template-instantiation.behavior.test.ts \
  tests/unit/database/tactical-project-template.behavior.test.ts
```

Expected: all pass with no skips.

- [ ] **Step 3: Run static and build gates**

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run check:storage-writes
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Run focused E2E plus the prior project-identity regression**

```bash
npx playwright test \
  tests/e2e/specs/project-template-instantiation.spec.ts \
  tests/e2e/specs/edit-info.spec.ts \
  --project=chromium --workers=1
```

Expected: both specs pass; the earlier removed genre/philosophy controls do not regress.

- [ ] **Step 5: Inspect final state and commit any verified fixes**

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

If verification required a fix, commit only tracked source/test changes for that fix:

```bash
git add -u
git commit -m "fix: harden tactical project template creation"
```

Expected: no uncommitted product changes; generated test artifacts remain ignored.
