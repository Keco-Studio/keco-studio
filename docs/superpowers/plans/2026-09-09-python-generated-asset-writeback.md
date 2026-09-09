# Python-Generated Asset MCP Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general MCP workflow that verifies images created by local Python processes, registers them in `project_game_assets`, and proves they appear in the existing project Assets aggregation.

**Architecture:** Keep image bytes outside MCP by reusing `prepare_image_uploads` and signed HTTP PUT. Add `complete_project_game_asset_uploads` to download and verify each prepared object, derive integrity metadata, then call one atomic authenticated SQL RPC that inserts or exactly reuses the registry row by `storage_path`. Existing table-image completion and provider-managed asset lifecycles remain unchanged.

**Tech Stack:** Supabase Edge Functions, TypeScript, Deno, Zod, `fast-png`, PostgreSQL RPC/RLS, Jest, MCP JSON-RPC, Python 3 standard library.

**Spec:** `docs/superpowers/specs/2026-09-09-python-generated-asset-writeback-design.md`

## Global Constraints

- Supported files remain PNG, JPEG, GIF, WebP, and safe static SVG, each between 1 byte and 5 MiB.
- Raw bytes and Base64 never enter MCP JSON; local paths, public URLs, and signed URLs are invalid completion inputs.
- `project_game_assets.storage_path` is the idempotency key; exact retries reuse one row and metadata conflicts never overwrite it.
- Only project owners and accepted `admin` or `editor` collaborators may register assets; viewers remain read-only.
- SHA-256 is always derived from stored bytes. Dimensions and transparency are nullable when the format cannot prove them safely.
- Signed upload URLs, upload headers, bearer tokens, and service-role credentials never appear in evidence or logs.
- Provider-managed `map_assets` and character/animation lifecycle records are outside this workflow.
- No application UI change is required; the existing Assets aggregation already reads `project_game_assets`.

---

### Task 1: Atomic Project Asset Registration RPC

**Files:**
- Create: `supabase/migrations/20260909150000_mcp_project_game_asset_registration.sql`
- Create: `tests/unit/database/project-game-assets-mcp-migration.test.ts`
- Create: `tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts`

**Interfaces:**
- Consumes: the existing `public.project_game_assets` table and current category taxonomy.
- Produces: `public.mcp_register_project_game_asset(p_project_id uuid, p_name text, p_category text, p_mime_type text, p_storage_path text, p_sha256 text, p_width integer, p_height integer, p_has_transparency boolean, p_file_size bigint)` returning one row plus `reused boolean`.

- [ ] **Step 1: Write failing migration contract and behavior tests**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260909150000_mcp_project_game_asset_registration.sql',
), 'utf8');

