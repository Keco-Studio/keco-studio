---
name: keco-import-local-assets
description: Use when a user asks to import local images, a local image directory, or host-generated images from a deterministic script into project Assets or an ordinary Keco image-asset table; not for provider-managed PixelLab, Godot integration, Keco documents, non-image attachments, or analysis-only work.
---

# Import Local Image Assets Into Keco

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for that summary and for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, object paths, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

## Overview

Import supported local images and images produced by a host-side deterministic script into one Keco project through an inventory-read-preview-confirm-upload-write-verify workflow. Use host file tools only to run the requested local generator, inventory outputs, and read local bytes. Use Keco MCP for project reads and writes, and use the live MCP Tool schemas as the authority for accepted arguments and limits.

Use this Skill for PNG, JPEG, GIF, WebP, and safe static SVG imports. Preserve Unicode in the local file name used as the stable row key. Report unsupported or ambiguous files before mutation. Provider-managed PixelLab map, character, and animation outputs stay in their lifecycle-specific Skills and tables; do not re-register them as manual assets. Do not use it for Keco-driven Godot resources, Keco document-to-table requests, unsupported non-image attachments, or analysis-only repository work.

## Required Workflow

Copy and track this checklist:

```text
Keco local image import:
- [ ] Inventory local files and identify unsupported items
- [ ] Resolve exactly one project and read its structure
- [ ] Preview the selected target, uploads, matching, and verification
- [ ] Obtain explicit user confirmation before the first Keco mutation
- [ ] Create only confirmed missing structure and read it back
- [ ] Prepare targets, PUT bytes, and complete/register successful uploads
- [ ] Write and read back the selected target's authoritative state
- [ ] Report successful, failed, unsupported, and unattempted items
```

1. For a requested host-side deterministic generator, run it locally, then inventory every generated output without mutating Keco. Otherwise inventory the requested local files. Record normalized file names, media types, sizes, and local paths only in local run state. Flag unsupported files and duplicate normalized names. Duplicates block mutation until the user resolves them.
2. Resolve exactly one Keco project. When a name matches more than one project, ask the user to choose; never guess. Read `list_project_structure` and inspect candidate folders, tables, schemas, and existing normalized file-name values.
3. Select the target before mutation: project Assets for local or host-generated project assets, or an ordinary compatible Keco table for table image fields. Preview the complete plan: selected project and target, files and exclusions, folder/table reuse or creation when the table target is selected, stable row match key when applicable, batch sequence, and read-back checks. The default table match key is normalized file name. Existing duplicate match values block mutation.
4. Obtain explicit confirmation of that preview before the first Keco mutation. Earlier requests to proceed are not confirmation of an unseen plan.
5. For an ordinary Keco table target, create only a confirmed missing folder or compatible asset table. Never silently overwrite, delete, rename, or create a same-purpose duplicate. After `create_folder`, use `list_project_structure` and match its folder ID, project ID, parent ID, and name before using it. Read back any created table and verify its schema before uploads. Project Assets needs no manual asset-table creation.
6. Consult the live schemas for `prepare_image_uploads`, `complete_project_game_asset_uploads`, `complete_image_uploads`, project asset aggregation, folder, table, and row tools. Prepare metadata-only batches of at most 20. Never put raw bytes, Base64, or local paths in MCP JSON.
7. Match each successful preparation result to its source by returned `index` and original file name. Send the exact local bytes outside MCP with the returned `upload.method` and all returned `upload.headers` before expiry. Use bounded concurrency. Do not PUT preparation failures.
8. Complete only successful PUT items, in batches of at most 20. Feed only `prepare_image_uploads.items[].image.path` from successful items to completion. Never pass a local path, `file:` URI, public URL, or signed upload URL.
9. Project Assets target: call `complete_project_game_asset_uploads` with only successful prepared `image.path` values and the confirmed category. Then read the project asset aggregation and match every successful item by path, name, hash, and status. Do not claim success from completion alone.
10. Ordinary Keco table target: call `complete_image_uploads`, then upsert rows with the confirmed normalized file-name key. Store the complete verified `image` object returned by completion as the Keco image field; never reduce it to a path or URL. Reuse completed image objects from the checkpoint after a row-write failure instead of uploading again. Paginate table read-back until the expected folder, table schema, normalized file-name set, rows, and image objects are accounted for. Do not claim success from mutation responses alone.
11. Report each item as successful, failed, unsupported, or unattempted. Treat any mixed result as partial completion.

## Checkpoint And Recovery

Keep nonsensitive project, folder, table, row, object-path, normalized file-name, and file metadata in the run checkpoint. Never persist or print signed URLs, upload headers, bearer tokens, authorization headers, or other credentials.

Resume forward without rolling back completed work:

| Failure | Resume rule |
|---|---|
| Preparation failed | Skip PUT; prepare only that item again when appropriate |
| PUT failed | Retry before target expiry, otherwise prepare only that item again |
| Completion or registration failed | Retry only that successful PUT item when the object remains valid or the outcome is unknown; if removed, prepare and PUT only that item again |
| Row write failed | Reuse the checkpoint's complete verified image object; do not upload again |
| Mutation response was lost | Read back by stable project and target identity: aggregation path/name/hash/status for Assets, or folder/table/row/image identity for a table, before retrying |

If project identity, target schema, or the stable match key changes, stop and present a revised preview for confirmation before more writes.

## Common Mistakes

| Mistake | Required correction |
|---|---|
| Send file bytes or Base64 through MCP | Keep bytes in the HTTP PUT outside MCP |
| Complete with a local path or signed URL | Use only the preparation result's `image.path` |
| Send a PixelLab lifecycle output through this workflow | Keep provider-managed map, character, and animation outputs in their lifecycle-specific Skills and tables |
| Store only an image path or URL in a row | Store the complete verified completion `image` object |
| Retry every file after a partial failure | Resume only failed or unknown items from the checkpoint |
| Trust a folder, upload, or row mutation response | Read the authoritative Keco state back and match stable identity |
