# Keco MCP OAuth Grant Authorization Fix Design

**Date:** 2026-07-23
**Status:** Proposed, pending review
**Supersedes:** The project-grant enforcement in section 5.3 of `2026-07-21-supabase-mcp-server-design.md`
**Production target:** Supabase project `lulrcirmwwvvnupmwqcq`, Vercel `https://keco-studio-main.vercel.app`
**Production acceptance project:** `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`

## 1. Problem

Every real MCP client (Claude Code, Codex, or a manually completed OAuth flow)
receives `403 Project access forbidden` after obtaining a valid access token.
The client happy path — `initialize`, `tools/list`, and any tool call — has
never succeeded against production for any user. This blocks the entire purpose
of the feature: letting external clients read Keco project data over MCP.

The failure was masked because every automated gate bypasses the real
authorization path:

- Deno and Jest unit tests mock `getAuthorizationDetails` and the auth gateway.
- Database behavior tests connect with `set role authenticated` and
  `set_config('request.jwt.claim.sub', ...)`, exercising RLS and RPCs directly
  without OAuth or the grant table.
- Probes assert discovery, capabilities, and latency, not an end-to-end
  authorized tool call driven by a real consent.

CI never deploys or serves the Edge Function, so the runtime authorization path
was never executed before production.

## 2. Root Cause

The `mcp_oauth_project_grants` table and its `has_oauth_project_grant` check are
residue from a superseded scope design. The chain:

1. **Original design (5.3/5.4):** custom scopes `mcp:read` / `mcp:write`, with a
   separate revocable grant table as the fallback for "if the deployed OAuth
   server cannot encode the project grant in its native authorization record."
