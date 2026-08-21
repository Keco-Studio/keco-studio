# Keco MCP

Keco's default remote Streamable HTTP MCP endpoint is account-scoped:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp
```

Configure this one URL and complete OAuth in the browser with the Keco account
that needs access. OAuth establishes identity and the service grant; it does
not select or authorize a project by itself. Keco rechecks current membership
and role before every project read or write. Supabase identity scopes such as
`openid`, `profile`, `email`, and `phone` do not grant Keco permissions. Do not
configure custom `mcp:read` or `mcp:write` scopes.

Existing project-bound URLs remain legacy-compatible for already configured
clients and credentials:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/{project-id}
```

New clients must use the root URL. Do not migrate an existing legacy client by
editing its URL or reusing its token: complete OAuth against the root endpoint.

## Client Setup

Use the exact root endpoint as a remote Streamable HTTP MCP server. Codex and
Claude discover OAuth from the endpoint's `WWW-Authenticate` challenge.
Complete authorization in the browser with the Keco account whose projects you
need to use. A zero-project account may authorize successfully and receive an
empty project list.

The MCP challenge advertises protected-resource metadata on the same Supabase
origin at `/functions/v1/mcp/oauth-protected-resource`. OAuth discovery therefore
does not require the MCP client process to reach the Keco Vercel application.
The browser authorization and consent flow may still use the deployed Keco web
origin.

For Codex, add a remote MCP server whose URL is the root endpoint. Do not add an
authorization header manually; allow Codex to run OAuth and retain its own
refresh token. For Claude, add the same URL as a custom remote connector and use
the browser OAuth flow. Client configuration files and screenshots must never be
committed when they contain access tokens, refresh tokens, client secrets,
authorization codes, PKCE values, or cookies.

After OAuth, start with `list_projects`. Each result includes the project name,
creation date, current role, and capabilities (`read`, `create`, and `update`).
People never need to enter or remember a project ID. The agent uses the stable
ID returned by `list_projects` internally for each project-scoped call and
revalidates access at that time.

Duplicate names are listed, not silently selected. Show their role and creation
date, then ask only when the requested operation remains ambiguous. For example,
listing projects named "Game Design" requires no question; reading documents in
"Game Design" requires clarification when more than one result matches; "the
Admin Game Design project" can proceed if it uniquely identifies a listed
project. Never prefer a writable project, an admin project, or the newest result
to resolve an ambiguous request.

At the root endpoint, every authorized role discovers the connection probe,
`list_projects`, and read Tools. Write Tools are advertised only when the
account currently has at least one admin or editor project. A viewer target still
rejects a write with `PROJECT_WRITE_FORBIDDEN`; the agent must not switch to a
writable duplicate. Account resources begin at `keco://projects` and project
tools, resources, and prompts use the returned project ID internally. The
legacy endpoint retains its original bound-project tool, resource, and prompt
schemas. A role downgrade or membership removal applies on the next request
even if the client's access token has not expired.

## Table Schema Writes

`create_table` accepts `image` fields alongside the supported string, number,
boolean, enum, date, array, and reference field types. To extend an existing
table, call `add_table_field` with its `tableId` and one strict field
definition. Include `projectId` on the account endpoint and omit it on a legacy
project endpoint.

Fields added to existing tables must be optional because existing rows do not
have a value for the new field. The tool rejects `required: true`, duplicate
labels after trimming and case folding, invalid enum/reference definitions,
and references to tables outside the selected project. It appends the field to
the table's single ordered field list.

MCP table maintenance tools cover common correction and cleanup flows after a
table exists:

- `update_table` renames a table, updates its description, or moves it to a
  folder. Duplicate names in the target folder are rejected.
- `edit_table_field` changes a field's label, type configuration, description,
  required flag, or section. Type changes reject non-empty fields unless
  `clearValuesOnTypeChange: true` is provided. Any field edit resets the field's
  existing formula expression.
- `reorder_table_fields` atomically rewrites the full field order. The request
  must include every field in the table exactly once.
- `delete_table_field`, `delete_table_row`, and `delete_table` are destructive
  tools. They require explicit clear/confirmation inputs when data or references
  would be removed. `delete_table` also requires `confirmName` to match the
  current table name.
- `bulk_update_table_rows` updates up to 100 existing rows atomically.
- `upsert_table_rows` creates or updates up to 100 rows using a stable
  `string`, `int`, `float`, `boolean`, `enum`, or `date` match field.

