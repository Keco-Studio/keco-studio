# Create Map V3 Direct Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Create Map resource-composition workflow with a MapPlan V3 path that sends DeepSeek's approved description directly to PixelLab `create_image_pro`, technically verifies one complete map PNG, stores it privately, and renders it in the workbench.

**Architecture:** Add V3 domain and persistence contracts beside V2, then build a focused direct-image Edge adapter, browser service, generation hook, and workbench. New maps use V3; existing V2 maps remain readable through a read-only legacy router. Reference images live in a project-scoped private registry and are resolved to short-lived URLs only inside the Edge Function.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Supabase/Postgres/RLS/Storage/Edge Functions, Deno, PixelLab MCP, Jest, Playwright, Sharp.

## Global Constraints

- DeepSeek produces the final PixelLab `description`; Keco must not compile, translate, summarize, expand, or rewrite it after Plan review.
- The final `description` must reject URLs, data URIs, credential-assignment text, PixelLab/MCP/API instructions, and dynamic Keco UI copy before save or generation.
- PixelLab generation uses only `create_image_pro` with `no_background: false`; no fallback model or tileset/map-object operation is allowed.
- `description` is non-empty, at most 2,000 characters, and is persisted exactly as submitted to PixelLab.
- Initial output profiles are exactly `512x512`, `688x384`, and `384x688`; unsupported dimensions fail before a paid request.
- A Plan supports at most four labelled content/layout references and one style reference.
- Durable state stores reference IDs and SHA-256 hashes, never signed URLs, public URLs, base64 payloads, credentials, or raw provider responses.
- V3 produces exactly one `map_image` asset per immutable generation revision.
- Returned PNGs must match Plan dimensions, be nonblank, fully opaque, privately stored, hashed, and byte-for-byte read back before becoming ready.
- First release performs technical validation only; no vision model judges semantic fidelity.
- Existing V2 records are never rewritten or deleted and open only in read-only compatibility mode.
- One paid live `create_image_pro` acceptance run is required before delivery is declared complete.

## File Map

- `src/features/create-map/model/directMapSchema.ts`: MapPlan V3, MapScene V3, profile and semantic validation.
- `src/lib/server/createMapReferenceService.ts`: authenticated reference upload/list and private storage lifecycle.
- `src/lib/server/createMapPlanner.ts`: DeepSeek V3 tool schema and correction loop.
- `src/app/api/create-map/plan/route.ts`: explicit V2/V3 request routing.
- `src/app/api/create-map/references/route.ts`: project reference GET/POST API.
- `supabase/migrations/20260811020000_create_map_v3_direct_image.sql`: V3 revisions/RPCs, `map_image`, and reference registry.
- `supabase/functions/pixellab-map/direct-map.ts`: direct provider argument mapping and reference resolution.
- `supabase/functions/pixellab-map/index.ts`: V3 submit/poll/validate branches.
- `src/features/create-map/services/createMapService.ts`: V3 CRUD, reference, generation, and restore facade.
- `src/features/create-map/hooks/useDirectMapGeneration.ts`: one-asset lifecycle and stale-result protection.
- `src/features/create-map/DirectMapWorkbench.tsx`: V3 orchestration.
- `src/features/create-map/LegacyCreateMapV2Workbench.tsx`: preserved V2 implementation with read-only entry.
- `src/features/create-map/CreateMapWorkbench.tsx`: schema-version router.
- `src/features/create-map/components/DirectMapPlanInspector.tsx`: final description/profile/reference/seed editing.
- `src/features/create-map/components/DirectMapGenerationPanel.tsx`: single-map confirmation/progress/retry/regenerate UI.
- `src/features/create-map/components/DirectMapCanvas.tsx`: exact stored-image rendering.
- `src/features/create-map/components/MapReferencePanel.tsx`: private reference upload and selection.

---

### Task 1: Define MapPlan And MapScene V3

**Files:**
- Create: `src/features/create-map/model/directMapSchema.ts`
- Modify: `tests/unit/create-map/fixtures.ts`
- Create: `tests/unit/create-map/direct-map-schema.test.ts`

**Interfaces:**
- Produces: `DIRECT_MAP_PROFILES`, `MapPlanV3Schema`, `MapSceneV3Schema`, `validateMapPlanV3(input)`, `validateMapSceneV3(plan, scene)`, `createEmptyMapSceneV3(plan)`, `MapPlanV3`, `MapSceneV3`, `MapReferenceV3`, and `MapPlanV3Issue`.
- Consumers: planner, API route, browser service, draft hook, generation hook, and V3 workbench.

- [ ] **Step 1: Write failing V3 schema tests**

```ts
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  validateMapSceneV3,
} from '@/features/create-map/model/directMapSchema';
import { makeValidMapPlanV3 } from './fixtures';

it('accepts a direct Pro map plan without rewriting description', () => {
  const plan = makeValidMapPlanV3();
  expect(validateMapPlanV3(plan)).toEqual({ success: true, data: plan });
});

it.each([[640, 448], [513, 512], [688, 385]])('rejects unsupported profile %sx%s', (width, height) => {
  const result = validateMapPlanV3({ ...makeValidMapPlanV3(), map: { width, height } });
  expect(result).toMatchObject({ success: false });
  if (result.success === false) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unsupported_profile' }));
});

it('rejects a fifth content reference, a transparent request, and an overlong prompt', () => {
  const plan = makeValidMapPlanV3();
  const result = validateMapPlanV3({
    ...plan,
    description: 'x'.repeat(2001),
    references: Array.from({ length: 5 }, (_, index) => ({
      assetId: `00000000-0000-4000-8000-00000000000${index}`,
      sha256: String(index).repeat(64), role: 'content', usage: `reference ${index}`,
    })),
    generation: { ...plan.generation, noBackground: true },
  });
  expect(result).toMatchObject({ success: false });
});

it.each([
  'Use https://example.com/map.png',
  'Authorization: Bearer secret',
  'Call create_image_pro through the PixelLab MCP API',
  'Render the current Keco button label',
])('rejects unsafe provider description content: %s', (description) => {
  const result = validateMapPlanV3({ ...makeValidMapPlanV3(), description });
  expect(result).toMatchObject({ success: false });
  if (result.success === false) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'unsafe_description' }));
});

it('requires an exact locked map-image binding only after generation', () => {
  const plan = makeValidMapPlanV3();
  const empty = createEmptyMapSceneV3(plan);
  expect(validateMapSceneV3(plan, empty).success).toBe(true);
  expect(validateMapSceneV3(plan, {
    ...empty,
    mapImage: {
      assetKey: 'map-image', sourceRevisionId: '00000000-0000-4000-8000-000000000010',
      width: 384, height: 688, locked: true,
    },
  }).success).toBe(false);
});
```

- [ ] **Step 2: Run the schema tests and confirm the missing-module failure**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-schema.test.ts`

Expected: FAIL because `directMapSchema.ts` and `makeValidMapPlanV3` do not exist.

- [ ] **Step 3: Implement the exact V3 contracts**

```ts
import { z } from 'zod';

export const DIRECT_MAP_PROFILES = [
  { width: 512, height: 512 },
  { width: 688, height: 384 },
  { width: 384, height: 688 },
] as const;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const ExactDescriptionSchema = z.string().min(1).max(2_000)
  .refine((value) => value.trim().length > 0, 'Description cannot be blank');

export const MapReferenceV3Schema = z.object({
  assetId: z.string().uuid(),
  sha256: Sha256Schema,
  role: z.enum(['content', 'layout']),
  usage: z.string().trim().min(1).max(240),
}).strict();