describe('MCP project game asset registration migration', () => {
  it('registers or exactly reuses one verified storage path', () => {
    expect(sql).toMatch(/function public\.mcp_register_project_game_asset/i);
    expect(sql).toMatch(/insert into public\.project_game_assets/i);
    expect(sql).toMatch(/on conflict \(storage_path\) do nothing/i);
    expect(sql).toMatch(/ASSET_REGISTRATION_CONFLICT/i);
    expect(sql).toMatch(/reused boolean/i);
  });

  it('binds path, actor, project, and writable role', () => {
    expect(sql).toMatch(/auth\.uid\(\) is null/i);
    expect(sql).toMatch(/auth\.uid\(\)::text \|\| '\/' \|\| p_project_id::text \|\| '\/%'/i);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/p_mime_type not in \('image\/png','image\/jpeg','image\/gif','image\/webp','image\/svg\+xml'\)/i);
    expect(sql).toMatch(/PROJECT_WRITE_FORBIDDEN/i);
  });

  it('exposes only the bounded RPC and narrows direct writes', () => {
    expect(sql).toMatch(/security definer[\s\S]*set search_path = ''/i);
    expect(sql).toMatch(/revoke all on function public\.mcp_register_project_game_asset[\s\S]*from public, anon, service_role/i);
    expect(sql).toMatch(/grant execute on function public\.mcp_register_project_game_asset[\s\S]*to authenticated/i);
    expect(sql).toMatch(/project_game_assets_insert[\s\S]*created_by = \(select auth\.uid\(\)\)[\s\S]*role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/project_game_assets_update[\s\S]*for update using \([\s\S]*role in \('admin', 'editor'\)[\s\S]*with check \([\s\S]*role in \('admin', 'editor'\)/i);
  });
});
```

In the behavior test, use `buildProjectFixture` and the repository's
`RLS_DB_TESTS_ENABLED` gate. Add a `register(actor, path, overrides?)` helper
that calls the RPC with a complete 1x1 PNG metadata record. Assert these cases
against real Postgres:

```ts
it.each(['owner', 'admin', 'editor'] as const)('%s registers an asset', async role => {
  const path = `${fx[role].id}/${fx.projectId}/${role}-${fx.suffix}.png`;
  const result = await register(fx[role], path);
  expect(result.error).toBeNull();
  expect(result.data).toEqual([expect.objectContaining({
    project_id: fx.projectId,
    created_by: fx[role].id,
    storage_path: path,
    reused: false,
  })]);
});

it.each(['viewer', 'outsider'] as const)('rejects %s without a row', async role => {
  const path = `${fx[role].id}/${fx.projectId}/${role}-${fx.suffix}.png`;
  const result = await register(fx[role], path);
  expect(result.error?.code).toBe('KA401');
  expect((await fx.svc.from('project_game_assets').select('id').eq('storage_path', path)).data).toEqual([]);
});
```

Add one exact replay test that requires the same ID and `reused: true`, one
same-path/different-category test that requires `KA409` and an unchanged single
row, and one cross-project or mismatched-prefix test that requires no inserted
row. In `afterAll`, delete only rows whose name includes `fx.suffix`, then call
`teardownProjectFixture(fx)`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- --runInBand tests/unit/database/project-game-assets-mcp-migration.test.ts tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts`

Expected: FAIL because `20260909150000_mcp_project_game_asset_registration.sql`
and the RPC do not exist.

- [ ] **Step 3: Implement the migration and atomic RPC**

Create the migration with this exact behavioral shape:

```sql
create or replace function public.mcp_register_project_game_asset(
  p_project_id uuid,
  p_name text,
  p_category text,
  p_mime_type text,
  p_storage_path text,
  p_sha256 text,
  p_width integer,
  p_height integer,
  p_has_transparency boolean,
  p_file_size bigint
)
returns table (
  id uuid, project_id uuid, created_by uuid, name text, category text,
  status text, mime_type text, storage_path text, sha256 text,
  width integer, height integer, has_transparency boolean, file_size bigint,
  created_at timestamptz, updated_at timestamptz, reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.project_game_assets%rowtype;
  v_inserted boolean := false;
begin
  if v_actor is null or not (
    exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_actor)
    or exists (
      select 1 from public.project_collaborators collaborator
      where collaborator.project_id = p_project_id
        and collaborator.user_id = v_actor
        and collaborator.accepted_at is not null
        and collaborator.role in ('admin', 'editor')
    )
  ) then
    raise exception 'PROJECT_WRITE_FORBIDDEN' using errcode = 'KA401';
  end if;

  if p_storage_path not like v_actor::text || '/' || p_project_id::text || '/%'
     or char_length(btrim(p_name)) not between 1 and 255
     or p_category not in ('character','icon','ui','map','prop','vfx','spritesheet','media')
     or p_mime_type not in ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml')
     or p_sha256 !~ '^[a-f0-9]{64}$'
     or p_file_size not between 1 and 5242880
     or (p_width is not null and p_width <= 0)
     or (p_height is not null and p_height <= 0) then
    raise exception 'Invalid project asset metadata' using errcode = '22023';
  end if;

  insert into public.project_game_assets (
    project_id, created_by, name, category, status, mime_type, storage_path,
    sha256, width, height, has_transparency, file_size
  ) values (
    p_project_id, v_actor, p_name, p_category, 'ready', p_mime_type,
    p_storage_path, p_sha256, p_width, p_height, p_has_transparency, p_file_size
  )
  on conflict (storage_path) do nothing
  returning * into v_row;
  v_inserted := found;

  if not v_inserted then
    select * into v_row
    from public.project_game_assets asset
    where asset.storage_path = p_storage_path;
    if v_row.project_id is distinct from p_project_id
       or v_row.created_by is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.category is distinct from p_category
       or v_row.status is distinct from 'ready'
       or v_row.mime_type is distinct from p_mime_type
       or v_row.sha256 is distinct from p_sha256
       or v_row.width is distinct from p_width
       or v_row.height is distinct from p_height
       or v_row.has_transparency is distinct from p_has_transparency
       or v_row.file_size is distinct from p_file_size then
      raise exception 'ASSET_REGISTRATION_CONFLICT' using errcode = 'KA409';
    end if;
  end if;

  return query select
    v_row.id, v_row.project_id, v_row.created_by, v_row.name, v_row.category,
    v_row.status, v_row.mime_type, v_row.storage_path, v_row.sha256,
    v_row.width, v_row.height, v_row.has_transparency, v_row.file_size,
    v_row.created_at, v_row.updated_at, not v_inserted;
end;
$$;
```

In the same migration, replace `project_game_assets_insert` and
`project_game_assets_update` so owner access or an accepted collaborator row
with `role in ('admin', 'editor')` is required. The insert policy must also
require `created_by = auth.uid()`. The update policy must repeat the narrowed
authorization predicate in both `USING` and `WITH CHECK`, so an allowed actor
cannot move a row into another project or creator scope. Keep the existing read
policy. Revoke the RPC from `public`, `anon`, and `service_role`; grant it only
to `authenticated`.

- [ ] **Step 4: Run database contract and behavior tests**

Run: `npm run test:unit -- --runInBand tests/unit/database/project-game-assets-mcp-migration.test.ts tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts`

Expected: the migration contract passes; real Postgres cases pass when
`RLS_DB_TESTS_ENABLED` is enabled and are explicitly skipped otherwise.

- [ ] **Step 5: Commit the database contract**

```bash
git add supabase/migrations/20260909150000_mcp_project_game_asset_registration.sql tests/unit/database/project-game-assets-mcp-migration.test.ts tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts
git commit -m "feat: add atomic MCP game asset registration"
```

---

### Task 2: Byte-Derived Image Metadata Inspector

**Files:**
- Create: `supabase/functions/mcp/image-metadata.ts`
- Create: `supabase/functions/mcp/image-metadata.test.ts`
- Modify: `supabase/functions/mcp/deno.json`

**Interfaces:**
- Consumes: a validated MIME type and the exact downloaded `Uint8Array`.
- Produces: `inspectVerifiedImage(fileType: ImageFileType, bytes: Uint8Array): Promise<VerifiedImageMetadata>` where `VerifiedImageMetadata` is `{ sha256: string; width: number | null; height: number | null; hasTransparency: boolean | null }`.

- [ ] **Step 1: Write failing metadata tests with valid format fixtures**

Use `fast-png` encoding for PNG and these bounded header fixtures for the other
formats:

```ts
const jpeg1x1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);
const gif1x1 = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x00,
]);
const webp1x1 = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
  0x0a, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

Deno.test('inspects PNG dimensions, alpha, and SHA-256', async () => {
  const bytes = encode({ width: 2, height: 1, data: new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 0,
  ]), channels: 4, depth: 8 });
  const result = await inspectVerifiedImage('image/png', bytes);
  assertEquals(result.width, 2);
  assertEquals(result.height, 1);
  assertEquals(result.hasTransparency, true);
  assertMatch(result.sha256, /^[a-f0-9]{64}$/);
});

Deno.test('inspects JPEG, GIF, WebP, and SVG without executing content', async () => {
  assertEquals((await inspectVerifiedImage('image/jpeg', jpeg1x1)).width, 1);
  assertEquals((await inspectVerifiedImage('image/gif', gif1x1)).height, 1);
  assertEquals((await inspectVerifiedImage('image/webp', webp1x1)).width, 1);
  const svg = await inspectVerifiedImage(
    'image/svg+xml',
    new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 7"></svg>'),
  );
  assertEquals({ width: svg.width, height: svg.height, hasTransparency: svg.hasTransparency }, {
    width: 12,
    height: 7,
    hasTransparency: null,
  });
  assertMatch(svg.sha256, /^[a-f0-9]{64}$/);
});
```

Also test truncated headers, zero dimensions, SVG percentage dimensions with no
valid `viewBox`, and SHA stability for identical bytes.

- [ ] **Step 2: Run the metadata tests to verify they fail**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/image-metadata.test.ts`

Expected: FAIL because `image-metadata.ts` and the `fast-png` MCP import do not exist.

- [ ] **Step 3: Add the pure metadata inspector**

Add `"fast-png": "npm:fast-png@6.4.0"` to the MCP import map. Export these
exact types and entry point:

```ts
export type ImageFileType =
  | 'image/png' | 'image/jpeg' | 'image/gif'
  | 'image/webp' | 'image/svg+xml';

export type VerifiedImageMetadata = {
  sha256: string;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
};

export async function inspectVerifiedImage(
  fileType: ImageFileType,
  bytes: Uint8Array,
): Promise<VerifiedImageMetadata> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  const sha256 = Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')).join('');
  const dimensions = fileType === 'image/png' ? inspectPng(bytes)
    : fileType === 'image/jpeg' ? inspectJpeg(bytes)
    : fileType === 'image/gif' ? inspectGif(bytes)
    : fileType === 'image/webp' ? inspectWebp(bytes)
    : inspectSvg(bytes);
  return { sha256, ...dimensions };
}
```

Implement the format helpers with bounded reads:

- `inspectPng` decodes with `fast-png`, returns decoded width/height, and scans
  only the alpha channel when channels are 2 or 4.
- `inspectJpeg` walks length-prefixed markers until a valid SOF0/SOF1/SOF2
  marker and returns `hasTransparency: false`.
- `inspectGif` reads little-endian logical-screen dimensions and returns
  `hasTransparency: null`.
- `inspectWebp` handles VP8X, VP8, and VP8L dimension headers and returns the
  VP8X alpha flag when present, otherwise `null` except lossy VP8 is `false`.
- `inspectSvg` decodes at most the existing 5 MiB input, parses positive numeric
  width/height without units or with `px`, falls back to four positive `viewBox`
  numbers, and always returns `hasTransparency: null`.
- Invalid or unprovable dimensions return nulls; the inspector never turns a
  previously verified supported image into active content or follows links.

- [ ] **Step 4: Run metadata tests and MCP type checking**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/image-metadata.test.ts`

