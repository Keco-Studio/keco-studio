# GDD to Create Map Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents for this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate zero to three validated Create Map V3 images from explicit map descriptions in a generated GDD and render those private, version-pinned assets inside the GDD.

**Architecture:** Extend the durable GDD job with a post-document Map Brief compiler and persist one leased `gdd_map_artifacts` child job per brief. Child workers materialize immutable Create Map V3 generation revisions, invoke the existing PixelLab lifecycle with service-role worker authorization, and expose status through sanctioned MDX map-reference blocks. The GDD remains successful when a map fails, and a zero-map GDD creates no map rows or map UI.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL RLS and RPCs, Supabase Edge Functions/Deno, Zod, MDXEditor/Lexical/Yjs, React Query, Jest, Playwright.

## Global Constraints

- Work directly on the current branch; do not create a git worktree.
- Do not use test-driven development. Implement each bounded task first, then add and run focused regression tests before committing it.
- Generate images only. Never call the collision-grid API from this workflow.
- Extract only maps explicitly described by the final GDD; return zero maps when no explicit description exists.
- Generate every extracted map up to a hard maximum of three.
- A map failure must not delete, fail, or regenerate the completed GDD.
- The start action authorizes normal paid submissions without a second confirmation, while unknown provider outcomes remain blocked from automatic resubmission.
- Use the pinned GDS version and Art Style snapshot. Do not read a mutable current version after job creation.
- Store private asset identities and exact revisions, never signed URLs, in durable content.
- Use existing Create Map V3 dimensions only: `512x512`, `688x384`, and `384x688`.
- Existing user changes under `.superpowers/` are unrelated and must never be staged.

---

### Task 1: Persist Durable GDD Map Child Jobs

**Files:**
- Create: `supabase/migrations/20260819090000_gdd_map_generation_integration.sql`
- Create: `tests/unit/database/gdd-map-generation-migration.test.ts`
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/lib/gdd-generation/v2/contracts.ts`

**Interfaces:**
- Consumes: existing `gdd_generation_jobs`, `documents`, `map_projects`, `map_revisions`, `map_assets`, `map_validate_v3_payload`, and `transition_map_asset` contracts.
- Produces: `GddMapArtifact`, public map summaries, leased child-job RPC wrappers, and one atomic GDD persistence RPC accepting preassigned Map Brief/artifact IDs.

- [ ] **Step 1: Add the database migration**

Create `public.gdd_map_artifacts` with project/GDD/version provenance, immutable `map_brief`, `style_contract`, `input_hash`, nullable map/revision/asset identities, child status/phase, lease fields, retry fields, and a unique `(gdd_generation_job_id, map_brief_id)` key. Add RLS allowing accepted project readers to select and service-role-only writes.

Extend GDD job status with `waiting_for_maps` and `completed_with_map_failures`; extend phases with `compiling_maps`, `generating_maps`, and `finalizing_maps`. Replace the completion RPC with `persist_gdd_generation_with_maps(...)`, which creates the Document and all child rows atomically, sets `completed` for an empty brief array, and otherwise releases the GDD lease into `waiting_for_maps`.

Add service-only RPCs with exact names:

```sql
claim_gdd_map_artifact(p_worker_id text, p_lease_seconds integer default 90)
prepare_gdd_map_artifact(p_artifact_id uuid, p_worker_id text, p_plan jsonb,
  p_scene jsonb, p_generation_id uuid, p_plan_fingerprint text)
reschedule_gdd_map_artifact(p_artifact_id uuid, p_worker_id text,
  p_phase text, p_delay_seconds integer, p_error text default null)
finish_gdd_map_artifact(p_artifact_id uuid, p_worker_id text,
  p_status text, p_error text default null)
