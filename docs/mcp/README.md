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

## Server Configuration

The Supabase Edge Function requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `KECO_PUBLIC_URL`, `MCP_CURSOR_SECRET`, and
`MCP_CODEC_SECRET`. `KECO_PUBLIC_URL` is the deployed Keco web origin, currently
`https://keco-studio-main.vercel.app`. The same `MCP_CODEC_SECRET` value must be
present in the Supabase Function and Vercel production environments. The service
role key belongs only in the Edge Function environment.

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