Expected: PASS for every format and malformed-header case.

Run: `npm run check:mcp`

Expected: exit 0.

- [ ] **Step 5: Commit the inspector**

```bash
git add supabase/functions/mcp/deno.json supabase/functions/mcp/image-metadata.ts supabase/functions/mcp/image-metadata.test.ts
git commit -m "feat: inspect verified MCP image metadata"
```

---

### Task 3: Registry-Aware MCP Completion Tool

**Files:**
- Modify: `supabase/functions/mcp/errors.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/image-tools.test.ts`

**Interfaces:**
- Consumes: Task 1 RPC and Task 2 `inspectVerifiedImage`.
- Produces: public MCP tool `complete_project_game_asset_uploads({ projectId, items })`
  on account connections and `complete_project_game_asset_uploads({ items })` on
  an already project-scoped connection, with ordered item results, exact retry
  reuse, and item-scoped errors.
- Produces: public MCP error code `ASSET_REGISTRATION_CONFLICT` in
  `MCP_ERROR_CODES` and its derived `McpErrorCode` type.

- [ ] **Step 1: Extend the MCP image test context for registration RPCs**

Change `imageContext` so its `rpc` mock records and handles
`mcp_register_project_game_asset`:

```ts
if (name === 'mcp_register_project_game_asset') {
  const input = arguments_[0] as Record<string, unknown>;
  return {
    data: [{
      id: '33333333-3333-4333-8333-333333333333',
      project_id: PROJECT_ID,
      created_by: 'user-1',
      name: input.p_name,
      category: input.p_category,
      status: 'ready',
      mime_type: input.p_mime_type,
      storage_path: input.p_storage_path,
      sha256: input.p_sha256,
      width: input.p_width,
      height: input.p_height,
      has_transparency: input.p_has_transparency,
      file_size: input.p_file_size,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
      reused: false,
    }],
    error: null,
  };
}
```

