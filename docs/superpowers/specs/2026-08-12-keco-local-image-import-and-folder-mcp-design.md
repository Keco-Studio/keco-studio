# Keco Local Image Import And Folder MCP Design

**Date:** 2026-08-12

## Problem

The referenced KecoStudio execution record shows that an Agent can import local images into Keco, but only after discovering the protocol through repeated calls. The current MCP tools declare Zod input schemas, so the defect is not missing parameters. The defect is that the callable contract and installed Skills do not make the multi-step workflow discoverable enough:

1. `create_image_upload` prepares a signed target but does not fully explain how its returned fields feed the required HTTP request and completion call.
2. `complete_image_upload.path` does not clearly distinguish the returned Keco object path from a local path or URL.
3. Twenty images require forty MCP calls around twenty HTTP PUT requests, before any table writes.
4. No installed Skill routes an ordinary local-image or local-directory import into a complete Keco workflow. The document-to-table Skill explicitly excludes local files and images, while the PixelLab and Godot Skills own generated game assets rather than ordinary imports.
5. MCP cannot create a Keco folder even though Keco Studio already supports nested folders and restricts folder creation to project owners and administrators.
6. The Codex and Claude plugin sources and the installed Codex cache can drift, leaving Agents on an older contract after the repository is corrected.

## Goals

- Make the existing single-image upload protocol self-contained in MCP tool descriptions.
- Add bounded batch preparation and completion tools without transporting image bytes through MCP.
- Expose nested folder creation through an owner/admin-only MCP tool.
- Add a lightweight local-image import Skill that owns routing and orchestration, while MCP schemas remain the source of truth for tool parameters.
- Make partial failure resumable without duplicate uploads or silent data loss.
- Verify mutations by reading Keco state back rather than trusting mutation responses.
- Keep Codex and Claude plugin behavior synchronized and refresh the installed plugin cache.

## Non-Goals

- Uploading arbitrary attachments, audio, video, archives, or files other than supported images.
- Sending Base64 data or raw file bytes in MCP JSON.
- Letting the MCP server read a path on the Agent's machine.
- Replacing PixelLab generation, Godot asset integration, or Keco document-to-table workflows.
- Adding folder update, move, or delete tools.
- Broadening folder creation to editors or viewers.
- Automatically overwriting, deleting, or renaming existing Keco objects.
- Implementing or testing the feature as part of this specification task.

The first release supports PNG, JPEG, GIF, WebP, and safe static SVG files up to 5 MiB each. A request containing unsupported local files must identify them as unsupported; it must not imply that they were imported.

## Architecture

The repair has four independently testable units:

```text
Local files on Agent host
        |
        v
keco-import-local-assets Skill       routing, planning, recovery, verification
        |
        +--> create_folder            atomic Keco folder mutation
        |
        +--> prepare_image_uploads    signed PUT descriptors, no bytes
        |          |
        |          v
        |     HTTP PUT by Agent       raw bytes sent outside MCP
        |          |
        |          v
        +--> complete_image_uploads   stored-object validation
                   |
                   v
          existing table write tools
                   |
                   v
          existing Keco read tools    authoritative verification
```

Existing `create_image_upload` and `complete_image_upload` remain available for compatibility and single-image work. The batch tools reuse the same validation and response construction rather than introducing a second upload implementation. Common upload preparation and completion logic must be extracted behind internal functions so single and batch behavior cannot diverge.

Folder creation uses one database RPC. Authorization, parent lookup, scoped uniqueness, insertion, and returned-row selection occur within that operation. MCP-side role checks may reject early, but the RPC is the authoritative permission boundary.

## Existing Single-Image Contract

The schemas remain compatible:

```ts
create_image_upload({
  projectId: string;
  fileName: string;
  fileType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  fileSize: number;
})

complete_image_upload({
  projectId: string;
  path: string;
})
```

Their descriptions and field descriptions must state the full protocol:

1. Call `create_image_upload` with file metadata only.
2. Send the exact local file bytes to `upload.url` using the returned `upload.method` and all returned `upload.headers` before expiry.
3. Pass only that response's `image.path` to `complete_image_upload.path`. A Windows path, POSIX path, `file:` URI, public image URL, or signed upload URL is invalid.
4. Use the complete verified `image` object returned by completion as the value of a Keco image field. Do not reduce it to a URL or path.