Reference cleanup is conservative. Deleting a referenced row or table rejects by
default. If `clearReferences: true` is supplied, only references pointing to the
deleted rows from fields that declare the deleted table as an allowed target are
removed from reference cells; unrelated references in the same cell or unrelated
reference fields are preserved.

## Story Graph Reads

Use `read_story_graph` to read the complete canonical graph of a
document-derived Script library. Obtain the stable `libraryId` from
`list_project_structure`. The account endpoint also requires the `projectId`
returned by `list_projects`; the legacy project endpoint omits `projectId`.

```json
{
  "projectId": "from list_projects",
  "libraryId": "from list_project_structure",
  "limit": 100
}
```

The result is a typed stream of `warning`, `plot_node`, `plot_edge`, and
`story_node` items. Follow `nextCursor` with the same project, library, and
limit until `hasMore` is false. This preserves complete node content,
commands, choices, Plot grouping, edges, endings, warnings, and graph summary
without exceeding the MCP response limit.

Each cursor is bound to one graph snapshot. If a later page returns
`STORY_GRAPH_CONFLICT`, discard every page already collected and restart the
read without a cursor. The tool is read-only and is available to viewers,
editors, and admins.

## Image Uploads

The MCP image tools exchange metadata and object paths only. Raw bytes are sent
directly to the returned signed target, outside the bounded MCP JSON request.
PNG, JPEG, GIF, WebP, and safe static SVG files up to 5 MiB are supported.
Include `projectId` from `list_projects` on the account endpoint and omit it on
a legacy project endpoint.

### Single Image

1. Ensure the target table has an `image` field, either in
   `create_table.fields` or with `add_table_field`.
2. Call `create_image_upload` with `fileName`, `fileType`, and `fileSize`. This
   sends file metadata only; do not include raw bytes or Base64.
3. Before the target expires, send the exact local file bytes to the returned
   `upload.url` using the returned `upload.method` and every returned
   `upload.headers` entry.
4. After the PUT succeeds, call `complete_image_upload`. Its `path` must be only
   the `image.path` from that same `create_image_upload` response. A Windows or
   POSIX local path, `file:` URI, public image URL, or signed upload URL is
   invalid.
5. Store the complete verified `image` object returned by completion as the
   image field value in `create_table_row`, `update_table_row`, or an applicable
   bulk row Tool. Do not reduce the object to its URL or path.

### Batch Images

Batch calls preserve input order and return the zero-based input `index` on
each result. The canonical sequence is:

1. Split validated metadata into batches of 1-20 items and call
   `prepare_image_uploads`. Each `files` item contains only `fileName`,
   `fileType`, and `fileSize`.
2. For every item with `ok: true`, match it to its local source using `index`
   and file metadata. Send the exact local bytes outside MCP using that item's
   `upload.method`, `upload.url`, and all `upload.headers`. Use bounded
   concurrency. Do not PUT an item whose preparation failed.
3. Collect only paths whose PUT succeeded. Call `complete_image_uploads` in
   batches of 1-20 unique paths, passing each successful preparation item's
   `image.path`; never pass a local path or any URL.
4. Match completion results by `index` and store each successful item's complete
   verified `image` object in the corresponding Keco row.
5. Read the table rows back with pagination and verify the expected file-name
   keys and complete image objects before reporting success.

The top-level `ok: true` from a batch means item processing ran, not that every
item succeeded. Use `preparedCount` or `completedCount`, `failedCount`, and each
item's discriminated `ok` result to report total or partial completion. Schema
violations reject the whole call; runtime preparation and completion failures
are item-scoped. Retrying preparation creates a new signed target. Retry
completion for an unchanged prepared path only when its earlier result is
unknown or the error permits it; if completion removed an invalid object,
prepare and PUT only that item again.

Signed upload URLs and headers are credentials. Use them only for the PUT and
never persist, print, log, or place them in checkpoints, table rows, or error
reports. The same boundary applies to access tokens and authorization headers.
Checkpoints may retain nonsensitive file metadata, Keco object paths, and
verified image objects.

Completion verifies project isolation, stored size, media type, extension, file
signature, and SVG safety. Static SVG validation rejects scripts, event
handlers, embedded HTML, styles, and external references. Invalid stored
objects are removed before the corresponding error is returned. Every upload
Tool rechecks current project write access.

## Folder Creation