Replace the test's signature-only fake PNG with a valid encoded PNG for tests
that invoke metadata inspection.

- [ ] **Step 2: Write failing tool behavior tests**

Add tests proving:

```ts
Deno.test('complete_project_game_asset_uploads verifies and registers ordered items', async () => {
  const message = await callTool(context, 'complete_project_game_asset_uploads', {
    items: [
      { path: firstPath, category: 'map' },
      { path: secondPath },
    ],
  });
  const result = message.result?.structuredContent as {
    completedCount: number;
    failedCount: number;
    items: Array<{ index: number; asset: { category: string; sha256: string } }>;
  };
  assertEquals(result.completedCount, 2);
  assertEquals(result.failedCount, 0);
  assertEquals(result.items.map(item => item.index), [0, 1]);
  assertEquals(result.items.map(item => item.asset.category), ['map', 'media']);
  assertEquals(result.items.every(item => /^[a-f0-9]{64}$/.test(item.asset.sha256)), true);
});
```

Add separate tests for empty batches, invalid categories, duplicate-path schema
rejection, local paths, `file:` URIs, public URLs, signed URLs, missing-object
partial failure with `IMAGE_UPLOAD_NOT_FOUND`, `KA401 ->
PROJECT_WRITE_FORBIDDEN`, `KA409 ->
ASSET_REGISTRATION_CONFLICT`, exact `reused: true` propagation, Unicode file
name preservation, and absence of signed upload URLs/headers from results.
Import `MCP_ERROR_CODES` and assert it contains
`ASSET_REGISTRATION_CONFLICT`, so the public domain-error union cannot drift
from the RPC mapping.