Errors for an invalid completion path must explicitly say that the value must come from `create_image_upload.image.path`. Documentation and Skills must never persist or print signed URLs, upload headers, access tokens, or authorization headers.

## Batch Image Tools

### `prepare_image_uploads`

```ts
prepare_image_uploads({
  projectId: string;
  files: Array<{
    fileName: string;
    fileType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
    fileSize: number;
  }>;
})
```

`files` contains between 1 and 20 items. Each item uses the existing single-image limits: a plain file name of 1-200 trimmed characters, a matching supported extension and media type, and an integer size of 1 byte through 5 MiB. Raw bytes and Base64 are forbidden.

The response preserves input order and includes the zero-based input index and original nonsensitive metadata for every item. A prepared item contains the same `upload` and provisional `image` objects as `create_image_upload`. An item that could not obtain a signed target contains a stable error object. Signed data must be returned to the caller but excluded from telemetry and diagnostic logging.

The response uses one discriminated item envelope:

```ts
{
  ok: true;
  preparedCount: number;
  failedCount: number;
  items: Array<
    | { index: number; ok: true; file: FileMetadata; upload: UploadDescriptor; image: ProvisionalImage }
    | { index: number; ok: false; file: FileMetadata; error: { code: string; message: string } }
  >;
}
```

The top-level `ok` means the batch call ran and produced item results; it does not mean every item succeeded. `failedCount > 0` is the machine-readable partial-failure signal.

Input-schema violations reject the whole call before work starts. Runtime preparation failures are item-scoped: the tool attempts the remaining valid items and reports the exact prepared and failed counts.

### `complete_image_uploads`

```ts
complete_image_uploads({
  projectId: string;
  paths: string[];
})
```

`paths` contains between 1 and 20 unique, nonempty paths. Each value must be a corresponding `image.path` returned by a Keco preparation tool for the same user and project. Input order is preserved. Each result contains its input index and either the complete verified `image` object or a stable error.

```ts
{
  ok: true;
  completedCount: number;
  failedCount: number;
  items: Array<
    | { index: number; ok: true; path: string; image: VerifiedImage }
    | { index: number; ok: false; path: string; error: { code: string; message: string } }
  >;
}
```

As with preparation, top-level `ok` means item processing completed. Consumers determine total or partial success from the counts and item results.

Input-schema violations reject the whole call. Stored-object failures are item-scoped so one corrupt or missing image does not invalidate verified siblings. Completion retains the existing security checks for project path, object existence, size, media type, extension, signature, and safe static SVG content. Existing cleanup behavior for invalid stored objects remains in force.

Both batch tools are write operations with `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, and `openWorldHint: false`. They must document that retrying preparation creates new upload targets, while retrying completion for an unchanged prepared path is allowed only when the prior result is unknown or failed without deleting the object.

Batch item errors reuse existing image-domain codes where applicable. Failure to create a signed target uses `IMAGE_UPLOAD_PREPARATION_FAILED`; a missing uploaded object uses `IMAGE_UPLOAD_NOT_FOUND`; an invalid or rejected stored image uses `FIELD_VALIDATION_FAILED`; revoked or insufficient write access uses the existing project-access error contract. Messages state whether the object was removed and therefore requires preparation and PUT again. Unexpected internal failures remain item-scoped and use `INTERNAL_ERROR` without leaking provider details.

## Folder Creation Tool

### Input

```ts
create_folder({
  projectId: string;
  name: string;
  description?: string | null;
  parentFolderId?: string | null;
})
```

- `projectId` is required on the account endpoint and follows the existing legacy project-endpoint convention.
- `name` is trimmed, nonempty, and at most 200 characters.
- `description` is optional, nullable, trimmed to `null` when empty, and at most 1000 characters.
- `parentFolderId` is optional or nullable. When present, it is a UUID for a folder in the same project.

### Authorization and atomicity

Only the project owner or an accepted collaborator with role `admin` may create a folder. Editors and viewers receive `PROJECT_WRITE_FORBIDDEN`. This deliberately matches Keco Studio's existing folder creation policy even where general MCP table writes allow editors.

A new `mcp_create_folder` RPC performs permission validation, parent validation, scoped-name conflict detection, insertion, and returned-row selection atomically. It must use the authenticated user identity and a fixed `search_path`; clients cannot supply an actor ID or role. Direct multi-query mutation in the MCP handler is prohibited.

The RPC and existing database constraints enforce:

- the parent exists and belongs to the same project;
- a folder is unique by name within the root of a project or within one parent;
- the existing maximum nesting depth of eight;
- no self-parenting or cycles.

### Result and errors

The success payload returns the complete folder object:

```ts
{
  id: string;
  projectId: string;
  parentFolderId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}
