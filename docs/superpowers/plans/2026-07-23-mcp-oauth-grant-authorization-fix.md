# MCP OAuth Grant Authorization Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a real MCP client that completed OAuth with a current project member reach an authorized state, by removing the unsatisfiable OAuth project-grant check and deciding authorization on membership/role alone.

**Architecture:** The Edge Function (`auth.ts`) stops calling `hasOAuthProjectGrant` and proceeds from verified-client + canonical-resource straight to owner/collaborator role resolution under the caller's RLS. The consent page (`OAuthConsentClient.tsx`) treats Supabase's auto-approved `redirect_url` result as success and completes the redirect, and no longer calls the grant RPCs. The grant table/RPCs remain in place but unused.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, Deno test, Next.js, React, Jest, `@supabase/supabase-js` OAuth.

## Global Constraints

- Preserve every existing deny path: missing bearer → `unauthenticated`; invalid token → `unauthenticated`; no verified `clientId` → `forbidden`; non-canonical/cross-project resource → `forbidden` (before any membership query); non-member → `forbidden`; backing query throw → `operational_error`.
- Keep `canonicalProjectResource` as the pre-membership gate.
- Do not change RLS policies, tool surface, or write-path RPCs.
- Do not change Supabase Auth provider configuration.
- Do not delete `mcp_oauth_project_grants` or its RPCs in this plan.
- Never log or persist credential-shaped values.
- All code, identifiers, and comments in English.

---

### Task 1: Remove grant check from Edge authorization gate

**Files:**
- Modify: `supabase/functions/mcp/auth.ts` (interface `AuthGateway`, function `authorizeProjectWithGateway`, `supabaseGateway`)
- Modify: `supabase/functions/mcp/auth.test.ts`

**Interfaces:**
- Consumes: `getUser(token)`, `getProjectOwner(projectId, token)`, `getCollaboratorRole(userId, projectId, token)`, `canonicalProjectResource(url, projectId)`
- Produces: `authorizeProjectWithGateway(request, projectId, gateway)` returning `ProjectAuthorization`, no longer depending on `hasOAuthProjectGrant`. `AuthGateway.hasOAuthProjectGrant` becomes optional/removed.

- [ ] **Step 1: Update the failing tests to the corrected contract**

In `supabase/functions/mcp/auth.test.ts`:

Change the shared `absentProjectAccess` stub to drop the grant member:

```ts
const absentProjectAccess = {
  getProjectOwner: async () => null,
  getCollaboratorRole: async () => null,
};
```

Replace the "revoked project membership" test (which relied on `hasOAuthProjectGrant: async () => true` + null membership) with a membership-only contract, and remove `hasOAuthProjectGrant` from every fixture. Add the core regression test — a valid member with a verified client and canonical resource, with NO grant concept, is authorized:

```ts
Deno.test("authorization authorizes a current member without any grant check", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => "editor",
    },
  );
  assertEquals(result, {
    status: "authorized",
    context: {
      userId: "user-1",
      projectId,
      role: "editor",
      clientId: "oauth-client",
      bearerToken: "token",
    },
  });
});

Deno.test("authorization denies a non-member after client and resource checks", async () => {
  const result = await authorizeProjectWithGateway(
    new Request(canonicalProjectResource, {
      headers: { authorization: "Bearer token" },
    }),
    projectId,
    {
      getUser: async () => ({ id: "user-1", clientId: "oauth-client" }),
      getProjectOwner: async () => null,
      getCollaboratorRole: async () => null,
    },
  );
  assertEquals(result, { status: "forbidden" });
});
```

Also update the three existing happy-path/behavior tests that set `hasOAuthProjectGrant: async () => true` (the "returns current role", "retains verified OAuth client", "canonicalizes gateway path" tests) to simply omit that key. Update the resource-rejection and "no verified client" tests to assert denial WITHOUT a grant stub (they already deny before membership; drop the `hasOAuthProjectGrant` member and any `grantLookups` counters, keeping the resource/clientId assertions).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `PATH="$PWD/node_modules/.bin:$PATH" npm run test:mcp`
Expected: FAIL — `authorizeProjectWithGateway` still references `gateway.hasOAuthProjectGrant`, so fixtures without it either type-error or the gate rejects, and the new member-only test does not reach `authorized`.

- [ ] **Step 3: Remove the grant gate from the implementation**

In `supabase/functions/mcp/auth.ts`, `authorizeProjectWithGateway`: delete the grant block

```ts
    const hasGrant = await gateway.hasOAuthProjectGrant(
      clientId,
      projectId,
      resource,
      token,
    );
    if (!hasGrant) return { status: "forbidden" };
```

so the flow goes directly from the `canonicalProjectResource` check to `getProjectOwner` / `getCollaboratorRole`. Keep the `resource` computation and its `forbidden` guard (it validates the canonical resource). In the `AuthGateway` interface, remove the `hasOAuthProjectGrant` member. In `supabaseGateway`, remove the `hasOAuthProjectGrant` implementation and the now-unused `has_oauth_project_grant` RPC call.

- [ ] **Step 4: Run tests and type check to verify pass**