export const MapPlanV3Schema = z.object({
  schemaVersion: z.literal(3),
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  map: z.object({ width: z.number().int(), height: z.number().int() }).strict(),
  description: ExactDescriptionSchema,
  references: z.array(MapReferenceV3Schema).max(4),
  styleReference: z.object({
    assetId: z.string().uuid(),
    sha256: Sha256Schema,
    copy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).min(1).max(4),
  }).strict().nullable(),
  generation: z.object({
    provider: z.literal('pixellab'),
    operation: z.literal('create_image_pro'),
    noBackground: z.literal(false),
    seed: z.number().int().nonnegative().nullable(),
  }).strict(),
}).strict();

export const MapSceneV3Schema = z.object({
  schemaVersion: z.literal(3),
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  mapImage: z.object({
    assetKey: z.literal('map-image'),
    sourceRevisionId: z.string().uuid(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    locked: z.literal(true),
  }).strict().nullable(),
  canvas: z.object({ zoom: z.number().positive(), panX: z.number(), panY: z.number() }).strict(),
}).strict();

export type MapPlanV3 = z.infer<typeof MapPlanV3Schema>;
export type MapSceneV3 = z.infer<typeof MapSceneV3Schema>;
export type MapReferenceV3 = z.infer<typeof MapReferenceV3Schema>;

export function createEmptyMapSceneV3(plan: MapPlanV3): MapSceneV3 {
  return { schemaVersion: 3, size: { ...plan.map }, mapImage: null, canvas: { zoom: 1, panX: 24, panY: 24 } };
}
```

Add semantic validation that the width/height pair occurs in `DIRECT_MAP_PROFILES`, reference IDs are unique across content and style references, and a non-null Scene binding exactly matches Plan dimensions. Reject descriptions containing `https://`, `http://`, `www.`, `data:image/`, credential assignments (`api key`, `authorization`, `bearer`, `password`, or `token` followed by `:` or `=`), provider-control terms (`create_image_pro`, `get_image`, `PixelLab`, `MCP API`), or dynamic Keco UI instructions. Return issue codes `invalid_schema`, `unsupported_profile`, `duplicate_reference`, `unsafe_description`, and `dimension_mismatch` with stable paths. Apply this validation in the planner, editor, save facade, and pre-generation gate without transforming the accepted string.

Add `makeValidMapPlanV3(overrides?: Partial<MapPlanV3>)` and `makeEmptyMapSceneV3(overrides?: Partial<MapPlanV3>)` fixtures with a 512x512 opaque-map description and no references.

- [ ] **Step 4: Run V3 and existing schema suites**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-schema.test.ts tests/unit/create-map/map-plan-schema.test.ts tests/unit/create-map/map-scene-schema.test.ts`

Expected: PASS with no V1/V2 regression.

- [ ] **Step 5: Commit the domain contracts**

```bash
git add src/features/create-map/model/directMapSchema.ts tests/unit/create-map/direct-map-schema.test.ts tests/unit/create-map/fixtures.ts
git commit -m "feat: define direct map v3 domain"
```

---

### Task 2: Add V3 Persistence And Private Reference Registry

**Files:**
- Create: `supabase/migrations/20260811020000_create_map_v3_direct_image.sql`
- Create: `tests/unit/database/create-map-v3-migration.test.ts`
- Modify: `tests/unit/database/create-map-workbench.rls.behavior.test.ts`

**Interfaces:**
- Produces table `public.map_reference_images` and RPCs `create_map_project_v3`, `save_map_draft_v3`, `publish_map_revision_v3`, and `create_map_asset_plan_v3`.
- Produces `map_assets.kind = 'map_image'` and permits `map_revisions.schema_version = 3`.
- Consumers: reference API and `createMapService` V3 methods.

- [ ] **Step 1: Write migration contract tests**

```ts
const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260811020000_create_map_v3_direct_image.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

it('adds schema 3 and the map_image kind without dropping legacy values', () => {
  expect(sql).toMatch(/schema_version in \(1, 2, 3\)/i);
  expect(sql).toMatch(/map_assets_kind_check[\s\S]+terrain[\s\S]+background[\s\S]+map_image/i);
});

it('defines a private project-scoped reference registry', () => {
  expect(sql).toMatch(/create table public\.map_reference_images/i);
  expect(sql).toMatch(/sha256 text not null check \(sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
  expect(sql).toMatch(/enable row level security/i);
  expect(sql).toMatch(/map_reference_images_select/i);
});

it.each([
  ['create_map_project_v3', 'uuid, text, uuid, timestamptz, bigint, bigint, jsonb, jsonb'],
  ['save_map_draft_v3', 'uuid, uuid, bigint, jsonb, jsonb'],
  ['publish_map_revision_v3', 'uuid, uuid, bigint'],
  ['create_map_asset_plan_v3', 'uuid, uuid, text'],
])('defines and grants authenticated RPC %s', (name, signature) => {
  expect(sql).toMatch(new RegExp(`create function public\\.${name}\\(`, 'i'));
  expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) to authenticated`, 'i'));
});
```

Extend the live RLS suite to create a V3 project as owner/editor, reject viewer/outsider/anonymous callers, ensure V2 payloads fail V3 functions with `22023`, and ensure reference rows are visible only to project members.

- [ ] **Step 2: Run the migration tests and confirm failure**

Run: `npx jest --runInBand tests/unit/database/create-map-v3-migration.test.ts`

Expected: FAIL because the V3 migration does not exist.

- [ ] **Step 3: Implement the additive migration**

Use these exact table and function contracts:

```sql
create table public.map_reference_images (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  width integer not null check (width > 0 and width <= 2048),
  height integer not null check (height > 0 and height <= 2048),
  content_type text not null check (content_type = 'image/png'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.map_reference_images enable row level security;
create policy map_reference_images_select on public.map_reference_images for select using (
  exists (
    select 1 from public.projects p
    where p.id = map_reference_images.project_id
      and (
        p.owner_id = (select auth.uid())
        or exists (
          select 1 from public.project_collaborators c
          where c.project_id = p.id and c.user_id = (select auth.uid()) and c.accepted_at is not null
        )
      )
  )
);
revoke all on public.map_reference_images from public, anon, authenticated;
grant select on public.map_reference_images to authenticated;
```

Recreate `map_revisions_schema_version_check` as `in (1, 2, 3)` and extend the complete-or-empty source tuple branch from `schema_version = 2` to `schema_version in (2, 3)`. Recreate `map_assets_kind_check` with all existing kinds plus `map_image`.

Define `map_validate_v3_payload(plan, scene)` to require both JSON objects, `schemaVersion = 3`, a supported width/height pair, nonblank `description` length `1..2000`, the same unsafe-description exclusions from Task 1, `generation.provider = pixellab`, `generation.operation = create_image_pro`, `generation.noBackground = false`, nullable nonnegative integer seed, at most four references, at most one style reference object, and a Scene size equal to the Plan. This validator rejects invalid payloads but never normalizes or rewrites them.

Define V3 create/save/publish functions with the same return columns and CAS semantics as their named contracts, but every revision lookup and insert must require `schema_version = 3`. `publish_map_revision_v3` changes the immutable revision to `generating`, creates the next V3 draft, and advances `map_projects.current_revision_id` atomically.

Define `create_map_asset_plan_v3(revision_id, generation_id, plan_fingerprint)` so it:

```sql
-- Required immutable derived values
v_asset_key := 'map-image';
v_kind := 'map_image';
v_capability := 'direct_map_image';
v_prompt := v_revision.plan ->> 'description';
v_generation_params := jsonb_build_object(
  'width', (v_revision.plan #>> '{map,width}')::integer,
  'height', (v_revision.plan #>> '{map,height}')::integer,
  'noBackground', false,
  'seed', v_revision.plan #> '{generation,seed}',
  'references', coalesce(v_revision.plan -> 'references', '[]'::jsonb),
  'styleReference', v_revision.plan -> 'styleReference'
);
```

Collect content and style reference IDs/hashes in Plan order. Reject duplicates, mismatched array lengths, unknown rows, a row from another Project, or a SHA mismatch before inserting the asset. The idempotency check must compare generation ID, kind, prompt, generation params, reference IDs/hashes, and fingerprint exactly. Grant only the four public V3 RPCs to `authenticated`; keep validators private.

- [ ] **Step 4: Run static and live-enabled database tests**

Run: `npx jest --runInBand tests/unit/database/create-map-v3-migration.test.ts tests/unit/database/create-map-workbench-migration.test.ts tests/unit/database/create-map-v2-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts`

Expected: static suites PASS. The RLS suite either PASSes when configured or reports its existing explicit skip; do not count a skip as live database evidence.

- [ ] **Step 5: Commit persistence**

```bash
git add supabase/migrations/20260811020000_create_map_v3_direct_image.sql tests/unit/database/create-map-v3-migration.test.ts tests/unit/database/create-map-workbench.rls.behavior.test.ts
git commit -m "feat: persist direct map v3 revisions"
```

---

### Task 3: Implement Authorized Reference Upload And Listing

**Files:**
- Create: `src/lib/server/createMapReferenceService.ts`
- Create: `src/app/api/create-map/references/route.ts`
- Create: `tests/unit/create-map/create-map-reference-route.test.ts`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Produces: `MapReferenceRecord`, `listCreateMapReferences(projectId)`, `uploadCreateMapReference(projectId, file)`, browser methods `listReferences(projectId)` and `uploadReference(projectId, file)`.
- Consumes: `getUserProjectRole`, `getSupabaseServiceRoleClient`, Sharp, private `map-assets` bucket, and `map_reference_images`.

- [ ] **Step 1: Write failing route/service tests**

```ts
it('normalizes one authorized reference to PNG and returns no durable URL', async () => {
  getUserProjectRole.mockResolvedValue({ role: 'editor' });
  normalizeReferenceImage.mockResolvedValue({ bytes: PNG_BYTES, width: 640, height: 480, sha256: 'a'.repeat(64) });
  const request = multipartRequest({ projectId: PROJECT_ID, file: new File([PNG_BYTES], 'layout.png', { type: 'image/png' }) });
  const response = await POST(request, {} as never);
  const responseForLeakCheck = response.clone();
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({ reference: expect.objectContaining({
    projectId: PROJECT_ID, name: 'layout.png', sha256: 'a'.repeat(64), width: 640, height: 480,
  }) });
  expect(JSON.stringify(await responseForLeakCheck.json())).not.toContain('signedUrl');
});

it('rejects viewers, non-images, oversized files, and images above 2048px', async () => {
  getUserProjectRole.mockResolvedValue({ role: 'viewer' });
  expect((await POST(multipartRequest({ projectId: PROJECT_ID, file: validFile }), {} as never)).status).toBe(403);
});
```

Add browser-service tests that POST `FormData`, parse the returned record, list only project references, and reject malformed UUID/hash/dimension payloads.

- [ ] **Step 2: Run the focused tests and confirm missing modules/methods**

Run: `npx jest --runInBand tests/unit/create-map/create-map-reference-route.test.ts tests/unit/create-map/create-map-service.test.ts`

Expected: FAIL for missing route/service symbols.

- [ ] **Step 3: Implement the server reference service and route**

```ts
export type MapReferenceRecord = {
  id: string;
  projectId: string;
  name: string;
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
  contentType: 'image/png';
  byteSize: number;
  previewUrl: string | null;
};

export async function normalizeReferenceImage(file: File) {
  if (!file.type.startsWith('image/') || file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new CreateMapReferenceError('invalid_reference_file', 400);
  }
  const source = Buffer.from(await file.arrayBuffer());
  const bytes = await sharp(source, { limitInputPixels: 2048 * 2048 }).rotate().png().toBuffer();
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 2048 || metadata.height > 2048 || bytes.byteLength > 5 * 1024 * 1024) {
    throw new CreateMapReferenceError('invalid_reference_dimensions', 400);
  }
  return {
    bytes,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
```

POST must authenticate with `withAuth`, require `admin|editor`, normalize the file, upload to `references/{projectId}/{referenceId}/{sha256}.png` through the service-role client, insert the complete registry row, remove the object if insertion fails, and return a parsed record with `previewUrl: null`. GET must require project membership, query bounded rows ordered by creation time, create 300-second signed preview URLs, and return them only in the response.

- [ ] **Step 4: Add strict browser facade parsing**

Add to `createMapService`:

```ts
async listReferences(projectId: string): Promise<MapReferenceRecord[]> {
  return responseJson(await fetch(`/api/create-map/references?projectId=${encodeURIComponent(projectId)}`))
    .then(parseReferenceList);
},
async uploadReference(projectId: string, file: File): Promise<MapReferenceRecord> {
  const body = new FormData();
  body.set('projectId', projectId);
  body.set('file', file);
  return responseJson(await fetch('/api/create-map/references', { method: 'POST', body }))
    .then(parseReferenceRecord);
},
```

Keep `previewUrl` response-only and exclude it whenever a reference is converted into `MapPlanV3`.

- [ ] **Step 5: Run reference tests and typecheck**

Run: `npx jest --runInBand tests/unit/create-map/create-map-reference-route.test.ts tests/unit/create-map/create-map-service.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit reference support**

```bash
git add src/lib/server/createMapReferenceService.ts src/app/api/create-map/references/route.ts src/features/create-map/services/createMapService.ts tests/unit/create-map/create-map-reference-route.test.ts tests/unit/create-map/create-map-service.test.ts
git commit -m "feat: add private map references"
```

---

### Task 4: Make DeepSeek Produce The Final V3 Description

**Files:**
- Modify: `src/lib/server/createMapPlanner.ts`
- Modify: `src/app/api/create-map/plan/route.ts`
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `tests/unit/create-map/create-map-planner.test.ts`
- Modify: `tests/unit/create-map/create-map-plan-route.test.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`

**Interfaces:**
- Produces: `createMapPlanV3(description, source?, selection?) -> Promise<MapPlanV3>` and browser `createPlanV3(...)`.
- Consumes: authorized reference rows from Task 3 and V3 schemas from Task 1.

- [ ] **Step 1: Write failing planner tests for provider-ready output**

```ts
it('returns DeepSeek description unchanged and pins the Pro operation', async () => {
  const plan = makeValidMapPlanV3({ description: 'Exact final PixelLab prompt.  Keep two spaces.' });
  completeLlmNonStreaming.mockResolvedValue(JSON.stringify(plan));
  await expect(createMapPlanV3('生成完整俯视村庄地图')).resolves.toEqual(plan);
  expect(completeLlmNonStreaming).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ role: 'system', content: expect.stringContaining('final PixelLab create_image_pro description') }),
  ]), expect.objectContaining({ temperature: 0, thinking: 'disabled' }));
});