```

`prepare_gdd_map_artifact` must validate V3 payloads, verify the original actor still has project write access, create one map project, generation revision, next editable draft, and planned `map-image` asset, then bind those IDs to the child row in one transaction.

- [ ] **Step 2: Extend TypeScript job contracts and service methods**

Add public child summaries without prompts or provider payloads:

```ts
export type PublicGddMapArtifact = {
  id: string;
  map_brief_id: string;
  title: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'blocked';
  phase: 'planning' | 'submitting' | 'polling' | 'validating' | 'ready' | 'failed' | 'blocked';
  map_project_id: string | null;
  map_revision_id: string | null;
  error: string | null;
};
```

Add `maps: PublicGddMapArtifact[]` to `PublicGddGenerationJob`, include `artStyle: GameArtStyleSnapshot | null` in `GddGenerationRequestV2`, and add wrappers for all new RPCs. Fetch child summaries in `toPublicGddGenerationJob` callers rather than exposing the private brief JSON.

- [ ] **Step 3: Add migration and service regression tests**

The migration test must assert the status/phase constraints, table checks and unique key, RLS/grants, service-only RPC grants, V3 validation call, writer revalidation, atomic zero-map completion, child creation, and two-child concurrency claim limit. Extend `src/lib/services/gddGenerationService.test.ts` for DTO redaction and new RPC argument mapping.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npx jest --runInBand tests/unit/database/gdd-map-generation-migration.test.ts src/lib/services/gddGenerationService.test.ts
npm run typecheck
```

Expected: all selected suites pass and TypeScript exits 0.

Commit:

```bash
git add supabase/migrations/20260819090000_gdd_map_generation_integration.sql tests/unit/database/gdd-map-generation-migration.test.ts src/lib/services/gddGenerationService.ts src/lib/services/gddGenerationService.test.ts src/lib/gdd-generation/v2/contracts.ts
git commit -m "feat: persist GDD map generation jobs"
```

### Task 2: Compile Explicit Map Briefs and Shared GDS Style

**Files:**
- Create: `src/lib/gdd-generation/maps/contracts.ts`
- Create: `src/lib/gdd-generation/maps/compiler.ts`
- Create: `src/lib/gdd-generation/maps/compiler.test.ts`
- Create: `src/lib/gdd-generation/maps/plan.ts`
- Create: `src/lib/gdd-generation/maps/plan.test.ts`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`

**Interfaces:**
- Consumes: final validated GDD Markdown and the pinned `GameArtStyleSnapshot` stored inside `GddGenerationRequestV2`.
- Produces: `compileGddMapBriefs(input): Promise<GddMapBrief[]>`, `mapPlanFromGddBrief(brief): MapPlanV3`, and deterministic plan fingerprints.

- [ ] **Step 1: Define strict Map Brief and style schemas**

Use Zod strict objects and export these stable fields:

```ts
export type GddMapBrief = {
  id: string;
  title: string;
  mapType: 'world' | 'region' | 'level' | 'settlement' | 'interior' | 'other';
  sourceHeading: string;
  purpose: string;
  spatialLayout: string;
  regions: string[];
  routes: string[];
  landmarks: string[];
  gameplayRequirements: string[];
  visualDescription: string;
  outputSize: '512x512' | '688x384' | '384x688';
  priority: number;
  createMapDescription: string;
  styleContract: GddMapStyleContract | null;
};
```

Bound all text/array fields, reject dangerous object keys, enforce at most three returned briefs, and assign UUIDs server-side after model parsing rather than trusting model-generated IDs.

- [ ] **Step 2: Implement Art Style compilation and Map Brief extraction**

Compile `presetId`, `presetVersion`, visual identity, pixel/shape/environment/palette guidance, customization direction, references, and avoid guidance into one bounded `GddMapStyleContract` with a SHA-256 content hash.

Call the configured GDD LLM with structured JSON instructions. Require explicit source headings, forbid invented locations, and return `[]` when the Markdown has no explicit map. Retry malformed JSON/schema output once. Include the style contract in the prompt so every `createMapDescription` uses the same pinned visual direction.

- [ ] **Step 3: Deterministically materialize Create Map V3 plans**

Build plans without a second LLM call:

```ts
return {
  schemaVersion: 3,
  name: brief.title,
  summary: brief.purpose,
  map: parseOutputSize(brief.outputSize),
  description: brief.createMapDescription,
  references: [],
  styleReference: null,
  generation: { provider: 'pixellab', operation: 'create_image_pro', noBackground: false, seed: null },
};
```

Validate with `validateMapPlanV3`, build `createEmptyMapSceneV3`, and hash the canonical plan with Node SHA-256.

- [ ] **Step 4: Freeze Art Style in GDD job input**

Set `artStyle: version.artStyle` in the POST route before hashing and creating the job. A legacy `null` snapshot remains valid; it yields a `null` style contract rather than blocking GDD generation.

- [ ] **Step 5: Add post-implementation tests and commit**

Cover zero maps, one/three maps, fourth-map rejection, one repair, invented-map rejection instructions, pinned style hashing, null style, supported dimensions, V3 validation, and stable fingerprints.

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/maps/compiler.test.ts src/lib/gdd-generation/maps/plan.test.ts tests/unit/gdd-generation-routes.test.ts
npm run typecheck
```

