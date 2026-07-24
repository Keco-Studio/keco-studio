# Supabase-Hosted MCP OAuth Metadata Design

**Date:** 2026-07-24
**Status:** Approved

## Problem

The production MCP Edge Function currently challenges unauthenticated clients
with protected-resource metadata hosted by the Keco Vercel application:

```text
WWW-Authenticate: Bearer resource_metadata="https://keco-studio-main.vercel.app/api/mcp/oauth-protected-resource"
```

This makes OAuth discovery depend on two independently reachable hosts before a
client can begin authorization. The affected Linux VM can reach the Supabase MCP
endpoint but cannot complete TLS or direct routing to the Vercel host. Codex
therefore reports `No authorization support detected`, while the same MCP server
works from Windows on a network path that can reach both hosts.

## Goal

Serve protected-resource metadata from the existing Supabase MCP Edge Function
so OAuth discovery requires only the MCP host. Preserve Supabase Auth as the
authorization server and preserve the existing Vercel consent UI, OAuth grants,
tokens, project authorization, and MCP protocol behavior.

## Non-Goals

- Moving the OAuth consent UI from Vercel to Supabase.
- Changing the Supabase Auth authorization server or OAuth scopes.
- Changing account-scoped or legacy project-scoped authorization semantics.
- Removing the existing Vercel metadata route.
- Working around unrelated VM proxy, DNS, or browser-launch configuration.

## Architecture

The Supabase `mcp` Edge Function will expose protected-resource metadata at:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/oauth-protected-resource
```

The route accepts `GET` without bearer authentication. With no query parameter,
it returns metadata for the account-scoped MCP resource. With a valid
`project_id` query parameter, it returns metadata for the corresponding legacy
project-scoped resource.

The existing Vercel route remains available for compatibility but is no longer
advertised by new MCP authentication challenges.

## Request Flow

```text
Codex calls the Supabase MCP endpoint without a token
  -> MCP returns 401 with Supabase-hosted resource_metadata
  -> Codex fetches protected-resource metadata from Supabase
  -> metadata identifies the existing Supabase Auth authorization server
  -> Codex performs OAuth discovery and dynamic client registration
  -> the user's browser completes the existing Keco consent flow
  -> Codex exchanges the code and calls the unchanged MCP endpoint
```

Only the discovery document moves. Interactive authorization may still use the
configured Vercel application because that step occurs in the user's browser.

## Components

### Edge metadata builder

Add a small Edge-compatible metadata builder next to the MCP HTTP transport. It
will:

- normalize the configured Supabase origin;
- build the exact account or legacy project resource URL;
- identify `${SUPABASE_ORIGIN}/auth/v1` as the authorization server;
- advertise header bearer authentication;
- omit unsupported custom scopes;
- reject malformed origins and project IDs.

The returned JSON contract remains equivalent to the existing Next.js metadata
route:

```json
{
  "resource": "https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp",
  "authorization_servers": [
    "https://lulrcirmwwvvnupmwqcq.supabase.co/auth/v1"
  ],
  "bearer_methods_supported": ["header"]
}
```

### Edge metadata route

Handle the exact `GET /mcp/oauth-protected-resource` Edge Function path before
normal MCP endpoint classification and authorization. The public Supabase path
may retain the `/functions/v1` prefix while direct Edge requests may omit it, so
both gateway forms must map to the same exact metadata route.

The route will return:

- `200` and account metadata when `project_id` is absent;
- `200` and legacy project metadata for one valid UUID `project_id`;
- `400` for an invalid, duplicated, or unexpected query parameter;
- `500` when the Supabase origin is missing or invalid;
- CORS and `Cache-Control: public, max-age=300` headers on successful metadata.

It must not accept trailing path segments, credentials, fragments, or unrelated
methods as metadata requests.

### Authentication challenge

For unauthenticated account requests, the Edge Function will advertise:

```text
Bearer resource_metadata="https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/oauth-protected-resource"
```

Legacy project requests will advertise the same route with the exact project ID
as a query parameter. Challenge construction will derive the public Supabase
origin from `SUPABASE_URL`; it will no longer use `KECO_PUBLIC_URL`.

`KECO_PUBLIC_URL` remains required by the document codec, reindex integration,
and any other existing Vercel-backed Edge behavior. This change removes it only
from protected-resource discovery.

### Vercel compatibility route

Keep `src/app/api/mcp/oauth-protected-resource/route.ts` and its public behavior
unchanged. Existing clients that cached or retained its URL can continue to use
it. New challenges will point to the Supabase-hosted route.

## Error Handling

Metadata requests fail closed and never fall through to bearer authorization or
MCP protocol handling. Invalid metadata input returns a bounded JSON error with
the existing CORS policy. Missing server configuration returns a generic error
without exposing environment values.

Unauthenticated MCP requests return `500` only when the Supabase origin cannot
be safely normalized. Valid deployments continue to return the standard `401`
challenge.

## Testing

Extend the Deno MCP HTTP tests before implementation to cover:

- account metadata from the Supabase route;
- legacy project metadata from the Supabase route;
- challenge URLs for account and legacy MCP endpoints;
- metadata parity with the existing JSON contract;
- valid gateway and direct Edge path forms;
- invalid project IDs, duplicate or unknown query parameters, and trailing
  paths;
- missing or malformed Supabase configuration;
- CORS and cache headers;
- proof that metadata requests bypass bearer authorization and MCP protocol
  handlers;
- proof that ordinary MCP requests retain their existing behavior.

Retain the existing Next.js metadata tests as compatibility coverage. Run the
focused Deno suite, MCP checks, unit tests for the Vercel route, and TypeScript
type checking.

## Deployment And Acceptance

Deploy the updated `mcp` Edge Function with `--no-verify-jwt`. No database
migration or Vercel deployment is required for the functional change.

Production acceptance requires:

1. The unauthenticated MCP endpoint advertises the Supabase metadata URL.
2. The Supabase metadata URL returns the correct account resource and Supabase
   Auth authorization server without authentication.
3. `codex mcp login keco-account` advances past discovery on the affected VM.
4. Windows OAuth remains functional.
5. An authorized client can initialize MCP and call `list_projects`.

## Rollback

Redeploy the previous Edge Function version. The unchanged Vercel metadata route
remains available throughout deployment and rollback.