Run:
```bash
PATH="$PWD/node_modules/.bin:$PATH" npm run check:mcp
PATH="$PWD/node_modules/.bin:$PATH" npm run test:mcp
```
Expected: both exit 0; all `auth.test.ts` cases pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/auth.ts supabase/functions/mcp/auth.test.ts
git commit -m "fix: authorize mcp requests on membership without oauth grant"
```

---

### Task 2: Complete auto-approved consent redirect and drop grant RPC calls

**Files:**
- Modify: `src/components/mcp/OAuthConsentClient.tsx` (imports, load effect near line 87–134, `decide` near line 236–294)
- Modify: `tests/unit/mcp/oauth-consent-behavior.test.ts`

**Interfaces:**
- Consumes: `supabase.auth.oauth.getAuthorizationDetails(id)` returning `{ data: { authorization_id, redirect_url? , ... }, error }`; `window.location.assign(url)`.
- Produces: consent page that, on an auto-approved (`redirect_url`-bearing) load, calls `window.location.assign(redirect_url)`; no calls to `prepareOAuthProjectGrant` / `finalizeOAuthProjectGrant`.

- [ ] **Step 1: Write the failing test**

In `tests/unit/mcp/oauth-consent-behavior.test.ts`, replace the test at line ~305 (`keeps denial available when existing consent bypassed project-bound approval`) with the auto-approve success contract, and stop asserting the grant mocks fire. The harness already stubs `window.location.assign` as `assignLocation` (line ~150, reset at ~219, wired at ~220), so reuse it:

```ts
it('completes the redirect when Supabase has already auto-approved consent', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: {
      ...authorizationDetails('authorization-a'),
      redirect_url: 'https://client.example/callback?code=abc',
    },
    error: null,
  });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();

  expect(assignLocation).toHaveBeenCalledWith(
    'https://client.example/callback?code=abc'
  );
  expect(prepareOAuthProjectGrant).not.toHaveBeenCalled();
  expect(finalizeOAuthProjectGrant).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/mcp/oauth-consent-behavior.test.ts --runInBand -t "auto-approved"`
Expected: FAIL — current load effect sets the `'Existing OAuth consent bypassed...'` error instead of calling `assign`.

- [ ] **Step 3: Write the minimal implementation**

In `src/components/mcp/OAuthConsentClient.tsx` load effect, immediately after confirming `next.authorization_id === authorizationId`, complete an auto-approved authorization before any grant/project work:

```ts
      if (next.redirect_url) {
        window.location.assign(next.redirect_url);
        return;
      }
```

Remove the later `if (next.redirect_url) { ...'bypassed'... }` guard block. Remove the `prepareOAuthProjectGrant` call block in `decide` (near line 236) and the `finalizeOAuthProjectGrant` call block (near line 275). Remove the now-unused import:

```ts
import {
  finalizeOAuthProjectGrant,
  prepareOAuthProjectGrant,
} from '@/lib/mcp/oauthProjectGrant';
```

Keep the `AuthSessionMissingError` sign-in redirect (line ~89), the resource/project-binding verification, and the manual Approve/Deny fallback UI (now grant-free) unchanged.

- [ ] **Step 4: Run the focused and file suites to verify pass**

Run:
```bash
npx jest tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts --runInBand
```
Expected: exit 0. Sibling tests in the same file assert grant calls — the approve-path test near line ~351/363 checks `prepareOAuthProjectGrant`/`finalizeOAuthProjectGrant` were called with ordering. Remove those grant assertions (and the `invocationCallOrder` checks), keeping the `assignLocation` redirect assertion, so the approve path is validated grant-free.

- [ ] **Step 5: Commit**

```bash
git add src/components/mcp/OAuthConsentClient.tsx tests/unit/mcp/oauth-consent-behavior.test.ts
git commit -m "fix: complete auto-approved mcp consent without project grant"
```

---

### Task 3: Full verification and end-to-end gate

**Files:**
- No source changes; verification only. Touches none unless a gap is found.

**Interfaces:**
- Consumes: everything from Tasks 1–2.
- Produces: green type check, Deno tests, MCP Jest suites, and a documented real-client result.

- [ ] **Step 1: Repository verification**

Run:
```bash
PATH="$PWD/node_modules/.bin:$PATH" npm run check:mcp
PATH="$PWD/node_modules/.bin:$PATH" npm run test:mcp
npx jest tests/unit/mcp --runInBand
npx jest tests/unit/database/oauth-authorization tests/unit/database/mcp --runInBand
```
Expected: all exit 0. The DB suites still pass because the grant RPCs remain defined (unused).

- [ ] **Step 2: Local serve smoke (documents the deno.lock blocker)**

Set the lockfile aside (version 5 vs Edge Runtime's Deno 2.1.4), serve, and confirm boot:

```bash
mv supabase/functions/mcp/deno.lock /tmp/keco-mcp-deno.lock.bak
supabase functions serve mcp --env-file supabase/functions/.env.local --no-verify-jwt
```

After verification, restore: `mv /tmp/keco-mcp-deno.lock.bak supabase/functions/mcp/deno.lock`. Note this blocker in the PR description so platform deploy (its own Deno) is distinguished from local serve.

- [ ] **Step 3: Real-client end-to-end gate (release gate, post-deploy)**

With a deployed build, a client (Claude Code custom HTTP connector or Codex) using an account that is a current member of the target project must:
- complete OAuth and list tools,
- `keco_connection_probe` → `ok` / `phase 2`,
- `list_project_structure` → bound project structure,
- a non-member account is denied (403),
- unauthenticated / invalid-token / non-canonical-resource / downgraded-role requests remain denied,
- no credential-shaped values appear in logs or evidence.

- [ ] **Step 4: Final commit / PR**

Push the branch, open a PR summarizing: root cause (auto-consent vs pending-grant deadlock), the membership-only authorization contract, the unused grant table left for a follow-up additive migration, and the deno.lock local-serve caveat.