- [ ] **Step 3: Run the focused tests to verify they fail**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/image-tools.test.ts --filter project_game_asset`

Expected: FAIL because the MCP tool is not registered.

- [ ] **Step 4: Refactor stored verification without changing generic completion**

Introduce an internal result while preserving the current public shape:

```ts
type VerifiedUpload = { image: VerifiedImage; bytes: Uint8Array };

async function verifyImageUpload(
  context: ProjectMcpRequestContext,
  path: string,
): Promise<VerifiedUpload> {
  // Move the current info/download/signature/SVG checks here.
  return { image: { url, path, fileName, fileSize, fileType, uploadedAt }, bytes: imageBytes };
}

async function completeImageUpload(
  context: ProjectMcpRequestContext,
  path: string,
): Promise<VerifiedImage> {
  return (await verifyImageUpload(context, path)).image;
}
```

Run the existing single and batch completion tests immediately after this
refactor to prove their response contract is byte-for-byte unchanged.

- [ ] **Step 5: Implement RPC error mapping and asset response normalization**

Add `ASSET_REGISTRATION_CONFLICT` to `MCP_ERROR_CODES` in `errors.ts`, then add
focused helpers:

```ts
async function registerProjectGameAsset(
  context: ProjectMcpRequestContext,
  image: VerifiedImage,
  bytes: Uint8Array,
  category: GameAssetCategory,
): Promise<{ reused: boolean; asset: ProjectGameAssetResult }> {
  const metadata = await inspectVerifiedImage(image.fileType, bytes);
  const { data, error } = await context.supabase.rpc('mcp_register_project_game_asset', {
    p_project_id: context.projectId,
    p_name: image.fileName,
    p_category: category,
    p_mime_type: image.fileType,
    p_storage_path: image.path,
    p_sha256: metadata.sha256,
    p_width: metadata.width,
    p_height: metadata.height,
    p_has_transparency: metadata.hasTransparency,
    p_file_size: image.fileSize,
  });
  if (error?.code === 'KA401' || error?.code === '42501') {
    throw new McpDomainError('PROJECT_WRITE_FORBIDDEN', 'Write access is not available for this project.');
  }
  if (error?.code === 'KA409' || error?.code === '23505') {
    throw new McpDomainError('ASSET_REGISTRATION_CONFLICT', 'The uploaded object is already registered with different metadata.');
  }
  if (error) throw new McpDomainError('INTERNAL_ERROR', 'The project asset could not be registered.');
  return normalizeRegisteredAsset(firstRow(data));
}
```

Do not include `url` from the database result; return the already verified
public image object separately.

- [ ] **Step 6: Register `complete_project_game_asset_uploads`**

Use a strict Zod schema with 1-20 items, the current eight category values,
default `media`, and a whole-request unique-path refinement. Define one shared
prepared-path schema that accepts exactly
`<user-uuid>/<project-uuid>/<upload-uuid>-<encoded-file-name>` with no extra
slash; this rejects absolute paths, backslashes, URL schemes, `file:` URIs,
public URLs, and signed URLs before item processing. Contextual user/project
equality remains enforced by `verifyImageUpload`. For each item, call
`verifyImageUpload`, `registerProjectGameAsset`, and return an ordered success
or sanitized item error. Convert oversized-item errors to
`FIELD_VALIDATION_FAILED`, matching `complete_image_uploads` semantics. Set
counts from discriminated item results and use the existing non-destructive
write annotations.

- [ ] **Step 7: Run all image tool tests and MCP type checking**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/image-tools.test.ts`

Expected: PASS with existing generic upload behavior and new registry behavior.

Run: `npm run check:mcp`

