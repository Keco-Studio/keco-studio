# Python-Generated Asset MCP Writeback Design

**Date:** 2026-09-09

## Problem

Keco can already prepare and verify image uploads through MCP, and the project
Assets page can already display manually registered images. Those two
capabilities are not connected for images created by a local Python process.
After Python writes an image, an Agent can place the bytes in the
`library-media-files` bucket with `prepare_image_uploads`, an HTTP PUT, and
`complete_image_uploads`, but completion does not create a
`project_game_assets` row. The upload is therefore valid storage content but is
not discoverable in the project Assets experience.

The solution must work for arbitrary future Python image generators, not only
for one acceptance image. Python must not receive a service-role key, the MCP
server must not read host paths, and raw bytes must remain outside MCP JSON.

## Goals

- Let an authenticated Agent return any supported local Python-generated image
  to one writable Keco project and make it visible in project Assets.
- Preserve the existing metadata-only prepare and direct signed-PUT boundary.
- Verify stored bytes before creating an authoritative asset registry row.
- Make registration retryable without duplicate rows or duplicate uploads.
- Preserve per-item results for batches of 1-20 images.
- Derive identity and integrity metadata from stored bytes rather than trusting
  local paths or caller-supplied hashes.
- Cover the workflow with unit, MCP contract, database, and live acceptance
  evidence using a deterministic Python-generated PNG.

## Non-Goals

- Running Python inside the MCP server.
- Sending local paths, Base64, or raw image bytes in MCP JSON.
- Replacing PixelLab map, character, or animation lifecycle records.
- Converting a manually generated image into a `map_assets` or
  `character_generation_attempts` record.
- Automatically deleting an already verified object when registry persistence
  fails.
- Adding video, audio, archives, PSD, or other non-image asset types.
- Adding asset deletion or overwrite behavior.

## Considered Approaches

### Dedicated MCP completion-and-registration tool (selected)

Add `complete_project_game_asset_uploads`. It accepts prepared object paths,
reuses stored-image verification, derives asset metadata, and atomically
creates or reuses `project_game_assets` rows. This keeps user authorization in
MCP, exposes no server credentials, and gives Agents one explicit contract for
making local generated files visible in Assets.

### Standalone service-role Python uploader

A Python script could upload and insert directly with
`SUPABASE_SERVICE_ROLE_KEY`. This is operationally simple but gives local code
broad database authority, bypasses normal user authorization, and makes the
workflow unsuitable for general Agent use. It is rejected.

### Authenticated HTTP upload client

Python could call the existing multipart Assets endpoint with a user session.
This would reuse its `sharp` inspection, but the MCP connection does not expose
a reusable browser session or bearer token to host scripts. Adding token export
would weaken the current credential boundary. It is rejected for the Agent
workflow; the browser endpoint remains unchanged.

## Architecture

```text
Python process on Agent host
        |
        | writes PNG/JPEG/GIF/WebP/safe SVG
        v
prepare_image_uploads                     metadata only
        |
        | signed HTTP PUT                 exact bytes, outside MCP
        v
library-media-files object
        |
        v
complete_project_game_asset_uploads       verify + inspect + register
        |
        +--> project_game_assets          stable registry identity
        |
        v
Assets aggregation/read-back              authoritative verification
```

The existing `complete_image_upload` and `complete_image_uploads` tools remain
unchanged for Keco table image fields. The new tool is intentionally specific
to the project Assets registry so callers cannot confuse generic table images
with project game assets.

## MCP Contract

### Input

```ts
complete_project_game_asset_uploads({
  projectId: string;
  items: Array<{
    path: string;
    category?: "character" | "icon" | "ui" | "map" | "prop" | "vfx" | "spritesheet" | "media";
  }>;
})
```

- `items` contains 1-20 entries and paths must be unique.
- Every path must be an `image.path` returned by a Keco image preparation tool
  for the same authenticated user and project.
- `category` defaults to `media`, matching the current Assets taxonomy.
- The display name is the verified original file name. The caller cannot
  provide an alternate name during registration.
- The tool is a non-destructive MCP write operation and is available only on a
  writable project connection.

### Output

The response preserves input order and returns one discriminated result per
item:

```ts
{
  ok: true;
  completedCount: number;
  failedCount: number;
  items: Array<
    | {
        index: number;
        ok: true;
        path: string;
        reused: boolean;
        image: VerifiedImage;
        asset: {
          id: string;
          projectId: string;
          name: string;
          category: string;
          status: "ready";
          storagePath: string;
          sha256: string;
          width: number | null;
          height: number | null;
          hasTransparency: boolean | null;
          fileSize: number;
          mimeType: string;
          createdAt: string;
          updatedAt: string;
        };
      }
    | {
        index: number;
        ok: false;
        path: string;
        error: { code: string; message: string };
      }
  >;
}
```

Top-level `ok` means item processing ran. `failedCount > 0` is the authoritative
partial-failure signal. Signed URLs and upload headers are never included in
the registration result, logs, or checkpoints.

## Stored-Image Verification And Metadata

Registration reuses the same project-path, existence, maximum-size, MIME,
extension, signature, and safe-SVG checks used by `complete_image_uploads`.
The implementation refactors the current verifier so one download can produce
both the public `VerifiedImage` and internal byte-derived metadata.

- SHA-256 is always calculated from the exact downloaded bytes with Web Crypto.
- PNG dimensions and transparency are derived with the existing `fast-png`
  decoder.
- JPEG dimensions are decoded from a valid SOF segment and transparency is
  `false`.
