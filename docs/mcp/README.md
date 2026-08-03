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
the requested section, or to `section1` when no section is supplied.

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

## Image Uploads

The MCP image write flow stores raster images in the existing public
`library-media-files` bucket without putting binary data inside the bounded MCP
JSON request:

1. Ensure the target table has an image field, either in `create_table.fields`
   or with `add_table_field`.
2. Call `create_image_upload` with `projectId` on the account endpoint (omit it
   on a legacy project endpoint), plus `fileName`, `fileType`, and `fileSize`.
3. Send the raw image bytes with HTTP `PUT` to the returned `upload.url`, using
   the returned headers. The signed target expires after two hours.
4. Call `complete_image_upload` with the returned image `path`. Use the verified
   `image` object from this response as the value passed to
   `update_table_row` for an image field.

Uploads are isolated under the current user and project, limited to 5 MiB, and
accept PNG, JPEG, GIF, WebP, and static SVG. SVG completion rejects scripts,
event handlers, embedded HTML, styles, and external references before returning
metadata. Completion verifies the stored size, media type, file signature,
extension, and project path; invalid objects are removed before an error is
returned. Both tools recheck write access on every account-scoped call.

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