Expected: exit 0.

- [ ] **Step 8: Commit the MCP tool**

```bash
git add supabase/functions/mcp/errors.ts supabase/functions/mcp/write-tools.ts supabase/functions/mcp/image-tools.test.ts
git commit -m "feat: register completed images in project assets"
```

---

### Task 4: Advertise And Document The MCP Capability

**Files:**
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`
- Modify: `docs/mcp/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 3 public tool name and schema.
- Produces: consistent legacy/account capability lists, probe expectations, and a self-contained public protocol description.

- [ ] **Step 1: Write failing capability expectations**

Append `complete_project_game_asset_uploads` immediately after
`complete_image_uploads` in `PROJECT_WRITE_TOOL_NAMES`, `WRITE_TOOLS`, and all
expected probe arrays. In `server.test.ts`, assert that its description contains
`project Assets`, `image.path`, `PUT`, `reused`, and `partial failure`, and that
its annotations equal the other non-destructive image writes.

- [ ] **Step 2: Run capability tests to verify they fail**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/server.test.ts`

Expected: FAIL because the server write allowlist does not contain the new tool.

Run: `npm run test:unit -- --runInBand tests/unit/mcp/capabilities-probe.test.ts`

Expected: FAIL because capability counts and tool lists do not match.

- [ ] **Step 3: Update capability allowlists and probe sets**

Add the tool to `WRITE_TOOLS` in `server.ts`, `WRITE_TOOLS` and
`PROJECT_WRITE_TOOLS` derivation in `scripts/probe-mcp-capabilities.ts`, and the
test arrays. Update numeric count assertions from their computed new output;
do not hard-code a second independent tool list.

- [ ] **Step 4: Document the generated-image Assets flow**

Add a subsection after `## Image Uploads` in `docs/mcp/README.md` containing the
canonical sequence:

```text
Python/local generator -> prepare_image_uploads -> exact signed PUT
-> complete_project_game_asset_uploads -> Assets read-back
```

Document the current category enum, default `media`, exact-retry reuse,
item-scoped failure handling, and the distinction from
`complete_image_uploads` for ordinary Keco table image fields. State that MCP
never receives Python source, local paths, or bytes.

Add `accept:python-generated-asset-writeback` to `package.json` with command
`tsx scripts/accept-python-generated-asset-writeback.ts`.

- [ ] **Step 5: Run server, probe, and MCP checks**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/server.test.ts`

Expected: PASS.

Run: `npm run test:unit -- --runInBand tests/unit/mcp/capabilities-probe.test.ts`

Expected: PASS.

Run: `npm run check:mcp`

Expected: exit 0.

- [ ] **Step 6: Commit capability and documentation changes**

```bash
git add supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts scripts/probe-mcp-capabilities.ts tests/unit/mcp/capabilities-probe.test.ts docs/mcp/README.md package.json
git commit -m "docs: expose project asset completion workflow"
```

---

### Task 5: Route Host-Generated Images Through The Registry Flow

**Files:**
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `plugins/keco-codex/skills/keco-import-local-assets/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-import-local-assets/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-import-local-assets/agents/openai.yaml`
- Modify: `tests/fixtures/plugins/keco-local-image-import-skill-evals.json`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: Task 3 tool contract and Task 4 documented sequence.
- Produces: fresh-context routing for local files created by Python or other host scripts while retaining PixelLab/provider exclusions.
- Produces: a validated Codex plugin manifest with one refreshed cachebuster
  suffix; the installed cache is refreshed only through the supported local
  marketplace flow.

- [ ] **Step 1: Add a failing host-generated-image routing evaluation**

Add this positive case to the fixture:

```json
{
  "id": "python-generated-project-asset",
  "kind": "positive",
  "prompt": "Run my Python image generator and return every output to this project's Assets library.",
  "expectedSkill": "keco-import-local-assets",
  "requiredBehaviors": [
    "inventory-generated-output",
    "preview-and-confirm",
    "batch-prepare-put-register",
    "project-assets-read-back"
  ]
}
```

Update the plugin tests to expect this case and require the new tool name and
registry-aware sequence in both skill copies.

- [ ] **Step 2: Run plugin tests to verify they fail**

Run: `npm run test:unit -- --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL because the skill excludes every generated image and lacks the
new flow.

- [ ] **Step 3: Update and mirror the Skill contract**

Change the frontmatter description and Overview so images produced by a
host-side deterministic script are in scope. Keep these exclusions explicit:

