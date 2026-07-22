# MCP OAuth Resource Binding Design

## Problem

Supabase Auth accepts and stores the OAuth 2.0 Resource Indicator from the
authorization request, but its public authorization-details response omits the
stored `resource`. Keco's consent UI currently expects that response to contain
`resource`, so every correctly project-bound request is rejected.

The fix must preserve project-specific informed consent and must not weaken the
MCP endpoint's existing bearer-token, membership, role, or tool checks.

## Chosen Design

Add a narrowly scoped `security definer` database function that returns the
stored resource for one OAuth authorization only when all of these conditions
hold:

- the caller has an authenticated Supabase user ID;
- the authorization ID matches exactly;
- the authorization belongs to the caller;
- the authorization is pending; and
- the authorization has not expired.

The function returns at most one nullable text value, exposes no authorization
code, PKCE value, client secret, state, redirect URI, or other Auth data, and is
executable only by the `authenticated` role. Its `search_path` is empty and all
objects are schema-qualified.

## Consent Flow

1. The consent page calls Supabase Auth `getAuthorizationDetails`. This binds a
   previously unclaimed authorization to the current user and supplies the
   supported client, user, and scope details.
2. The page calls the new RPC with the same authorization ID.
3. The existing strict parser extracts a project ID only from the exact main
   Supabase MCP resource URL.
4. The page verifies that the current user can access that project before
   enabling approval.
5. Immediately before approval, the page repeats both the Auth details lookup
   and the resource RPC, compares them with the verified binding, and rechecks
   project membership.
6. Supabase performs the approval and later validates the resource again during
   authorization-code exchange. The MCP Edge Function continues to enforce
   current membership and role on every tool call.

Any missing, malformed, expired, reassigned, or changed binding fails closed and
keeps approval disabled. Denial remains available after a valid authorization
request is loaded.

## Compatibility And Risk

This design depends on Supabase Auth's internal `auth.oauth_authorizations`
table because the current public consent API omits `resource`. The dependency is
isolated to one migration function and covered by a live database contract test,
so a future Supabase schema change fails visibly instead of silently weakening
authorization.

No custom OAuth scopes are introduced. Protected-resource metadata continues to
omit unsupported scopes, while Codex may request Supabase's supported identity
scopes.

## Verification

- Migration contract tests verify grants, function security settings, caller
  ownership, pending status, expiry, and exact returned resource.
- Consent behavior tests use the real Supabase response shape without a
  fabricated `resource` property and cover initial binding plus pre-approval
  revalidation.
- Existing MCP unit tests, typecheck, build, and Playwright CI must pass.
- Production verification must show an authorization URL with the project
  `resource`, a consent page naming the bound project, a successful callback,
  and authenticated MCP `initialize`, `tools/list`, and connection probe calls.