it('never accepts invented references and keeps authorized selection exact', async () => {
  completeLlmNonStreaming.mockResolvedValue(JSON.stringify({
    ...makeValidMapPlanV3(),
    references: [{ assetId: INVENTED_ID, sha256: 'f'.repeat(64), role: 'content', usage: 'invented' }],
  }));
  const selected = [{ assetId: REAL_ID, sha256: 'a'.repeat(64), role: 'layout' as const, usage: 'composition reference' }];
  await expect(createMapPlanV3('Village', undefined, { references: selected, styleReference: null }))
    .resolves.toMatchObject({ references: selected });
});
```

Add route tests for `schemaVersion: 3`, optional Document authorization, invalid reference/project combinations, and explicit `schemaVersion: 2` legacy routing.

- [ ] **Step 2: Run planner/route tests and confirm failure**

Run: `npx jest --runInBand tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-plan-route.test.ts`

Expected: FAIL because V3 planner and route branch are absent.

- [ ] **Step 3: Add the V3 structured tool and correction loop**

Define `CREATE_DIRECT_MAP_PLAN_TOOL` from `MapPlanV3Schema` fields. Define `DirectMapReferenceSelection` as `Pick<MapPlanV3, 'references' | 'styleReference'>` and `readNullableSeed(candidate)` as a representation-only integer/null reader that never touches `description`. The system prompt must require a complete English scene description containing camera/projection, composition, terrain, routes, landmarks, buildings, vegetation, lighting, palette, pixel-art treatment, and exclusions; it must explicitly forbid URLs and provider meta-instructions.

Use this exact finalization boundary, with `DIRECT_MAP_MAX_ATTEMPTS = 2` so invalid initial output receives exactly one correction attempt:

```ts
function installAuthorizedReferences(
  candidate: unknown,
  selection: DirectMapReferenceSelection,
): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return {
    ...(candidate as Record<string, unknown>),
    references: selection.references,
    styleReference: selection.styleReference,
    generation: {
      provider: 'pixellab', operation: 'create_image_pro', noBackground: false,
      seed: readNullableSeed(candidate),
    },
  };
}
```

Do not pass the approved description through any prompt builder after validation. Keep one correction retry with complete V3 issues.

- [ ] **Step 4: Route V2 and V3 explicitly**

Extend the plan request body with:

```ts
schemaVersion: z.union([z.literal(2), z.literal(3)]).default(3),
referenceIds: z.array(z.string().uuid()).max(4).default([]),
styleReferenceId: z.string().uuid().nullable().default(null),
referenceRoles: z.record(z.string().uuid(), z.enum(['content', 'layout'])).default({}),
referenceUsage: z.record(z.string().uuid(), z.string().trim().min(1).max(240)).default({}),
styleCopy: z.array(z.enum(['color_palette', 'outline', 'detail', 'shading'])).max(4).default([]),
```

Refine this body so `referenceRoles` and `referenceUsage` contain exactly the keys in `referenceIds`, a selected style reference has `1..4` unique `styleCopy` values, no-style requests have an empty `styleCopy`, and the style ID cannot duplicate a content/layout ID.

When `schemaVersion = 3`, require `projectId` if any reference is selected, load every registry row through the authenticated client, verify exact project ownership and count, and call `createMapPlanV3`. When `schemaVersion = 2`, reject reference fields and retain `createMapPlanV2` for compatibility. Keep the legacy browser method `createPlan(...)` but make it send `schemaVersion: 2` explicitly so the current V2 workbench remains operational until Task 9 moves it behind read-only routing.

- [ ] **Step 5: Add and verify `createPlanV3` browser parsing**

The browser method POSTs `schemaVersion: 3`, parses `MapPlanV3Schema`, and returns the existing nullable source token plus the plan. It must not trim or rewrite `plan.description`.

Run: `npx jest --runInBand tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-plan-route.test.ts tests/unit/create-map/create-map-service.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit planner and API**