```text
Provider-managed PixelLab map, character, and animation outputs stay in their
lifecycle-specific Skills and tables; do not re-register them as manual assets.
```

Split the workflow after PUT:

- Project Assets target: call `complete_project_game_asset_uploads`, then read
  the project asset aggregation and match path/name/hash/status.
- Ordinary Keco table target: retain `complete_image_uploads` followed by table
  row upsert and paginated table read-back.

The preview must identify which target is selected before mutation. Preserve
the existing confirmation, credential redaction, partial-failure, and recovery
rules. Update the Codex `default_prompt` to mention local or host-generated
images and project Assets. Update the plugin manifest's import example so the
feature is discoverable from the plugin entry point. Make the Claude `SKILL.md`
byte-identical to the Codex copy after editing.

- [ ] **Step 4: Run focused plugin tests**

Run: `npm run test:unit -- --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: PASS, including mirror equality and the new evaluation case.

- [ ] **Step 5: Validate the Skill and refresh the source cachebuster**

Run the repository-supported validators and cachebuster helper; do not edit the
marketplace file or an installed cache directly:

```bash
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-import-local-assets
python3 /home/ltt/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  plugins/keco-codex
python3 /home/ltt/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  plugins/keco-codex
```

Expected: both validators exit 0, and `plugin.json` keeps base version `0.4.0`
with exactly one new `+codex.<cachebuster>` suffix.

- [ ] **Step 6: Commit Skill routing**

```bash
git add plugins/keco-codex/.codex-plugin/plugin.json plugins/keco-codex/skills/keco-import-local-assets/SKILL.md plugins/keco-claude/skills/keco-import-local-assets/SKILL.md plugins/keco-codex/skills/keco-import-local-assets/agents/openai.yaml tests/fixtures/plugins/keco-local-image-import-skill-evals.json tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "feat: route Python images to project Assets"
```

- [ ] **Step 7: Refresh the installed local Codex plugin**

Read the existing repository marketplace name and reinstall from it:

```bash
python3 /home/ltt/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py \
  --marketplace-path .agents/plugins/marketplace.json
codex plugin add keco@keco-studio
codex plugin list
```

Expected: the installed `keco` version equals the refreshed source manifest
version. Compare the installed `keco-import-local-assets/SKILL.md` SHA-256 with
the repository copy with:

```bash
plugin_version="$(node -p "require('./plugins/keco-codex/.codex-plugin/plugin.json').version")"
plugin_cache_root="${CODEX_HOME:-/home/ltt/.codex}/plugins/cache/keco-studio/keco/${plugin_version}"
cmp plugins/keco-codex/skills/keco-import-local-assets/SKILL.md \
  "${plugin_cache_root}/skills/keco-import-local-assets/SKILL.md"
```

Do not run `codex plugin marketplace add` and do not edit
`.agents/plugins/marketplace.json`. Start a new Codex thread when exercising
the updated Skill. If local plugin installation is outside the execution
environment's authority, defer only this step and report the exact command;
shared MCP deployment and live acceptance remain separately gated in Task 6.

---

### Task 6: Python-Generated Live Acceptance And Final Verification

**Files:**
- Create: `scripts/accept-python-generated-asset-writeback.ts`
- Create: `tests/unit/mcp/python-generated-asset-acceptance.test.ts`
- Modify: `docs/mcp/README.md`

**Interfaces:**
- Consumes: public MCP prepare and Task 3 registration tools, `python3`, and acceptance-only service-role cleanup/read-back.
- Produces: sanitized JSON evidence that proves deterministic Python output becomes one visible `project_game_assets` record and exact registration retry reuses it.

- [ ] **Step 1: Write failing acceptance helper tests**

Export pure helpers from the acceptance script and test:

```ts
expect(pythonPixelArtSource).toContain('import struct');
expect(pythonPixelArtSource).toContain('import zlib');
expect(inventoryGeneratedPng(bytes, 'python-campus.png')).toEqual({
  fileName: 'python-campus.png',
  fileType: 'image/png',
  fileSize: bytes.length,
});
expect(redactEvidence({ uploadUrl: 'https://signed.example/?token=secret' }))
  .not.toContain('secret');
```

Mock the Python subprocess and assert its explicit environment contains no
`MCP_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, bearer token, or signed URL.
Inspect every captured MCP JSON body and assert it contains no Python source,
local temporary path, raw bytes, or Base64.