2. **Scope reversal (#250, `0468f8b4`):** Supabase's OAuth server cannot issue
   custom application scopes, so Keco dropped to identity scopes only
   (`openid`, `profile`, `email`). `scopes_supported` was removed from the
   protected-resource metadata.
3. **Unreconciled consequence:** Supabase's OAuth server **auto-approves**
   requests that carry only identity scopes. Per Supabase Auth documentation, a
   `getAuthorizationDetails` call returns a `redirect_url` immediately when the
   user "has already consented," which is the auto-approved state. Verified
   empirically: a freshly registered client's first authorization returns a
   `redirect_url` on the very first `getAuthorizationDetails` call.

Because the authorization request is never in `status = 'pending'`:

- `OAuthConsentClient.tsx` (current line ~127) sees `next.redirect_url`, sets
  `'Existing OAuth consent bypassed the project-bound approval step.'`, and
  never renders an enabled Approve button.
- `prepare_oauth_project_grant` (migration `20260722040000`, line ~70) requires
  `oa.status = 'pending'` and would refuse to write even if called.

So `mcp_oauth_project_grants` is always empty. `auth.ts` (current lines
~119–125) hard-fails every request on `hasOAuthProjectGrant`, producing 403 for
all legitimate users.

## 3. Security Analysis

Removing the grant check does **not** lower real security. The independent and
sufficient boundary is the membership/role check in `auth.ts` (current lines
~126–141, implemented by `getProjectOwner` and `getCollaboratorRole` in
`supabaseGateway`):

- Both queries run with the caller's own JWT (`Authorization: Bearer ${token}`),
  so RLS applies. A user cannot resolve a project or collaborator row they do
  not have access to.
- `getCollaboratorRole` filters `.not('accepted_at', 'is', null)`, so only
  accepted memberships count.
- The check runs on every request, so a role downgrade or collaborator removal
  takes effect on the next request regardless of token expiry — the exact
  property required by section 5.4 of the original design.

The grant check sits *on top of* this boundary. In the current architecture it
cannot be satisfied and only produces 100% false denials. The effective
permission model reduces from `token scope ∩ project grant ∩ current role` to
`current role` (validated against a live membership under RLS), because the
scope dimension no longer exists and the grant dimension is unreachable.

## 4. Goals

- A client that completes OAuth with an account that is a current member of the
  bound project can call `initialize`, `tools/list`, `keco_connection_probe`,
  and the role-appropriate read/write tools.
- Authorization is decided solely by valid bearer token, verified OAuth client
  identity, canonical project resource, and current project membership/role.
- No reduction in the deny paths that actually protect data: non-members,
  invalid/absent tokens, tokens without a verified OAuth client, non-canonical
  resources, and downgraded roles are still denied.

## 5. Non-Goals

- Re-enabling custom OAuth scopes (Supabase does not support them).
- Changing the tool surface, RLS policies, or the write-path RPCs.
- Changing Supabase Auth provider configuration.
- Deleting the `mcp_oauth_project_grants` table or its RPCs in this change (they
  become unused; removal is a separate, additive-migration decision).

## 6. Approach

Remove the grant requirement from the Edge Function authorization gate and let
membership/role be the deciding factor.

### 6.1 Edge authorization (`supabase/functions/mcp/auth.ts`)

In `authorizeProjectWithGateway`, keep the existing ordered checks up to and
including the verified OAuth client and canonical resource, then skip the
`hasOAuthProjectGrant` gate and proceed directly to owner/collaborator role
resolution. Preserve exactly:

- `unauthenticated` when the bearer is missing or the user/token is invalid.
- `forbidden` when there is no verified `clientId`.
- `forbidden` when `canonicalProjectResource` rejects the request URL.
- `forbidden` when the user is neither owner nor an accepted collaborator.
- `operational_error` when a backing query throws.

The `AuthGateway` interface keeps `hasOAuthProjectGrant` optional or removes it;
`supabaseGateway` no longer calls `has_oauth_project_grant`. The canonical
resource validation stays as the pre-membership gate so non-canonical and
cross-project resources are still rejected before any membership query.

### 6.2 Consent page (`src/components/mcp/OAuthConsentClient.tsx`)

Because Supabase auto-approves identity-scope requests, `getAuthorizationDetails`
returns a `redirect_url` on first load. That `redirect_url` already carries the
authorization `code`; the OAuth decision is complete on Supabase's side. The
consent page must therefore **treat a `redirect_url`-bearing result as success
and complete the redirect** (`window.location.assign(redirect_url)`), instead of
raising `'Existing OAuth consent bypassed the project-bound approval step.'`
(current guard near line 127) and stranding the user.

Concretely:

- On load, if `getAuthorizationDetails` returns a `redirect_url`, immediately
  complete the redirect. This is the auto-approved happy path.
- Remove the `prepareOAuthProjectGrant` / `finalizeOAuthProjectGrant` calls; the
  grant table is no longer consulted by the Edge Function.
- Keep the `AuthSessionMissingError` → sign-in redirect branch (line ~89)
  unchanged.
- The manual Approve/Deny UI becomes a fallback only reached if Supabase ever
  returns a genuinely `pending` request; it no longer touches the grant table.

No code path depends on a `pending` authorization to reach a working end state.

### 6.3 Grant table and RPCs

Left in place but unused. `has_oauth_project_grant`, `prepare_oauth_project_grant`,
and `finalize_oauth_project_grant` are no longer called by the Edge Function or
the consent page. A follow-up additive migration may drop them after this fix is
verified in production; this design does not remove them.

## 7. Test Strategy

TDD, one failing test first at each layer.

### 7.1 Edge unit tests (`supabase/functions/mcp/auth.test.ts`)

The current suite encodes the broken contract (`hasOAuthProjectGrant: async () =>
true` in the happy-path fixtures, and a "revoked membership → forbidden" test
that relies on grant=true). Update to the corrected contract:

- **New failing test (the regression this fix targets):** a valid member with a
  verified client and canonical resource, **without** any grant concept, is
  `authorized` with the correct role. This fails today because the gate calls
  `hasOAuthProjectGrant`.
- Owner → `admin`.
- Accepted collaborator → their role (`viewer` / `editor` / `admin`).
- Non-member (owner null, role null) → `forbidden`.
- Missing bearer → `unauthenticated`; invalid token → `unauthenticated`.
- No verified `clientId` → `forbidden`, before any membership query.
- Non-canonical / cross-project / query / credential / fragment resources →
  `forbidden`, before any membership query (preserve existing coverage).
- Backing query throws → `operational_error`.

Fixtures drop `hasOAuthProjectGrant` from the gateway stub.

### 7.2 Consent behavior tests (`tests/unit/mcp/oauth-consent-behavior.test.ts`)

Update to reflect that an auto-approved authorization reaches a working end
state (informational render and/or redirect completion), not the
`'... bypassed the project-bound approval step.'` error.

### 7.3 Type and full suite

`npm run check:mcp`, `npm run test:mcp`, and the MCP Jest suites must pass.

## 8. Verification Gates (Release)

The fix is not complete until, against production or a faithful local serve:

1. A real client (Claude Code custom HTTP connector or Codex) completes OAuth
   with a member account and lists tools.
2. `keco_connection_probe` returns `ok` / `phase 2`.
3. `list_project_structure` returns the bound project's structure.
4. A non-member account is denied (`403`) end to end.
5. Unauthenticated, invalid-token, non-canonical-resource, and downgraded-role
   requests remain denied.
6. No credential-shaped values appear in logs or evidence.

## 9. Risks

- **Local serve blocker:** `deno.lock` is version 5 but the Supabase Edge
  Runtime bundles Deno 2.1.4, which cannot read it (`BOOT_ERROR`). Local
  verification requires temporarily setting the lockfile aside or aligning the
  Deno/runtime versions. This is a test-environment risk, not a production one
  (platform deploy uses its own Deno).
- **Perceived security reduction:** reviewers may read grant removal as a
  weakening. Section 3 is the mitigation: membership/RLS is the true boundary
  and was always the enforcing layer.
- **Consent page semantics:** the page's original intent (project-named manual
  approval) cannot be honored while Supabase auto-approves identity scopes. This
  design accepts an informational consent page; a future change could restore a
  manual approval step only if a pending authorization becomes achievable.