```bash
git add src/lib/server/createMapPlanner.ts src/app/api/create-map/plan/route.ts src/features/create-map/services/createMapService.ts tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-plan-route.test.ts tests/unit/create-map/create-map-service.test.ts
git commit -m "feat: plan direct maps with deepseek"
```

---

### Task 5: Add Exact PixelLab Pro Capability And Reference Mapping

**Files:**
- Create: `supabase/functions/pixellab-map/direct-map.ts`
- Create: `supabase/functions/pixellab-map/direct-map.test.ts`
- Modify: `supabase/functions/pixellab-map/types.ts`
- Modify: `supabase/functions/pixellab-map/pixellab-client.ts`
- Modify: `supabase/functions/pixellab-map/pixellab-client.test.ts`
- Modify: `supabase/functions/pixellab-map/auth.ts`
- Modify: `supabase/functions/pixellab-map/auth.test.ts`

**Interfaces:**
- Produces semantic capability `direct_map_image`, the extended `DiscoveredCapability` poll fields, `DirectMapProviderAsset`, `ResolvedDirectMapReferences`, `directMapProviderArguments(capability, asset, references)`, `resolveDirectMapReferences(authorized)`, and `assertStoredDirectMapCapability(asset, capability)`.
- Consumers: V3 submit and validate handlers.

- [ ] **Step 1: Write failing live-schema mapping tests**

```ts
import { assertEquals } from '@std/assert';
import { PixelLabClient } from './pixellab-client.ts';
import type { DiscoveredCapability } from './types.ts';
import { directMapProviderArguments } from './direct-map.ts';

const PRO_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' }, width: { type: 'integer' }, height: { type: 'integer' },
    no_background: { type: 'boolean' }, seed: { type: 'integer' },
    reference_images: { type: 'string' }, style_image_url: { type: 'string' },
    style_copy: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'width', 'height', 'no_background'],
  additionalProperties: false,
};
const GET_IMAGE_SCHEMA = {
  type: 'object', properties: { job_id: { type: 'string' } },
  required: ['job_id'], additionalProperties: false,
};
const PRO_CAPABILITY: DiscoveredCapability = {
  semantic: 'direct_map_image', transport: 'mcp', operation: 'create_image_pro',
  schemaFingerprint: 'a'.repeat(64), inputSchema: PRO_SCHEMA,
  pollOperation: 'get_image', pollSchemaFingerprint: 'b'.repeat(64), pollInputSchema: GET_IMAGE_SCHEMA,
};

function clientWithTools(tools: unknown[]) {
  return new PixelLabClient('private-token', async () => new Response(
    `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools } })}\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  ));
}

Deno.test('discovers only create_image_pro for direct maps', async () => {
  const client = clientWithTools([
    { name: 'create_image_pixen' },
    { name: 'create_image_pro', inputSchema: PRO_SCHEMA },
    { name: 'get_image', inputSchema: GET_IMAGE_SCHEMA },
  ]);
  const capability = await client.discover('direct_map_image');
  assertEquals(capability.operation, 'create_image_pro');
  assertEquals(capability.pollOperation, 'get_image');
  assertEquals(capability.pollInputSchema, GET_IMAGE_SCHEMA);
});

Deno.test('maps the approved prompt and private references exactly', () => {
  const args = directMapProviderArguments(PRO_CAPABILITY, {
    prompt: 'Exact final prompt.  Keep spacing.',
    generationParams: { width: 512, height: 512, noBackground: false, seed: 7 },
  }, {
    references: [{ url: 'https://signed.example/layout.png', usage: 'layout reference' }],
    style: { url: 'https://signed.example/style.png', copy: ['color_palette', 'shading'] },
  });
  assertEquals(args, {
    description: 'Exact final prompt.  Keep spacing.', width: 512, height: 512,
    no_background: false, seed: 7,
    reference_images: JSON.stringify([{ url: 'https://signed.example/layout.png', usage: 'layout reference' }]),
    style_image_url: 'https://signed.example/style.png', style_copy: ['color_palette', 'shading'],
  });
});
```

Add discovery tests that reject a missing/incompatible `get_image` tool or a poll schema without `job_id`. Add authorization tests that reject a missing reference row, another Project's row, a hash mismatch, duplicate IDs, and more than four content references. Assert returned signed URLs never appear in the authorized asset record.

- [ ] **Step 2: Run Edge tests and confirm failure**

Run: `npx -y deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/direct-map.test.ts supabase/functions/pixellab-map/pixellab-client.test.ts supabase/functions/pixellab-map/auth.test.ts`

Expected: FAIL for missing direct-map capability and module.

- [ ] **Step 3: Add the capability without fallback**

```ts
export type SemanticCapability =
  | 'topdown_tileset' | 'path_tiles' | 'map_object' | 'inpaint' | 'direct_map_image';