Commit with `git commit -m "feat: compile GDD map briefs"`.

### Task 3: Add Sanctioned GDD Map Reference Nodes

**Files:**
- Create: `src/lib/documents/gddMapReferenceTypes.ts`
- Create: `src/lib/documents/gddMapMarkdown.ts`
- Create: `src/lib/documents/gddMapMarkdown.test.ts`
- Modify: `src/lib/documents/sanctionedMdx.ts`
- Modify: `src/lib/documents/sanctionedMdxDescriptors.ts`
- Modify: `src/lib/documents/sanctionedMdx.test.ts`
- Modify: `src/lib/documents/documentExportService.ts`
- Modify: `src/lib/documents/scriptImportPlainText.ts`

**Interfaces:**
- Consumes: final GDD Markdown plus child artifact IDs and source headings.
- Produces: safe `<GddMapReference artifactId="..." display="compact|full" fallbackTitle="..." />` nodes and `decorateGddWithMapReferences(markdown, artifacts): string`.

- [ ] **Step 1: Add exact attribute parsing and serialization**

Accept only UUID `artifactId`, enum `display`, and a non-empty bounded `fallbackTitle`. Reject children, expressions, URLs, event handlers, unknown attributes, malformed IDs, and text-element usage; this component is flow-only.

- [ ] **Step 2: Decorate Markdown deterministically**

Parse the sanctioned MDX AST, find the first exact source heading for each brief, insert one compact node after that section heading, and append one `## Maps and Levels` section containing full nodes in brief order. If there are zero artifacts, return the original Markdown byte-for-byte and do not append a heading.

- [ ] **Step 3: Register codec and export behavior**

Add the component rule and MDXEditor descriptor. Plain-text/script import and document export render its fallback title and omit raw identifiers and signed URLs.

- [ ] **Step 4: Add tests and commit**

Cover zero-map identity, exact heading placement, duplicate headings, compact/full pairing, sanitized fallback, Markdown/Yjs round-trip, rejected unsafe MDX, and readable export.

Run:

```bash
npx jest --runInBand src/lib/documents/gddMapMarkdown.test.ts src/lib/documents/sanctionedMdx.test.ts tests/unit/documents/document-reference-blocks.test.ts
npm run typecheck
```

Commit with `git commit -m "feat: add GDD map reference nodes"`.

### Task 4: Orchestrate GDD Persistence and PixelLab Child Workers

