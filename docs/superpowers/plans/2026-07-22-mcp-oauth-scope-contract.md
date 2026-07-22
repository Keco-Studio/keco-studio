# MCP OAuth Scope Contract Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Keco's protected-resource metadata from requesting OAuth scopes that the configured Supabase authorization server cannot issue.

**Architecture:** Keep project authorization in the existing resource binding, consent verification, bearer-token validation, and project membership checks. Omit the optional `scopes_supported` field because Supabase cannot issue the advertised application scopes and Keco does not use OIDC identity scopes as resource permissions.

**Tech Stack:** Next.js, TypeScript, Jest, Supabase OAuth Server, MCP OAuth protected-resource metadata.

## Global Constraints

- Preserve exact project resource binding through the OAuth authorization request.
- Preserve membership authorization and the Phase 1 read-only tool surface.
- Do not expose or persist OAuth credentials.
- Change no Supabase Auth provider configuration except through the separately verified stable Site URL operational fix.

---

### Task 1: Align Protected-Resource Scope With Supabase Discovery

**Files:**
- Modify: `tests/unit/mcp/oauth-metadata.test.ts`
- Modify: `tests/unit/mcp/oauth-consent-behavior.test.ts`
- Modify: `src/lib/mcp/oauthMetadata.ts`

**Interfaces:**
- Consumes: `buildProtectedResourceMetadata({ resource, authorizationServer })`
- Produces: RFC 9728 metadata without an unsupported `scopes_supported` claim

- [x] **Step 1: Write the failing test**

Remove `scopes_supported` from both expected protected-resource metadata objects and add:

```ts
expect(metadata).not.toHaveProperty('scopes_supported');
```

Use an empty scope in the consent behavior fixture so membership checks and approval are exercised against the deployed no-scope contract.

- [x] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/mcp/oauth-metadata.test.ts --runInBand`

Expected: FAIL because the implementation still returns `['mcp:read', 'mcp:write']`.

- [x] **Step 3: Write the minimal implementation**

Update `buildProtectedResourceMetadata` so the returned object contains only:

```ts
resource,
authorization_servers,
bearer_methods_supported,
```

- [x] **Step 4: Run focused and repository verification**

Run:

```bash
npx jest tests/unit/mcp/oauth-metadata.test.ts --runInBand
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 5: Deploy and verify the live contract**

After merging and the production deployment succeeds, verify that the resource metadata omits `scopes_supported`, Codex 0.145 includes the project `resource` without an unsupported `scope`, OAuth approval completes, and `initialize`, `tools/list`, and `keco_connection_probe` succeed without logging credentials.