`create_folder` creates one root or nested folder. Only a project owner or an
accepted `admin` collaborator can use it; editors and viewers receive
`PROJECT_WRITE_FORBIDDEN`. Folder creation is non-idempotent, so inspect
`list_project_structure`, preview the intended parent and name, and obtain any
required user confirmation before calling it.

Account endpoint example:

```json
{
  "projectId": "from list_projects",
  "name": "Reference Images",
  "description": "Imported visual references",
  "parentFolderId": null
}
```

For a nested folder, set `parentFolderId` to a folder ID from
`list_project_structure`. On a legacy endpoint, use the same arguments without
`projectId`:

```json
{
  "name": "Characters",
  "parentFolderId": "parent folder ID from list_project_structure"
}
```

After `create_folder` succeeds, call `list_project_structure` again and match
the returned folder's ID, project ID, parent folder ID, and name. Use the folder
as a later table or document target only after that read-back succeeds. Do not
retry a lost mutation response until the read-back proves that the intended
folder was not created. The Tool never overwrites, moves, renames, or deletes an
existing folder.

## Game Design Systems

The GDS tool group supports account-owned systems and explicit project bindings:

- `list_game_design_systems`, `read_game_design_system`, and
  `get_game_design_system_generation` discover owned or visible systems and poll
  generation jobs.
- `create_game_design_system`, `generate_game_design_system`, and
  `create_game_design_system_version` create systems or immutable versions.
  Generation and version creation use their documented idempotency keys.
- `read_project_game_design_system`, `set_project_game_design_system`, and
  `clear_project_game_design_system` read or change one project's pinned system
  version. Binding changes require current owner/admin access.

Owned-system tools do not accept an artificial project selector. On the account
endpoint, the three project-binding tools require `projectId` from
`list_projects`. On a legacy endpoint, omit `projectId`; the endpoint injects
its bound project. After every mutation, poll the generation job when present
and use a fresh read tool call to verify the stable system/version IDs.

GDS tools never delete a system or version. Idempotency conflicts and stale
version parents must be resolved by reading current state; do not retry them
with changed input under the same key.

## Create Map V3

Create Map exposes only schema version 3 through these tools:

- `list_maps` and `read_map` discover saved maps and read the complete current
  Plan, Scene, source document identity, and generation state.
- `create_map_draft` creates a V3 draft from a bounded description or project
  document. Its UUID `idempotencyKey` may be replayed only with identical input.
- `update_map_draft` saves a complete validated V3 Plan and Scene using the
  current `saveVersion`; stale writes return `MAP_REVISION_STALE`.
- `prepare_map_generation`, `start_map_generation`,
  `get_map_generation`, and `retry_map_generation` implement the paid image
  lifecycle described below.

Every Map tool requires `projectId` on the account endpoint. Omit `projectId`
from every Map tool on a legacy endpoint, where the project is already bound.
Viewers discover only `list_maps`, `read_map`, and `get_map_generation`.

Account draft example:

```json
{
  "projectId": "from list_projects",
  "description": "A compact mountain village with readable roads",
  "documentId": null,
  "referenceIds": [],
  "styleReferenceId": null,
  "referenceRoles": {},
  "referenceUsage": {},
  "styleCopy": [],
  "idempotencyKey": "new UUID"
}
```

Use the same `create_map_draft` arguments without `projectId` on a legacy
endpoint. Read the returned map and review its V3 Plan before updating or
preparing generation.

### Paid Map Confirmation

Paid generation is always a two-step operation:

1. Call `prepare_map_generation` with the exact current map ID, revision ID,
   and save version. It freezes that revision, returns the next editable draft,
   immutable generation IDs, a fee notice, expiry, and a short-lived
   confirmation token. It makes no provider request.
2. Show the returned fee notice. The original map request is intent, not paid
   confirmation. Wait for a later explicit confirmation from the user.
3. Only after that confirmation, call `start_map_generation` with the exact
   returned map/revision/asset/generation/fingerprint identity, the token, and
   literal `confirmPaidGeneration: true`. Omitted or false confirmation is
   rejected before provider contact.
4. Poll `get_map_generation` with the same immutable identity until `ready`,
   `failed`, or `blocked`. Then call `read_map` for final read-back before
   reporting success.

Replaying a confirmed start returns the existing job state and does not submit
twice. `retry_map_generation` accepts only safely rejected or provider-identified
failure states. An unknown paid submission outcome is never retried silently:
call `prepare_map_generation` again, show its new fee notice, obtain a new later
confirmation, and let `start_map_generation` verify the `replace-unknown` token.
Tokens, Bearer credentials, provider payloads, and signed image URLs must not be
logged or persisted.