**Files:**
- Create: `src/lib/gdd-generation/maps/worker.ts`
- Create: `src/lib/gdd-generation/maps/worker.test.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/gdd-generation/worker.test.ts`
- Modify: `src/app/api/internal/game-design-system-worker/route.ts`
- Modify: `src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts`
- Modify: `supabase/functions/pixellab-map/auth.ts`
- Modify: `supabase/functions/pixellab-map/auth.test.ts`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-map/direct-map-lifecycle.test.ts`

**Interfaces:**
- Consumes: `compileGddMapBriefs`, decorated Markdown, atomic persistence RPC, planned V3 assets, and existing `runDirectMapLifecycle` operations.
- Produces: `processNextGddMapArtifact({ serviceClient, workerId })` and service-role-only internal PixelLab authorization tied to one GDD child artifact and original actor.

- [ ] **Step 1: Extend the GDD worker after Markdown validation**

Heartbeat `compiling_maps`, compile zero to three briefs, preassign artifact UUIDs, decorate the Markdown, encode Yjs, and call `persist_gdd_generation_with_maps`. Map compilation failure persists the GDD with a map failure summary instead of calling the existing fatal GDD path. Zero briefs finish immediately.

- [ ] **Step 2: Add service-role PixelLab authorization**

When the bearer token exactly matches `SUPABASE_SERVICE_ROLE_KEY`, require `gddMapArtifactId` and `actorUserId`. Load the child, map, revision, and asset with the service client; verify all IDs match, the child belongs to the project/GDD job, and the original actor still owns the project or has accepted admin/editor access. Reuse the existing browser JWT path unchanged for all other tokens.

- [ ] **Step 3: Implement one-step child processing**

For `planning`, build and validate the deterministic V3 plan and call `prepare_gdd_map_artifact`. For `submitting`, invoke `pixellab-map` operation `submit`. For `polling`, invoke `poll`; reschedule unfinished jobs. For a completed provider result, invoke `validate`, require the durable map asset to be `ready`, and finish the child `ready`. Never invoke collision analysis.

Classify known provider failures as `failed`, unsafe or unknown submissions as `blocked`, and transient pre-submission failures through the bounded retry fields. After every terminal child, finalize the parent to `completed` or `completed_with_map_failures` when all siblings are terminal.

- [ ] **Step 4: Schedule child workers**

The opportunistic POST callback processes the newly created GDD job and then up to two child steps. The cron route alternates system, GDD, and GDD-map queues so polling continues after the initiating request ends.

- [ ] **Step 5: Add worker and Edge Function tests and commit**

Cover zero maps, child creation, two-job concurrency, deterministic plan preparation, submit/poll/validate progression, refresh-safe idempotency, one-child failure isolation, unknown outcome blocking, permission revocation, service-token rejection without artifact identity, and no collision call.

Run:

```bash
npx jest --runInBand src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/maps/worker.test.ts tests/unit/game-design-system-worker-route.test.ts
deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/auth.test.ts supabase/functions/pixellab-map/direct-map-lifecycle.test.ts
npm run typecheck
```

Commit with `git commit -m "feat: generate maps from GDD jobs"`.

### Task 5: Resolve and Render Private Map Assets in Documents

**Files:**
- Create: `src/lib/documents/gddMapArtifactService.ts`
- Create: `src/components/documents/GddMapReferenceProvider.tsx`
- Create: `src/components/documents/GddMapReferenceEditor.tsx`
- Create: `src/components/documents/GddMapReferenceEditor.test.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.tsx`
- Modify: `src/components/documents/MdxDocumentEditor.module.css`
- Modify: `src/lib/utils/queryKeys.ts`

**Interfaces:**
- Consumes: `artifactId` from sanctioned nodes and caller-scoped Supabase access.
- Produces: batched `ResolvedGddMapArtifact` values with safe title/status, five-minute signed image URL, exact revision label, and `/create-map?mapId=...` navigation.

- [ ] **Step 1: Implement a batched RLS-aware resolver**

Fetch only requested child rows, their exact map revision and ready `map-image` asset. Require matching project IDs, revision IDs, dimensions, opaque PNG metadata, storage path, and SHA-256. Sign the private object for five minutes. Return one generic unavailable state for missing, deleted, cross-project, or forbidden data.

- [ ] **Step 2: Add one provider per open Document**

Collect/deduplicate artifact IDs, resolve them with React Query, poll every five seconds only while any child is queued/running, and invalidate on document/project changes. Avoid one request per MDX node.

- [ ] **Step 3: Build compact and full renderers**

Compact mode has a stable thumbnail box, title, status, and open-map icon. Full mode shows the inspectable image, purpose/title, exact revision, status/error, and `Open in Create Map`. Pending/failed/blocked states preserve dimensions and never overlap content on mobile. Viewer rendering contains no mutation controls.

- [ ] **Step 4: Add component tests and commit**

Cover ready, pending, failed, blocked, unavailable, compact/full layouts, deduplication, signed URL refresh, exact revision display, and navigation.

Run:

```bash
npx jest --runInBand src/components/documents/GddMapReferenceEditor.test.tsx src/lib/documents/gddMapMarkdown.test.ts
npm run typecheck
```

Commit with `git commit -m "feat: render GDD map assets"`.

### Task 6: Expose Map Progress and Create Map Deep Links

**Files:**
- Modify: `src/components/game-design-system/GddGenerationDialog.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemWorkspace.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.module.css`
- Modify: `src/lib/services/gameDesignSystemClient.ts`
- Modify: `src/features/create-map/DirectMapWorkbench.tsx`
- Modify: `src/features/create-map/hooks/useSavedMaps.ts`
- Create: `src/components/game-design-system/GddGenerationDialog.test.tsx`
- Modify: `src/components/game-design-system/GameDesignSystemsPage.test.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`

**Interfaces:**
- Consumes: public parent/child job DTOs and `?mapId=<uuid>`.
- Produces: one-click paid-map disclosure, per-map progress, partial-success output access, and direct restoration of generated maps.

- [ ] **Step 1: Update generation copy and progress**

Rename the action to `Generate GDD + maps`. State beside the submit action that it may automatically submit up to three paid map images and that clicking starts them without another confirmation. Render parent phases plus `ready/total` map progress. Treat `waiting_for_maps` as active and `completed_with_map_failures` as terminal but openable.

- [ ] **Step 2: Keep zero-map and partial-success UX clean**

Do not render a map progress row when the public map array is empty. For partial success, keep `Open GDD Document` available and show concise failed/blocked counts; ordinary retries remain in Create Map rather than regenerating the GDD.

- [ ] **Step 3: Add Create Map deep-link restore**

Read and validate `mapId` from `useSearchParams`. Once on first mount, load that V3 map directly, install its draft/generation restore state, and clear the one-shot opening guard. Invalid or forbidden IDs produce the existing non-destructive workbench error and leave local state usable.

- [ ] **Step 4: Add UI tests and commit**

Cover disclosure text, active/terminal statuses, zero-map omission, partial completion, correct deep-link map ID, forbidden map handling, and no automatic collision call after restore.

Run:

```bash
npx jest --runInBand src/components/game-design-system/GddGenerationDialog.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx tests/unit/create-map/workbench-wiring.test.tsx
npm run typecheck
```

Commit with `git commit -m "feat: show GDD map generation progress"`.

### Task 7: End-to-End Regression and Documentation Alignment

**Files:**
- Modify: `tests/e2e/specs/game-design-system.spec.ts`
- Modify: `tests/e2e/specs/create-map-v3.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-19-gdd-create-map-integration-design.md` only if implementation facts require wording corrections.

**Interfaces:**
- Consumes: the complete feature from Tasks 1-6.
- Produces: verified zero-map, all-ready, partial-failure, refresh-recovery, private-asset, and deep-link workflows.

- [ ] **Step 1: Add browser regression scenarios**

Use deterministic mocked worker/provider fixtures rather than paid PixelLab calls. Verify a zero-map GDD has no `Maps and Levels` block or provider request; a two-map GDD shows two related previews and two full blocks; a failed sibling leaves the ready map and GDD usable; refresh restores parent/child progress; and `Open in Create Map` loads the expected map.

- [ ] **Step 2: Run focused feature suites**

```bash
npx jest --runInBand src/lib/gdd-generation src/lib/services/gddGenerationService.test.ts src/lib/documents/gddMapMarkdown.test.ts src/components/documents/GddMapReferenceEditor.test.tsx src/components/game-design-system/GameDesignSystemsPage.test.tsx tests/unit/gdd-generation-routes.test.ts tests/unit/create-map tests/unit/database/gdd-map-generation-migration.test.ts
npm run test:mcp
npm run typecheck
npm run typecheck:api
npm run lint
```

Expected: every command exits 0.

- [ ] **Step 3: Run build and targeted Playwright checks**

```bash
npm run build
npx playwright test tests/e2e/specs/game-design-system.spec.ts tests/e2e/specs/create-map-v3.spec.ts --workers=1
```

If environment-owned Supabase or LLM credentials prevent Playwright execution, record the exact blocked command and error; do not claim the browser flow passed.

- [ ] **Step 4: Inspect responsive rendering**

Run the dev server and capture desktop `1440x900` and mobile `390x844` screenshots of a GDD with compact and full map blocks. Confirm nonblank images, no overflow/overlap, readable failure states, and a working Create Map link.

- [ ] **Step 5: Final review and commit**

Review the diff against every confirmed product decision and non-goal, run `git diff --check`, and ensure `.superpowers/` is absent from all commits.

Commit remaining test/document changes with:

```bash
git add tests/e2e/specs/game-design-system.spec.ts tests/e2e/specs/create-map-v3.spec.ts docs/superpowers/specs/2026-08-19-gdd-create-map-integration-design.md
git commit -m "test: cover GDD map generation workflow"
```
