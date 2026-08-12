---
name: keco-import-local-assets
description: Use when a user asks to import local images or a local image directory, upload local visual assets, or populate an ordinary Keco image-asset table from local media; not for generated assets, PixelLab or Godot integration, Keco documents, non-image attachments, or analysis-only work.
---

# Import Local Image Assets Into Keco

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for that summary and for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, object paths, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

## Overview

Import supported local images into one Keco project through an inventory-read-preview-confirm-upload-write-verify workflow. Use host file tools only to inventory and read local bytes. Use Keco MCP for project reads and writes, and use the live MCP Tool schemas as the authority for accepted arguments and limits.

Use this Skill for PNG, JPEG, GIF, WebP, and safe static SVG imports. Preserve Unicode in the local file name used as the stable row key. Report unsupported or ambiguous files before mutation. Do not use it for generated images, PixelLab work, Keco-driven Godot resources, Keco document-to-table requests, unsupported non-image attachments, or analysis-only repository work.

## Required Workflow

Copy and track this checklist:

```text
Keco local image import:
- [ ] Inventory local files and identify unsupported items
- [ ] Resolve exactly one project and read its structure
- [ ] Preview folders, table, uploads, row matching, and verification
- [ ] Obtain explicit user confirmation before the first Keco mutation
- [ ] Create only confirmed missing structure and read it back
- [ ] Prepare targets, PUT bytes, and complete successful uploads
- [ ] Upsert rows with complete verified image objects
- [ ] Paginate read-back and verify the expected state
- [ ] Report successful, failed, unsupported, and unattempted items
```

1. Inventory the requested files without mutating Keco. Record normalized file names, media types, sizes, and local paths only in local run state. Flag unsupported files and duplicate normalized names. Duplicates block mutation until the user resolves them.
2. Resolve exactly one Keco project. When a name matches more than one project, ask the user to choose; never guess. Read `list_project_structure` and inspect candidate folders, tables, schemas, and existing normalized file-name values.
3. Preview the complete plan: selected project, files and exclusions, folder reuse or creation, compatible table reuse or creation, stable row match key, batch sequence, and read-back checks. The default match key is normalized file name. Existing duplicate match values block mutation.
4. Obtain explicit confirmation of that preview before the first Keco mutation. Earlier requests to proceed are not confirmation of an unseen plan.
5. Create only a confirmed missing folder or compatible asset table. Never silently overwrite, delete, rename, or create a same-purpose duplicate. After `create_folder`, use `list_project_structure` and match its folder ID, project ID, parent ID, and name before using it. Read back any created table and verify its schema before uploads.
6. Consult the live schemas for `prepare_image_uploads`, `complete_image_uploads`, folder, table, and row tools. Prepare metadata-only batches of at most 20. Never put raw bytes, Base64, or local paths in MCP JSON.
7. Match each successful preparation result to its source by returned `index` and original file name. Send the exact local bytes outside MCP with the returned `upload.method` and all returned `upload.headers` before expiry. Use bounded concurrency. Do not PUT preparation failures.
8. Complete only successful PUT items, in batches of at most 20. Feed only `prepare_image_uploads.items[].image.path` from successful items to completion. Never pass a local path, `file:` URI, public URL, or signed upload URL.
9. Upsert rows with the confirmed normalized file-name key. Store the complete verified `image` object returned by completion as the Keco image field; never reduce it to a path or URL. Reuse completed image objects from the checkpoint after a row-write failure instead of uploading again.
10. Paginate authoritative reads until the expected folder, table schema, normalized file-name set, rows, and image objects are accounted for. Do not claim success from mutation responses alone.
11. Report each item as successful, failed, unsupported, or unattempted. Treat any mixed result as partial completion.

## Checkpoint And Recovery

Keep nonsensitive project, folder, table, row, object-path, normalized file-name, and file metadata in the run checkpoint. Never persist or print signed URLs, upload headers, bearer tokens, authorization headers, or other credentials.

Resume forward without rolling back completed work:

| Failure | Resume rule |
|---|---|
| Preparation failed | Skip PUT; prepare only that item again when appropriate |
| PUT failed | Retry before target expiry, otherwise prepare only that item again |
| Completion failed | Retry completion only when the object remains valid or the outcome is unknown; if removed, prepare and PUT only that item again |
| Row write failed | Reuse the checkpoint's complete verified image object; do not upload again |
| Mutation response was lost | Read back by stable project, folder, table, row, and image identity before retrying |

If project identity, target schema, or the stable match key changes, stop and present a revised preview for confirmation before more writes.

## Common Mistakes

| Mistake | Required correction |
|---|---|
| Send file bytes or Base64 through MCP | Keep bytes in the HTTP PUT outside MCP |
| Complete with a local path or signed URL | Use only the preparation result's `image.path` |
| Store only an image path or URL in a row | Store the complete verified completion `image` object |
| Retry every file after a partial failure | Resume only failed or unknown items from the checkpoint |
| Trust a folder, upload, or row mutation response | Read the authoritative Keco state back and match stable identity |