direct_map_image: {
  preferred: 'create_image_pro',
  requiredTerms: ['create', 'image', 'pro'],
},
```

Do not add `alternatives` or `restFallback`. Extend `DiscoveredCapability` with `pollOperation`, `pollSchemaFingerprint`, and `pollInputSchema` for this semantic capability. Discovery succeeds only when the same live tool list contains compatible `create_image_pro` and `get_image` schemas; `get_image` must accept `job_id`. In `pollJob`, use the discovered `pollOperation` and `job_id` rather than a fallback name.

- [ ] **Step 4: Implement strict reference resolution and argument mapping**

`resolveDirectMapReferences(authorized: AuthorizedAsset): Promise<ResolvedDirectMapReferences>` must parse the immutable V3 generation params, query `map_reference_images` through `authorized.serviceClient` by all recorded IDs, verify `authorized.projectId`, hash, dimensions, and storage path, and create 300-second signed URLs. It returns URLs only in memory:

```ts
export type ResolvedDirectMapReferences = {
  references: Array<{ url: string; usage: string }>;
  style: null | { url: string; copy: string[] };
};

export function assertStoredDirectMapCapability(
  asset: Record<string, unknown>,
  capability: DiscoveredCapability,
): void {
  const metadata = record(asset.metadata);
  if (
    asset.provider_operation !== capability.operation
    || metadata.schemaFingerprint !== capability.schemaFingerprint
    || metadata.pollOperation !== capability.pollOperation
    || metadata.pollSchemaFingerprint !== capability.pollSchemaFingerprint
  ) {
    throw new PixelLabMapError(
      'pixellab_capability_missing',
      'Stored PixelLab capability no longer matches live schemas',
      409,
    );
  }
}
```

`directMapProviderArguments(capability: DiscoveredCapability, asset: DirectMapProviderAsset, references: ResolvedDirectMapReferences): Record<string, unknown>` must require the live schema fields `description`, `width`, `height`, and `no_background`; reject missing/incompatible fields with `pixellab_capability_missing`; verify one of the three supported profiles; set `no_background: false`; JSON-encode `reference_images`; and omit null seed/reference/style fields. `DirectMapProviderAsset` is exactly `{ prompt: string; generationParams: Record<string, unknown> }`. The mapper must never modify `asset.prompt`.

Extend `assertGenerationIdentity` to enforce the exact `mapId`, `revisionId`, and non-null `generationId` tuple for both schema 2 and schema 3. Keep V1 compatibility unchanged. A V3 request with any stale identity must fail before capability discovery, reference signing, or provider submission.

- [ ] **Step 5: Run all PixelLab client/auth tests**

Run: `npx -y deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/direct-map.test.ts supabase/functions/pixellab-map/pixellab-client.test.ts supabase/functions/pixellab-map/auth.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit capability mapping**

```bash
git add supabase/functions/pixellab-map/direct-map.ts supabase/functions/pixellab-map/direct-map.test.ts supabase/functions/pixellab-map/types.ts supabase/functions/pixellab-map/pixellab-client.ts supabase/functions/pixellab-map/pixellab-client.test.ts supabase/functions/pixellab-map/auth.ts supabase/functions/pixellab-map/auth.test.ts
git commit -m "feat: map direct images to pixellab pro"
```

---

### Task 6: Submit, Validate, And Store One Complete Map Image

**Files:**
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-map/types.ts`
- Modify: `supabase/functions/pixellab-map/png.ts`
- Modify: `supabase/functions/pixellab-map/png.test.ts`
- Modify: `supabase/functions/pixellab-map/storage.ts`
- Modify: `supabase/functions/pixellab-map/storage.test.ts`
- Create: `supabase/functions/pixellab-map/direct-map-lifecycle.test.ts`

**Interfaces:**
- Produces V3 Edge operations `submit`, `poll`, `validate`, and `retry` for `map_image`.
- Consumes exact argument/reference mapping from Task 5 and existing storage transition RPC.

- [ ] **Step 1: Write failing lifecycle and PNG tests**

```ts
Deno.test('requires an exact opaque 512x512 direct map', async () => {
  const png = await validatePng(opaqueFixture(512, 512), pngExpectationForAsset('map_image', { width: 512, height: 512 }));
  assertEquals(png.hasTransparency, false);
  await assertRejects(
    () => validatePng(transparentFixture(512, 512), pngExpectationForAsset('map_image', { width: 512, height: 512 })),
    PixelLabMapError,
    'fully opaque',
  );
});

Deno.test('poll reports completed before a separate validate stores bytes', async () => {
  const harness = directMapHarness({ providerStatus: 'completed', image: opaqueFixture(512, 512) });
  assertEquals(await harness.call('poll'), { assetId: harness.assetId, status: 'completed' });
  assertEquals(harness.transitions.some((entry) => entry.next === 'ready'), false);
  const validated = await harness.call('validate');
  assertEquals(validated.status, 'ready');
  assertEquals(harness.transitions.at(-1)?.next, 'ready');
});
```

Add tests for wrong dimensions, blank image, provider base64/HTTPS result, deterministic first candidate, storage read-back mismatch, stale generation identity, validation called before provider completion, and sanitized error responses.

- [ ] **Step 2: Run focused Edge tests and confirm failure**

Run: `npx -y deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/png.test.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-map/direct-map-lifecycle.test.ts`

Expected: FAIL because `map_image` and `validate` are unsupported.

- [ ] **Step 3: Add exact opaque-map validation**

Extend `pngExpectationForAsset` to accept `map_image` and return:

```ts
if (kind === 'map_image') {
  return {
    width: typeof params.width === 'number' ? params.width : undefined,
    height: typeof params.height === 'number' ? params.height : undefined,
    alpha: 'forbidden',
  };
}
```

Keep existing signature, byte-size, nonblank, color-variation, hash, upload, and read-back checks.

- [ ] **Step 4: Implement V3 Edge branches**

Add `validate` to `PixelLabMapRequest`. For an authorized `map_image` on schema 3:

```ts
if (operation === 'submit' || operation === 'retry') {
  const capability = await client.discover('direct_map_image');
  const resolved = await resolveDirectMapReferences(authorized);
  const args = directMapProviderArguments(capability, {
    prompt: String(authorized.asset.prompt),
    generationParams: record(authorized.asset.generation_params),
  }, resolved);
  // planned|failed|retryable blocked -> queued -> provider call -> generating
}

if (operation === 'poll') {
  const capability = await client.discover('direct_map_image');
  assertStoredDirectMapCapability(authorized.asset, capability);
  const result = await client.pollJob(capability, jobId);
  const status = providerStatus(result);
  if (status === 'completed') return jsonResponse({ assetId, status: 'completed' });
  if (status === 'failed') transition generating -> failed;
  return jsonResponse({ assetId, status });
}