- GIF and WebP dimensions are decoded from their validated headers;
  transparency is set only when it can be proven, otherwise `null`.
- Safe SVG dimensions come from positive numeric `width` and `height`, falling
  back to a valid positive `viewBox`; transparency remains `null`.
- A format whose dimensions cannot be parsed remains a valid upload with
  nullable dimensions. Integrity verification and SHA-256 remain mandatory.

Metadata extraction has a bounded byte and CPU cost because the existing 5 MiB
limit remains in force. It must not execute SVG content or follow external
references.

## Database Registration And Idempotency

Add an authenticated database RPC that receives the verified metadata for one
path and performs project authorization, conflict detection, insert-or-reuse,
and returned-row selection atomically.

The RPC requires the caller to be the project owner or an accepted `admin` or
`editor`. A `viewer` receives `PROJECT_WRITE_FORBIDDEN`, matching the existing
Assets HTTP endpoint rather than the overly broad legacy insert policy.

`project_game_assets.storage_path` is the idempotency key:

- No existing row: insert one `ready` row with `created_by = auth.uid()`.
- Existing row with the same project, creator, category, file name, MIME, byte
  size, SHA-256, dimensions, and transparency: return it with `reused: true`.
- Existing row with conflicting identity or metadata: return
  `ASSET_REGISTRATION_CONFLICT`; never update it silently.
- A path outside the authenticated user's project prefix is rejected before
  the RPC.

The migration also narrows direct insert/update policy to owner, admin, or
editor so the database and both upload interfaces enforce the same role model.

## Error And Recovery Semantics

- Input schema errors reject the whole call before item processing.
- Runtime verification and registration errors are item-scoped.
- Missing PUT content returns `IMAGE_UPLOAD_NOT_FOUND`; the caller may PUT to
  the unexpired target or prepare a new target.
- Invalid image content follows existing cleanup behavior and must be prepared
  and uploaded again.
- If registration fails after successful verification, the valid object is
  retained. Retrying the same path does not re-upload bytes.
- A lost registration response is recovered by retrying the same path; the RPC
  returns the existing row.
- Callers retry only failed or unknown items, never an entire successful batch.

## Python Host Workflow

The Keco local image import Skill is expanded narrowly to include images
created deterministically by host-side scripts such as Python. Provider-managed
PixelLab output remains excluded because its lifecycle tables are authoritative.

The Agent workflow is:

1. Run the user's Python generator with `python3` and inventory its output.
2. Validate supported extension, MIME, nonzero size, and the 5 MiB limit.
3. Resolve exactly one writable Keco project and preview the intended items.
4. Obtain confirmation before the first mutation.
5. Prepare targets, PUT exact bytes, and call
   `complete_project_game_asset_uploads` for successful PUTs.
6. Read the Assets aggregation back and match stable storage path, file name,
   dimensions, SHA-256, and status.

Pillow is not a runtime requirement for Keco. The acceptance fixture uses only
the Python standard library so the test remains portable in the current host,
where `python3` is available but Pillow is not installed.

## Files And Boundaries

- `supabase/functions/mcp/write-tools.ts`: shared verification result,
  byte-derived metadata, and the new MCP batch tool.
- `supabase/functions/mcp/server.ts`: advertise the new write capability.
- `supabase/functions/mcp/image-tools.test.ts`: unit and contract coverage.
- `supabase/migrations/*_mcp_project_game_asset_registration.sql`: atomic RPC
  and corrected role policies.
- `docs/mcp/README.md`: generated-local-image writeback protocol.
- `scripts/accept-python-generated-asset-writeback.ts`: live MCP acceptance
  orchestration and authoritative read-back.
- `plugins/keco-codex/skills/keco-import-local-assets/SKILL.md` and the Claude
  mirror: route locally generated files into the registry-aware completion
  flow while preserving provider-generated exclusions.
- Plugin cache/version metadata required by the repository's normal release
  process.

No application UI change is required. `gameAssetsService` already aggregates
`project_game_assets`, and the existing Assets page already renders ready
manual images.

## Testing

1. MCP schema tests reject empty batches, duplicate paths, invalid categories,
   local paths, public URLs, and signed URLs.
2. Verification tests cover PNG/JPEG/GIF/WebP/safe SVG metadata and integrity,
   plus corrupt and unsafe inputs.
3. Batch tests prove order preservation and mixed success/failure counts.
4. Database tests prove owner/admin/editor access, viewer rejection, project
   isolation, exact retry reuse, and metadata conflict rejection.
5. Server capability tests include the new tool in the public write set.
6. Skill consistency tests keep Codex and Claude workflow guidance aligned.
7. Live acceptance generates a deterministic nonblank pixel-art PNG with
   Python standard-library code, uploads it through the public MCP protocol,
   registers it in a test project, reads the registry/Assets state back, and
   cleans up only acceptance-owned records and objects.

## Acceptance Criteria

1. A Python-generated supported image can be prepared, PUT, completed, and
   registered without exposing a service-role key or raw bytes to MCP JSON.
2. The resulting `project_game_assets` row is `ready` and appears through the
   existing project Assets aggregation.
3. Its storage path is scoped to the authenticated user and selected project;
   name, MIME, size, SHA-256, and available image metadata match stored bytes.
4. Repeating registration for the identical path returns the same row and does
   not create a duplicate.
5. Viewer and cross-project attempts fail without creating or changing rows.
6. One failed item does not hide or roll back successful siblings.
7. Existing generic image-field uploads and provider-managed generated assets
   retain their current behavior.