Stable Map failures include `IDEMPOTENCY_CONFLICT`, `MAP_REVISION_STALE`,
`MAP_CONFIRMATION_REQUIRED`, `MAP_CONFIRMATION_EXPIRED`,
`MAP_CONFIRMATION_MISMATCH`, `MAP_GENERATION_BLOCKED`,
`PROVIDER_RATE_LIMITED`, and `PROVIDER_QUOTA_EXCEEDED`. Re-read state after a
conflict rather than inventing a provider operation. MCP does not expose direct
PixelLab tools, map deletion, or public publication semantics.

Real paid acceptance is opt-in and must use a controlled account and project.
Set `KECO_ACCEPTANCE_CREATE_V3=true`, `KECO_ACCEPTANCE_CONFIRM_PAID=true`, and
the documented acceptance project/app variables only when intentionally
spending provider credits. Normal tests and capability probes never perform a
paid request.

## Server Configuration

The Supabase Edge Function requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `KECO_PUBLIC_URL`, `MCP_CURSOR_SECRET`, and
`MCP_CODEC_SECRET`. `KECO_PUBLIC_URL` is the deployed Keco web origin used by the
consent UI, document codec, reindex integration, and other web-backed
operations; protected-resource metadata is served by the Supabase MCP Function
itself. It is currently `https://keco-studio-main.vercel.app`. The same
`MCP_CODEC_SECRET` value must be present in the Supabase Function and Vercel
production environments. The service role key belongs only in the Edge Function
environment.

Semantic search additionally uses `MCP_EMBEDDING_URL`, `MCP_EMBEDDING_KEY`, and
`MCP_EMBEDDING_MODEL`. When any provider value is absent or the provider fails,
the Tool returns `searchMode: "text_fuzzy"` with a stable degradation reason.
It must not claim semantic search in that state.

## Verification Commands

All probe credentials are read only from process environment variables. Never
pass tokens, authorization codes, PKCE verifiers, cookies, or client secrets as
CLI arguments. The probes remove stale evidence before execution and record only
timestamps, pass/fail outcomes, durations, counts, role outcomes, request IDs,
and generated project labels.

```bash
MCP_URL='https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp'
npm run probe:mcp-oauth -- --mcp-url "$MCP_URL" --redirect-uri "$REDIRECT_URI" --output /tmp/mcp-oauth.json
npm run probe:mcp-capabilities -- --mcp-url "$MCP_URL" --output /tmp/mcp-capabilities.json
npm run probe:mcp-performance -- --mcp-url "$MCP_URL" --cold-verified --phase-2 --output /tmp/mcp-performance.json
```

The default OAuth probe verifies protected-resource discovery and dynamic client
registration without claiming that an interactive login succeeded. Add
`--exercise-code-exchange` for real acceptance: the probe opens the authorization
URL in the system browser, listens on the exact `http://127.0.0.1:{port}/`
redirect URI, validates `state`, and exchanges the returned code with the client
registration and PKCE verifier created by that same run. The code and verifier
remain in memory and are never written to evidence or output.

For role enforcement and cross-resource replay, use the capability probe with a
root OAuth token in `MCP_ACCESS_TOKEN`, a mixed-role viewer project supplied by
`--viewer-project-id`, and a legacy URL plus legacy OAuth token in
`--legacy-mcp-url` and `MCP_LEGACY_ACCESS_TOKEN`. Set `MCP_VIEWER_ACCESS_TOKEN`
only when the viewer check must use another account; otherwise the root token is
used. The probe records only the expected denial outcomes. Run the legacy URL
separately to preserve its project-bound capability snapshot:

```bash
LEGACY_MCP_URL='https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/{project-id}'
npm run probe:mcp-capabilities -- --mcp-url "$LEGACY_MCP_URL" --output /tmp/mcp-legacy.json
```

`--exercise-writes` creates uniquely named, non-destructive disposable data. Use
it only in an approved acceptance project. The load probe also supports
`--exercise-rate-limit`; it intentionally consumes a complete search rate bucket.

Local representative fixture setup:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f scripts/fixtures/mcp-phase-2-load.sql
```

The fixture is local-only and isolated under project
`22222222-2222-4222-8222-222222222222`. Do not run it against production.

Operational response and rollback procedures are in
[`operations-runbook.md`](./operations-runbook.md).