if (operation === 'validate') {
  const capability = await client.discover('direct_map_image');
  assertStoredDirectMapCapability(authorized.asset, capability);
  const result = await client.pollJob(capability, jobId);
  if (providerStatus(result) !== 'completed') {
    throw new PixelLabMapError('pixellab_invalid_response', 'Direct map is not ready for validation', 409);
  }
  const png = await validatePng(
    await client.downloadResult(result),
    pngExpectationForAsset('map_image', record(authorized.asset.generation_params)),
  );
  const ready = await persistValidatedAsset(context, {
    id: assetId, assetKey: 'map-image', expectedStatus: 'generating',
    metadata: {
      schemaFingerprint: capability.schemaFingerprint,
      pollOperation: capability.pollOperation,
      pollSchemaFingerprint: capability.pollSchemaFingerprint,
      candidateIndex: 0,
    },
  }, png);
  return jsonResponse({ assetId, status: 'ready', ready });
}
```

Legacy V1/V2 paths must retain their current submit/poll/composition behavior. Do not call atlas normalization, background composition, or content-quality obstacle checks for `map_image`.

Capability discovery, reference resolution, and argument validation occur before `submitAsset`. Map missing/incompatible capability to durable `blocked` with `pixellab_capability_missing`; map quota, rate-limit, transient upstream, provider rejection, and validation failures to bounded existing error codes without persisting arguments, signed URLs, raw provider bodies, base64 data, or credentials. Select candidate index `0` from a multi-candidate result and persist only that index.

On successful submit, persist `provider_operation = 'create_image_pro'`, `provider_job_id`, creation schema fingerprint, `pollOperation = 'get_image'`, and poll schema fingerprint in sanitized metadata before returning `generating`. Poll and validate must require those stored identities to match newly discovered compatible capabilities; a mismatch blocks further provider calls without changing the approved prompt or losing the provider job ID.

- [ ] **Step 5: Run the complete PixelLab Edge suite**

Run: `npx -y deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map`

Expected: PASS with zero failures.

- [ ] **Step 6: Commit direct image lifecycle**

```bash
git add supabase/functions/pixellab-map/index.ts supabase/functions/pixellab-map/types.ts supabase/functions/pixellab-map/png.ts supabase/functions/pixellab-map/png.test.ts supabase/functions/pixellab-map/storage.ts supabase/functions/pixellab-map/storage.test.ts supabase/functions/pixellab-map/direct-map-lifecycle.test.ts
git commit -m "feat: validate complete pixellab maps"
```

---

### Task 7: Add V3 Browser Persistence And Restore APIs

**Files:**
- Modify: `src/features/create-map/services/createMapService.ts`
- Modify: `src/features/create-map/hooks/useMapDraft.ts`
- Modify: `src/features/create-map/hooks/useSavedMaps.ts`
- Modify: `tests/unit/create-map/create-map-service.test.ts`
- Modify: `tests/unit/create-map/map-draft-autosave.test.ts`
- Create: `tests/unit/create-map/direct-map-restore.test.ts`

**Interfaces:**
- Produces `SavedMapWorkspaceV3`, V3 create/save/publish/load/list methods, schema-version summaries, and a V3-capable draft hook.
- Consumers: direct generation hook and workbench router.

- [ ] **Step 1: Write failing V3 service and restore tests**

```ts
it('creates one V3 project with an empty V3 Scene', async () => {
  const plan = makeValidMapPlanV3();
  const scene = createEmptyMapSceneV3(plan);
  await createMapService({ rpc } as never).createProjectV3('project-1', plan, scene, null);
  expect(rpc).toHaveBeenCalledWith('create_map_project_v3', expect.objectContaining({
    p_project_id: 'project-1', p_plan: plan, p_scene: scene,
  }));
});

it('loads only the exact ready map_image bound to the V3 Scene', async () => {
  const loaded = await service.loadSavedMapV3('map-v3');
  expect(loaded).toMatchObject({
    plan: { schemaVersion: 3 }, scene: { schemaVersion: 3 },
    imageAsset: { kind: 'map_image', asset_key: 'map-image', status: 'ready' },
  });
});

it('includes schema version in saved-map summaries', async () => {
  await expect(service.listSavedMaps()).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'map-v3', schemaVersion: 3 }),
    expect.objectContaining({ id: 'map-v2', schemaVersion: 2 }),
  ]));
});
```

- [ ] **Step 2: Run service/draft tests and confirm failure**

Run: `npx jest --runInBand tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/map-draft-autosave.test.ts tests/unit/create-map/direct-map-restore.test.ts`

Expected: FAIL for missing V3 methods/types.

- [ ] **Step 3: Implement strict V3 parsing and RPC methods**

Add `MapRevisionRowV3`, `SavedMapWorkspaceV3`, and `kind: 'map_image'` to `MapAssetRecord`. Implement:

```ts
createProjectV3(projectId, plan, scene, sourceToken)
saveDraftV3(identity, plan, scene)
publishV3(identity)
createAssetPlanV3(revisionId, generationId, planFingerprint)
loadSavedMapV3(mapId)
```

Every load parses `MapPlanV3Schema`, `MapSceneV3Schema`, and `validateMapSceneV3`. When `scene.mapImage` is null, `loadSavedMapV3` returns `imageAsset: null` so a new or not-yet-generated draft remains restorable. When the binding is non-null, it follows `scene.mapImage.sourceRevisionId`, loads exactly one `map_image`, and rejects missing, non-ready, wrong-dimension, wrong-revision, or hashless bindings. It signs only the final ready map image.

Change `SavedMapSummary` to include `schemaVersion: 2 | 3`; list current revision schema in the same bounded query. Do not list V1.

- [ ] **Step 4: Generalize draft serialization without merging schemas**

Make `useMapDraft` generic over the V2 or V3 plan/scene pair and inject operations:

```ts
type MapDraftAdapter<P, S> = {
  validate(plan: P, scene: S): boolean;
  create(projectId: string, source: MapSourceToken | null, plan: P, scene: S): Promise<MapDraftIdentity>;
  save(identity: MapDraftIdentity, plan: P, scene: S): Promise<MapDraftIdentity>;
  publish(identity: MapDraftIdentity): Promise<{ publishedRevisionId: string; nextDraftRevisionId: string }>;
};
```

Preserve serialized saves, dirty fingerprints, stale completion invalidation, and CAS conflict behavior. Instantiate the current adapter for V2 and a new V3 adapter rather than branching on schema inside each save operation.

- [ ] **Step 5: Run browser persistence tests and typecheck**

Run: `npx jest --runInBand tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/map-draft-autosave.test.ts tests/unit/create-map/direct-map-restore.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit browser persistence**

```bash
git add src/features/create-map/services/createMapService.ts src/features/create-map/hooks/useMapDraft.ts src/features/create-map/hooks/useSavedMaps.ts tests/unit/create-map/create-map-service.test.ts tests/unit/create-map/map-draft-autosave.test.ts tests/unit/create-map/direct-map-restore.test.ts
git commit -m "feat: restore direct map workspaces"
```

---

### Task 8: Implement The One-Asset Direct Generation Hook

**Files:**
- Create: `src/features/create-map/hooks/useDirectMapGeneration.ts`
- Create: `tests/unit/create-map/direct-map-generation.test.ts`
- Create: `tests/unit/create-map/direct-map-generation-monitor.test.ts`

**Interfaces:**
- Produces `DirectMapGenerationPhase`, `DirectMapGenerationAsset`, `DirectMapGenerationTarget`, `directMapPhaseFor`, `materializeDirectMapScene`, `prepareDirectMapRestore`, `directMapTargetMatches`, `canRetryDirectMap`, and `useDirectMapGeneration`.
- Consumes V3 service methods, V3 plan/scene schemas, and existing fingerprint/cancellation patterns.

- [ ] **Step 1: Write failing pure lifecycle tests**

```ts
it.each([
  ['planned', 'awaiting-confirmation'],
  ['queued', 'generating'],
  ['generating', 'generating'],
  ['ready', 'ready'],
  ['failed', 'failed'],
  ['blocked', 'blocked'],
] as const)('maps %s to %s', (status, phase) => {
  expect(directMapPhaseFor(asset(status))).toBe(phase);
});

it('allows retry only for failed assets and retryable blocked codes', () => {
  expect(canRetryDirectMap(asset('failed'))).toBe(true);
  expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_rate_limited' }))).toBe(true);
  expect(canRetryDirectMap(asset('blocked', { lastErrorCode: 'pixellab_capability_missing' }))).toBe(false);
});

it('materializes only an exact ready opaque map image', () => {
  const next = materializeDirectMapScene(plan, emptyScene, target, asset('ready', {
    storagePath: 'private/map.png', sha256: 'a'.repeat(64), width: 512, height: 512, hasTransparency: false,
  }));
  expect(next?.mapImage).toEqual({
    assetKey: 'map-image', sourceRevisionId: target.revisionId, width: 512, height: 512, locked: true,
  });
});

it('rejects stale targets across map, revision, generation, and fingerprint', () => {
  expect(directMapTargetMatches(target, { ...target })).toBe(true);
  expect(directMapTargetMatches(target, { ...target, generationId: 'stale' })).toBe(false);
});
```