```

The stable domain errors are:

| Code | Meaning |
| --- | --- |
| `PROJECT_WRITE_FORBIDDEN` | Caller is not the project owner or an admin collaborator |
| `FOLDER_NOT_FOUND` | Requested parent does not exist in the selected project |
| `FOLDER_NAME_CONFLICT` | The same trimmed name already exists in the target parent scope |
| `FIELD_VALIDATION_FAILED` | Input is malformed or nesting rules would be violated |

`create_folder` is a nondestructive, non-idempotent write Tool. After success, callers must use `list_project_structure` and match the returned folder ID, project ID, parent ID, and name before using the folder as a subsequent write target.

## Lightweight Local Import Skill

The new Skill is named `keco-import-local-assets`. Its description must make routing possible without naming the Skill explicitly.

### Trigger boundary

Use it when the user asks to:

- import local images or a local image directory into a Keco project;
- upload local visual assets into Keco;
- create or populate an ordinary Keco image-asset table from local media.

Do not use it for:

- generated images or PixelLab work;
- Keco-driven Godot resource integration;
- a Keco document-to-table request;
- unsupported non-image attachments;
- analysis-only repository work.

The Skill is an orchestration contract, not a second Tool reference. It may name fields that connect calls, such as `prepare.items[].image.path` feeding completion, but it must direct the Agent to the live MCP schemas for accepted arguments and limits rather than copying an exhaustive schema that can drift.

### Required workflow

```text
1. Inventory local files and identify unsupported or ambiguous items.
2. Resolve exactly one Keco project; ask when project names are ambiguous.
3. Read project structure and inspect candidate folders and tables.
4. Preview the complete folder, table, upload, row-match, and verification plan.
5. Obtain explicit confirmation before the first Keco mutation.
6. Create only the confirmed missing folder or compatible asset table, then read it back.
7. Prepare upload targets in batches of at most 20.
8. PUT local bytes concurrently with bounded concurrency, exact returned methods and headers.
9. Complete only successful PUT paths in batches of at most 20.
10. Upsert rows using the confirmed stable match key and complete verified image objects.
11. Paginate read-back and verify the exact expected folders, schema, file set, rows, and image objects.
12. Report successful, failed, unsupported, and unattempted items accurately.
```

The Skill reuses a compatible folder or table only when the plan identifies it explicitly. It never silently overwrites, deletes, renames, or creates a same-purpose duplicate. A folder can be created only after the preview and confirmation gate. Godot Slice V2 may use `create_folder` for its authoritative planning folder only after its own existing planning preview/review gate; it must not create folders opportunistically during discovery.

The default row match key is the normalized file name because it is visible and supported by current table tools. Duplicate normalized names in the local inventory or target table block mutation until the user resolves them. A future content-hash field may strengthen matching, but content-hash schema changes are outside this release.

## Failure and Resume Rules

The import is a forward-only, partially resumable workflow. It does not attempt rollback of successfully created folders, tables, uploaded objects, or rows.

- If preparation fails, do not PUT that item. Continue other prepared items and report the failure.
- If PUT fails, do not complete that item. The prepared target may be retried before expiry; otherwise prepare a new target for only that item.
- If PUT succeeds but completion fails, retry completion only when the error says the stored object remains valid or the result is unknown. If completion removed an invalid object, prepare and upload only that item again.
- If completion succeeds but a row write fails, preserve the verified image object in the run checkpoint and reuse it. Do not upload the file again.
- If a mutation response is lost, read back by stable project, folder, table, row, and image identity before deciding to retry.
- If the project, target schema, or stable match key changes during a run, stop and produce a revised preview before further writes.
- A partially successful batch is reported as partial completion, never as total success or total failure.

Run checkpoints may contain nonsensitive project, folder, table, row, object-path, and file metadata. They must not contain signed URLs, upload headers, bearer tokens, or other credentials.

## Documentation and Plugin Synchronization

The MCP README receives one canonical single and batch image-upload sequence plus folder creation examples. Tool descriptions remain sufficient for basic use without requiring a Skill.

The Skill and any shared references are added to both `plugins/keco-codex` and `plugins/keco-claude`. Focused tests compare their routing language and workflow requirements so one package cannot silently lose the behavior.

Release work must:

1. assign compatible updated plugin versions and manifests;
2. update marketplace metadata where applicable;
3. run the repository's plugin validation;
4. use the supported cache-buster/reinstall flow for the Codex plugin;
5. reinstall or refresh the Claude plugin through its supported local workflow;
6. inspect the actually installed Skill and manifest, not only repository source;
7. confirm that the installed MCP capability list includes the new Tools.

The cache refresh must also eliminate the known installed Codex validator drift between obsolete `manual-v2` routing and the repository's current `implicit-v2|explicit-v2` contract.

## Verification Strategy

Implementation is not required to follow test-driven development. Verification remains mandatory and is added after or alongside implementation in proportion to the change.

### MCP contract tests

- Existing single-image schemas remain compatible.
- Descriptions state PUT method/header use, `image.path` provenance, rejected local paths/URLs, and complete image-object binding.
- Batch schemas enforce 1-20 items, supported types, extension matching, file-size limits, strict objects, and project identity.
- Batch results preserve input order and distinguish whole-request validation from item-scoped runtime failure.
- Preparation never logs signed URL material.
- Completion preserves project isolation and all existing content validation and cleanup behavior.
- `create_folder` succeeds for owner and admin callers.
- `create_folder` rejects editor and viewer callers.
- Root and nested creation, cross-project parents, missing parents, depth limits, and scoped name conflicts map to the specified results.
- Account and legacy project endpoints expose consistent behavior.

### Skill and routing tests

- A fixture derived from the apple-and-pear execution record routes a local image-directory import to `keco-import-local-assets`.
- The workflow orders inventory, read/plan/confirmation, optional folder/table creation, preparation, PUT, completion, row write, and read-back.
- Local paths and signed URLs are never sent to completion or persisted in Keco rows.
- PixelLab, Godot, document-to-table, and unsupported attachment requests do not route to this Skill.
- Duplicate names, partial completion, and resume after row-write failure follow the specified behavior.
- Codex and Claude copies remain synchronized.

### Repository and installed-package checks

- Run MCP type/schema checks and the complete MCP test suite.
- Run focused and complete plugin tests for both packages.
- Run the read-only MCP capability probe against the configured environment.
- Refresh plugin caches and inspect the installed manifest, Skill content, validator contract, and exposed tool list.
- Do not claim the repair is deployed from repository tests alone.

## Acceptance Criteria

The change is acceptable when:

1. An Agent can infer the complete single-image protocol from the Tool descriptions without trial calls.
2. Up to twenty local images can be prepared and completed with two MCP batch calls around the required HTTP PUT operations, excluding table and verification calls.
3. One bad image produces an explicit item failure without forcing verified siblings to be re-uploaded.
4. Only a project owner or admin can create a root or nested folder, and the created folder is read back before use.
5. A local image-directory request reliably selects the lightweight Skill and executes a preview-confirm-write-verify workflow.
6. Resume after a table-write failure reuses completed Keco image objects instead of uploading duplicates.
7. Unsupported files, partial work, and blockers are reported exactly.
8. Codex and Claude source packages pass synchronization checks, and the installed packages expose the new contract.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Batch code diverges from single-image validation | Reuse internal preparation and completion functions and run parity tests |
| Batch responses exceed MCP limits | Limit each call to 20 metadata-only items; keep image bytes outside MCP |
| An editor gains directory-management rights through general write access | Enforce owner/admin inside the atomic RPC and test every role |
| Retrying creates duplicate objects or rows | Checkpoint completed image objects, match rows by confirmed file name, and read back before retry |
| The Skill duplicates stale parameter schemas | Keep schemas authoritative and limit the Skill to routing, field provenance, sequencing, and recovery |
| The Skill name implies unsupported arbitrary files | State supported image types at intake and report unsupported files before mutation |
| Signed credentials leak into chat or logs | Redact them from telemetry and forbid persistence in Skill and documentation contracts |
| Repository and installed plugins drift | Test Codex/Claude synchronization and inspect cache-refreshed installed copies |
