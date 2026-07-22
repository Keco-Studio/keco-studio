# Keco MCP

Keco exposes one project-bound MCP endpoint per project:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/{project-id}
```

The project ID in the URL is the only project selector. Tool inputs and Resource
URIs do not accept a project ID. OAuth establishes identity; Keco rechecks the
current project membership and role on every request. Supabase identity scopes
such as `openid`, `profile`, `email`, and `phone` do not grant Keco permissions.
Do not configure custom `mcp:read` or `mcp:write` scopes.

## Client Setup

Use the exact project endpoint as a remote Streamable HTTP MCP server. Codex and
Claude should discover OAuth from the endpoint's `WWW-Authenticate` challenge.
Complete authorization in the browser with the Keco account that belongs to the
bound project. The consent page must name that project.

For Codex, add a remote MCP server whose URL is the project endpoint. Do not add
an authorization header manually; allow Codex to run OAuth and retain its own
refresh token. For Claude, add the same URL as a custom remote connector and use
the browser OAuth flow. Client configuration files and screenshots must never be
committed when they contain access tokens, refresh tokens, client secrets,
authorization codes, or PKCE values.

An editor or admin discovers the connection probe, five read Tools, and five
non-destructive write Tools. A viewer discovers the probe and five read Tools.
All authorized roles discover three entry Resources, four Resource templates,
and three static Prompts. A role downgrade or membership removal applies on the
next request even if the client's access token has not expired.

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

All probe commands read `MCP_ACCESS_TOKEN` only from the process environment.
They remove stale evidence before execution and never include the token in output.

```bash
npm run probe:mcp-oauth -- --mcp-url "$MCP_URL" --redirect-uri "$REDIRECT_URI" --output /tmp/mcp-oauth.json
npm run probe:mcp-capabilities -- --mcp-url "$MCP_URL" --output /tmp/mcp-capabilities.json
npm run probe:mcp-performance -- --mcp-url "$MCP_URL" --cold-verified --phase-2 --output /tmp/mcp-performance.json
npm run probe:mcp-load -- --mcp-url "$MCP_URL" --fixture-manifest scripts/fixtures/mcp-phase-2-load.json --output /tmp/mcp-load.json
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