Mock MCP calls and assert the exact order:

```text
initialize -> tools/list -> list_projects -> prepare_image_uploads
-> HTTP PUT -> complete_project_game_asset_uploads
-> complete_project_game_asset_uploads (idempotency replay)
-> authoritative database read-back
```

Assert both registration responses carry the same asset ID and the replay has
`reused: true`.

- [ ] **Step 2: Run the acceptance helper test to verify it fails**

Run: `npm run test:unit -- --runInBand tests/unit/mcp/python-generated-asset-acceptance.test.ts`

Expected: FAIL because the acceptance script does not exist.

- [ ] **Step 3: Implement deterministic Python generation and MCP orchestration**

The script must:

1. Parse `--mcp-url`, `--project-id`, and `MCP_ACCESS_TOKEN`; require
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only for
   acceptance read-back and cleanup.
2. Create a temporary directory with `mkdtemp`, run `python3 -c` with a standard
   library PNG encoder using `struct`, `zlib`, and `binascii`, and produce a
   nonblank 128x128 RGBA pixel-art campus image. Give the subprocess an explicit
   minimal environment containing only the required executable/locale settings;
   never inherit `MCP_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, signed URLs,
   or authorization headers into Python.
3. Initialize MCP, confirm all required tools are advertised, and confirm the
   selected project is writable.
4. Call `prepare_image_uploads` with metadata only; PUT exact bytes using every
   returned header without logging target credentials.
5. Call `complete_project_game_asset_uploads` with category `map`, then replay
   the identical call and require the same asset ID plus `reused: true`.
6. Query `project_game_assets` through the acceptance-only admin client and
   require matching project, storage path, file name, ready status, dimensions,
   file size, and SHA-256.
7. Call `aggregateProjectGameAssets` or its API-equivalent query path and require
   the record to normalize as source `manual` and category `map`.
8. In `finally`, delete only the exact acceptance-owned registry row and storage
   object, remove the temporary directory, and report cleanup failures as a
   failed acceptance result.
9. Write evidence through `replaceEvidenceAtomically`; evidence may contain
   project ID, asset ID, object path, hash, dimensions, counts, and timestamps,
   but never credentials, signed URLs, headers, or local paths.

- [ ] **Step 4: Run helper tests and all focused feature tests**

Run: `npm run test:unit -- --runInBand tests/unit/mcp/python-generated-asset-acceptance.test.ts tests/unit/database/project-game-assets-mcp-migration.test.ts tests/unit/database/project-game-assets-mcp-registration.behavior.test.ts tests/unit/mcp/capabilities-probe.test.ts tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: PASS.

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/image-metadata.test.ts supabase/functions/mcp/image-tools.test.ts supabase/functions/mcp/server.test.ts`

Expected: PASS.

- [ ] **Step 5: Run repository verification**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run typecheck && npm run typecheck:api && npm run check:mcp`

Expected: all commands exit 0.

Run: `npm run test:mcp`

Expected: all MCP tests pass.

Run: `npm run test:unit -- --runInBand`

Expected: all Jest unit tests pass.

Run: `npm run build`

Expected: production build exits 0.

- [ ] **Step 6: Run live acceptance only against an explicitly selected deployed endpoint**

Do not deploy or mutate a shared endpoint implicitly. After the migration and
Edge Function are deployed to an approved environment, run:

```bash
node --env-file=.env.local --import tsx scripts/accept-python-generated-asset-writeback.ts \
  --mcp-url "$KECO_ACCEPTANCE_MCP_URL" \
  --project-id "$KECO_ACCEPTANCE_PROJECT_ID" \
  --output /tmp/keco-python-asset-writeback-evidence.json
```

Expected: evidence contains `passed: true`, one inserted asset, one exact replay
with `reused: true`, matching 128x128 metadata and SHA-256, a successful Assets
aggregation match, and successful cleanup.

- [ ] **Step 7: Add the verified invocation and recovery notes to MCP docs**

Document the environment variables, explicit deployment prerequisite, sanitized
evidence location, and recovery rule: retry registration for the same verified
path before preparing or uploading new bytes.

- [ ] **Step 8: Commit acceptance and final documentation**

```bash
git add scripts/accept-python-generated-asset-writeback.ts tests/unit/mcp/python-generated-asset-acceptance.test.ts docs/mcp/README.md
git commit -m "test: verify Python asset MCP writeback"
```