The monitor test must assert `poll -> completed -> validating -> validate -> refresh`, one poll timer per semantic target, resume after remount, and no stale error/image installation.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-generation.test.ts tests/unit/create-map/direct-map-generation-monitor.test.ts`

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement preparation and confirmation**

Use these public phases:

```ts
export type DirectMapGenerationPhase =
  | 'idle' | 'preparing' | 'awaiting-confirmation' | 'submitting'
  | 'generating' | 'validating' | 'ready' | 'failed' | 'blocked';
```

`DirectMapGenerationAsset` must include durable `status`, nullable bounded `lastErrorCode`, provider operation/job identity, generation ID/fingerprint, and ready image metadata. Define `RETRYABLE_DIRECT_MAP_BLOCKS` as the exact bounded quota/rate-limit/transient availability codes already emitted by the Edge layer; `canRetryDirectMap` returns true for `failed` or membership in that set and false for every other status/code.

`prepare()` validates the exact V3 Plan and clean saved draft, publishes through `publishV3`, generates a UUID and canonical Plan fingerprint, calls `createAssetPlanV3`, reads back one immutable `map_image`, and enters `awaiting-confirmation`. `confirm()` invokes Edge `submit` exactly once and refreshes the row.

- [ ] **Step 4: Implement monitoring, validation, restore, retry, and regenerate**

Poll only while the asset is `generating`. When Edge returns `completed`, set client phase to `validating`, call Edge `validate`, refresh, sign the stored image, verify the installed epoch/binding, and call `onSceneMaterialized` with a V3 Scene binding.

`retry()` is available for `failed` and for `blocked` only when `lastErrorCode` is in an explicit retryable set (quota/rate-limit/transient availability); capability/schema/reference/hash/authorization blocks remain non-retryable until the Plan or environment changes. `regenerate()` publishes the current saved V3 draft and creates a new generation revision; it never overwrites the prior ready asset. `prepareDirectMapRestore` accepts only a matching generation ID/fingerprint/revision and preserves durable ready state if signed URL creation fails.

- [ ] **Step 5: Run lifecycle tests and typecheck**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-generation.test.ts tests/unit/create-map/direct-map-generation-monitor.test.ts tests/unit/create-map/direct-map-restore.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit direct generation orchestration**

```bash
git add src/features/create-map/hooks/useDirectMapGeneration.ts tests/unit/create-map/direct-map-generation.test.ts tests/unit/create-map/direct-map-generation-monitor.test.ts
git commit -m "feat: orchestrate direct map generation"
```

---

### Task 9: Build The V3 Workbench And V2 Read-Only Router

**Files:**
- Create: `src/features/create-map/DirectMapWorkbench.tsx`
- Create: `src/features/create-map/LegacyCreateMapV2Workbench.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.tsx`
- Create: `src/features/create-map/components/DirectMapPlanInspector.tsx`
- Create: `src/features/create-map/components/DirectMapGenerationPanel.tsx`
- Create: `src/features/create-map/components/DirectMapCanvas.tsx`
- Create: `src/features/create-map/components/MapReferencePanel.tsx`
- Modify: `src/features/create-map/components/MapSourcePanel.tsx`
- Modify: `src/features/create-map/components/SavedMapsPanel.tsx`
- Modify: `src/features/create-map/CreateMapWorkbench.module.css`
- Create: `tests/unit/create-map/direct-map-plan-inspector.test.tsx`
- Create: `tests/unit/create-map/direct-map-generation-panel.test.tsx`
- Create: `tests/unit/create-map/direct-map-canvas.test.tsx`
- Modify: `tests/unit/create-map/workbench-wiring.test.tsx`
- Modify: `tests/unit/create-map/create-map-shell.test.ts`

**Interfaces:**
- Produces the default V3 Create Map experience and V2 read-only compatibility entry.
- Consumes Tasks 3, 4, 7, and 8.

- [ ] **Step 1: Write failing component contract tests**

```tsx
it('edits the exact final prompt and one supported size profile', () => {
  const onChange = jest.fn();
  render(<DirectMapPlanInspector plan={makeValidMapPlanV3()} issues={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('PixelLab description'), { target: { value: 'Exact replacement prompt' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'Exact replacement prompt' }));
  expect(screen.getByRole('option', { name: '512 × 512' })).toBeInTheDocument();
});

it('shows a single paid confirmation and direct-map lifecycle', () => {
  render(<DirectMapGenerationPanel phase="awaiting-confirmation" asset={plannedAsset} error={null} onConfirm={confirm} onRetry={retry} onRegenerate={regenerate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and generate map' }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/terrain|path|obstacle/i)).toBeNull();
});

it('renders only the exact ready stored image', () => {
  render(<DirectMapCanvas plan={plan} scene={readyScene} image={{ binding: 'revision:hash:url', signedUrl: '/signed-map.png' }} />);
  expect(screen.getByRole('img', { name: plan.name })).toHaveAttribute('src', '/signed-map.png');
});
```

Add tests for reference upload limits, style/content role selection, description character count, disabled generation while dirty/invalid, loading/error/empty states, stale image binding, and mobile drawers.

- [ ] **Step 2: Run component tests and confirm failure**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation-panel.test.tsx tests/unit/create-map/direct-map-canvas.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/create-map-shell.test.ts`

Expected: FAIL because V3 components are absent.

- [ ] **Step 3: Preserve V2 behind an explicit read-only component**

Move the current V2 implementation from `CreateMapWorkbench.tsx` to `LegacyCreateMapV2Workbench.tsx`. Add props:

```ts
type LegacyCreateMapV2WorkbenchProps = {
  initialMapId: string;
  readOnly: true;
  onBack: () => void;
};
```

Auto-open `initialMapId`; disable Plan/Scene commands, save, prepare, confirm, retry, and regional generation; retain canvas, layers, signed images, and error/restore behavior. Re-export existing pure helpers from `CreateMapWorkbench.tsx` until old tests are migrated.

- [ ] **Step 4: Implement focused V3 controls**

`MapSourcePanel` accepts a `versionLabel` prop and displays V3 by default. `DirectMapPlanInspector` uses a profile select rather than free width/height fields, an exact 2,000-character textarea, and nullable numeric seed. `MapReferencePanel` allows at most four content/layout selections and one style selection; it strips preview URLs before emitting Plan values.

`DirectMapGenerationPanel` shows exactly one asset and the phase labels from Task 8. Use existing Ant Design icons and button styles. `DirectMapCanvas` uses a stable aspect-ratio container derived from Plan dimensions, `object-fit: contain`, and binding-key load invalidation; it has no schematic regions, paths, obstacle tools, or nested cards.

- [ ] **Step 5: Orchestrate the V3 workbench and router**

`DirectMapWorkbench` owns source selection, authorized references, Plan editor state, generic V3 draft adapter, direct generation hook, signed-image binding, and V3 saved-map restore. New Plan creation calls `createPlanV3`. Saving and generation require a Project; description-only planning does not.

The shell router is explicit:

```tsx
export function CreateMapWorkbench() {
  const [legacyMapId, setLegacyMapId] = useState<string | null>(null);
  return legacyMapId
    ? <LegacyCreateMapV2Workbench initialMapId={legacyMapId} readOnly onBack={() => setLegacyMapId(null)} />
    : <DirectMapWorkbench onOpenLegacyMap={setLegacyMapId} />;
}
```

Saved maps display a restrained `V2` or `V3` tag. Opening V3 installs its Plan, Scene, generation target, and image atomically. Opening V2 switches to the read-only component. No V2 generation control remains enabled.

- [ ] **Step 6: Run UI tests, lint, and typecheck**

Run: `npx jest --runInBand tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation-panel.test.tsx tests/unit/create-map/direct-map-canvas.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/create-map-shell.test.ts && npx eslint src/features/create-map && npm run typecheck`

Expected: PASS with zero ESLint errors.

- [ ] **Step 7: Commit the workbench**

```bash
git add src/features/create-map/DirectMapWorkbench.tsx src/features/create-map/LegacyCreateMapV2Workbench.tsx src/features/create-map/CreateMapWorkbench.tsx src/features/create-map/components/DirectMapPlanInspector.tsx src/features/create-map/components/DirectMapGenerationPanel.tsx src/features/create-map/components/DirectMapCanvas.tsx src/features/create-map/components/MapReferencePanel.tsx src/features/create-map/components/MapSourcePanel.tsx src/features/create-map/components/SavedMapsPanel.tsx src/features/create-map/CreateMapWorkbench.module.css tests/unit/create-map/direct-map-plan-inspector.test.tsx tests/unit/create-map/direct-map-generation-panel.test.tsx tests/unit/create-map/direct-map-canvas.test.tsx tests/unit/create-map/workbench-wiring.test.tsx tests/unit/create-map/create-map-shell.test.ts
git commit -m "feat: build direct map v3 workbench"
```

---

### Task 10: Add Browser Workflow And Paid Acceptance Evidence

**Files:**
- Create: `tests/e2e/specs/create-map-v3.spec.ts`
- Create: `scripts/accept-create-map-v3-paid.ts`
- Create: `scripts/accept-create-map-v3-browser.ts`
- Modify: `scripts/probe-pixellab-map.ts`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-11-create-map-direct-image-generation-design.md`

**Interfaces:**
- Produces mocked browser evidence, live capability evidence, paid generation evidence, and restored-browser evidence.
- Consumes the complete V3 workflow.

- [ ] **Step 1: Write the mocked Playwright workflow**

Implement a V3 mock backend that asserts:

```ts
expect(planRequest.schemaVersion).toBe(3);
expect(createAssetRpc).toEqual({
  name: 'create_map_asset_plan_v3',
  args: expect.objectContaining({ p_revision_id: expect.any(String), p_generation_id: expect.any(String) }),
});
expect(edgeBodies.map((body) => body.operation)).toEqual(['submit', 'poll', 'validate']);
```

Cover these workflows in Chromium:

- description-only Plan with no Project or Document;
- optional Document plus uploaded content/style references;
- exact prompt edit, save, paid confirmation, generating, validating, ready image;
- technical validation failure and retry;
- regenerate preserving the prior ready revision;
- save/refresh/restore and stale-open protection;
- V2 saved map opening read-only;
- stable desktop and mobile layouts with nonblank screenshots and no page errors.

- [ ] **Step 2: Run Playwright before final wiring and confirm failures**

Run: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon npx playwright test tests/e2e/specs/create-map-v3.spec.ts --workers=1`

Expected: FAIL until all V3 route/RPC/Edge/browser intercepts match.

- [ ] **Step 3: Update the live capability probe**

Replace the map-object-centered required list with a V3 direct-map requirement while retaining V2 discovery as informational:

```ts
const REQUIRED_V3 = [
  { semantic: 'direct_map_image', operation: 'create_image_pro', pollOperation: 'get_image' },
] as const;
```

The probe prints sanitized schema fingerprints only. Generation evidence requires an authoritative V3 revision ID and one ready `map_image` whose operation is `create_image_pro`, dimensions match Plan, transparency is false, hash is valid, and metadata contains no URL/credential/base64/provider body.

- [ ] **Step 4: Implement paid and browser acceptance scripts**

`accept-create-map-v3-paid.ts` must use an authenticated editor and the public V3 RPC/Edge path, not direct PixelLab generation. It creates or resumes an approved V3 revision, confirms one paid request, polls, calls `validate`, and asserts private read-back metadata. It never chooses an arbitrary revision through service role.

`accept-create-map-v3-browser.ts` opens the resulting saved map, verifies `data-schema-version="3"`, `All changes saved`, `Map ready`, exact image natural dimensions, nonblank screenshot channel deviation, zero page errors, and no failed document/script/fetch requests.

Add scripts:

```json
{
  "test:create-map-v3": "jest --runInBand tests/unit/create-map tests/unit/database/create-map-v3-migration.test.ts",
  "test:e2e:create-map-v3": "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon playwright test tests/e2e/specs/create-map-v3.spec.ts --workers=1",
  "accept:create-map-v3:paid": "tsx scripts/accept-create-map-v3-paid.ts",
  "accept:create-map-v3:browser": "tsx scripts/accept-create-map-v3-browser.ts"
}
```

- [ ] **Step 5: Run mocked browser evidence**

Run: `npm run test:e2e:create-map-v3`

Expected: all V3 workflows PASS with desktop/mobile screenshots created under `test-results/`.

- [ ] **Step 6: Run live acceptance only with explicit credentials and revision identity**

Run capability discovery without a paid request:

```bash
PIXELLAB_PROBE_GENERATE=0 PIXELLAB_PROBE_VERIFY_GENERATION=0 npm run probe:pixellab-map
```

Expected: `direct_map_image/create_image_pro` and `get_image` are present with sanitized fingerprints.

Then, only after confirming the configured development account and approved V3 revision:

```bash
npm run accept:create-map-v3:paid
npm run accept:create-map-v3:browser
```

Expected: one ready opaque `map_image`, verified private bytes/hash, visible restored browser image, and no durable sensitive values. If credentials or the authoritative revision are absent, record the acceptance as blocked rather than bypassing Keco provenance.

- [ ] **Step 7: Update the design verification record and commit evidence tooling**

Record exact fresh test counts, live schema fingerprints, output dimensions, hash prefix, screenshot paths, and any remaining blocker. Do not claim live completion if only mocks passed.

```bash
git add tests/e2e/specs/create-map-v3.spec.ts scripts/accept-create-map-v3-paid.ts scripts/accept-create-map-v3-browser.ts scripts/probe-pixellab-map.ts package.json package-lock.json docs/superpowers/specs/2026-08-11-create-map-direct-image-generation-design.md
git commit -m "test: verify direct map v3 workflow"
```

---

### Task 11: Run The Full Delivery Gate

**Files:**
- Modify only files required to fix failures caused by the V3 change.

**Interfaces:**
- Consumes all previous tasks.
- Produces final automated evidence; live evidence remains a separately reported gate.

- [ ] **Step 1: Run whitespace and changed-file inspection**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Classify pre-existing unrelated worktree changes and do not stage, revert, or include them.

- [ ] **Step 2: Run Create Map unit and Edge gates**

Run:

```bash
npm run test:create-map-v3
npx -y deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map
```

Expected: all suites PASS with zero failures.

- [ ] **Step 3: Run static application gates**

Run:

```bash
npm run typecheck
npm run typecheck:api
npx eslint src/features/create-map src/lib/server/createMapPlanner.ts src/lib/server/createMapReferenceService.ts src/app/api/create-map supabase/functions/pixellab-map tests/unit/create-map tests/e2e/specs/create-map-v3.spec.ts scripts/accept-create-map-v3-paid.ts scripts/accept-create-map-v3-browser.ts scripts/probe-pixellab-map.ts
npm run build
```

Expected: every command exits 0. Restore only build-generated metadata changes created by this verification if they were clean before the build.

- [ ] **Step 4: Run mocked browser gate and inspect screenshots**

Run: `npm run test:e2e:create-map-v3`

Expected: all workflows PASS. Inspect desktop and mobile screenshots for a nonblank map, correct aspect ratio, no text clipping, no incoherent overlap, and usable drawers.

- [ ] **Step 5: Report the exact delivery state**

Report automated test counts and commands from this run. Report live database RLS tests as skipped unless they actually ran. Report live paid PixelLab acceptance as blocked unless both paid and browser acceptance scripts completed against an authoritative V3 revision. Do not conflate mocked/browser success with live provider completion.
