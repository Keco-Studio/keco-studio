# MCP OAuth Resource Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover Supabase's stored OAuth resource securely so Keco can show and enforce the project-bound consent flow.

**Architecture:** A `security definer` RPC reads one pending, unexpired authorization resource only for its authenticated owner. A focused TypeScript adapter normalizes the scalar RPC response, and the consent component combines the public Supabase authorization details with that resource before both initial membership verification and approval-time revalidation.

**Tech Stack:** PostgreSQL migrations, Supabase Auth/PostgREST RPC, TypeScript, React 19, Jest 30.

## Global Constraints

- Do not expose authorization codes, PKCE values, OAuth state, redirect URIs, client secrets, or unrelated Auth records.
- Approval must fail closed if the binding is missing, malformed, expired, reassigned, or changed.
- Keep the existing MCP bearer-token, project membership, role, and tool checks unchanged.
- Do not add unsupported custom OAuth scopes.
- Work only in `/home/hetu/project/keco-studio/.worktrees/mcp-oauth-scope-fix` on branch `mcp-oauth-resource-binding`.

---

### Task 1: Owner-Bound OAuth Resource RPC

**Files:**
- Create: `supabase/migrations/20260722000000_get_oauth_authorization_resource.sql`
- Create: `tests/unit/database/oauth-authorization-resource-migration.test.ts`
- Create: `tests/unit/database/oauth-authorization-resource.behavior.test.ts`

**Interfaces:**
- Consumes: Supabase-managed `auth.oauth_authorizations` columns `authorization_id`, `user_id`, `resource`, `status`, and `expires_at`; `auth.uid()`.
- Produces: `public.get_oauth_authorization_resource(p_authorization_id text) returns text` executable only by `authenticated`.

- [ ] **Step 1: Write the failing migration contract test**

Create a Jest test that reads the exact migration file and requires:

```ts
expect(sql).toMatch(/security definer/i);
expect(sql).toMatch(/set search_path\s*=\s*''/i);
expect(sql).toContain('auth.oauth_authorizations');
expect(sql).toMatch(/oa\.user_id\s*=\s*auth\.uid\(\)/i);
expect(sql).toMatch(/oa\.status\s*=\s*'pending'/i);
expect(sql).toMatch(/oa\.expires_at\s*>\s*now\(\)/i);
expect(sql).toMatch(/REVOKE ALL[\s\S]*FROM PUBLIC/i);
expect(sql).toMatch(/GRANT EXECUTE[\s\S]*TO authenticated/i);
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npx jest tests/unit/database/oauth-authorization-resource-migration.test.ts --runInBand`

Expected: FAIL because `20260722000000_get_oauth_authorization_resource.sql` does not exist.

- [ ] **Step 3: Add the minimal hardened migration**

```sql
CREATE OR REPLACE FUNCTION public.get_oauth_authorization_resource(
  p_authorization_id TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT oa.resource
  FROM auth.oauth_authorizations AS oa
  WHERE auth.uid() IS NOT NULL
    AND oa.authorization_id = p_authorization_id
    AND oa.user_id = auth.uid()
    AND oa.status = 'pending'
    AND oa.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_oauth_authorization_resource(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_oauth_authorization_resource(TEXT) TO authenticated;
```

- [ ] **Step 4: Add a local Supabase behavior test**

Under the existing `RLS_DB_TESTS_ENABLED` gate, dynamically register an OAuth public client, create pending authorization requests with unique PKCE challenges, associate them by calling `getAuthorizationDetails` as the intended fixture user, and assert:

```ts
await expect(readResource(owner.client, ownerAuthorizationId)).resolves.toBe(ownerResource);
await expect(readResource(outsider.client, ownerAuthorizationId)).resolves.toBeNull();
await expect(readResource(owner.client, outsiderAuthorizationId)).resolves.toBeNull();
await expect(readResource(anonClient(), ownerAuthorizationId)).rejects.toMatchObject({
  message: expect.any(String),
});
```

Use only the local Supabase URL and keys guarded by `rlsTestClient.ts`. Do not log authorization codes, tokens, PKCE verifiers, or full JWTs.

- [ ] **Step 5: Reset local Supabase and verify GREEN**

Run: `supabase db reset`, then the migration contract test and `RLS_DB_TESTS=1 npx jest tests/unit/database/oauth-authorization-resource.behavior.test.ts --runInBand`.

Expected: migration and behavior suites PASS.

- [ ] **Step 6: Commit Task 1**

Commit message: `feat: expose owner-bound oauth resource`.

### Task 2: OAuth Resource RPC Adapter

**Files:**
- Create: `src/lib/mcp/oauthAuthorizationResource.ts`
- Create: `tests/unit/mcp/oauth-authorization-resource.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient.rpc('get_oauth_authorization_resource', { p_authorization_id: string })`.
- Produces: `getOAuthAuthorizationResource(supabase: SupabaseClient, authorizationId: string): Promise<string | null>`.

- [ ] **Step 1: Write failing adapter tests**

Cover a scalar string, `null`, malformed non-string data, and an RPC error. Assert the exact RPC name and parameter object.

```ts
await expect(getOAuthAuthorizationResource(client, 'auth-1')).resolves.toBe(resource);
await expect(getOAuthAuthorizationResource(client, 'auth-1')).resolves.toBeNull();
await expect(getOAuthAuthorizationResource(client, 'auth-1')).rejects.toBe(rpcError);
```

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `npx jest tests/unit/mcp/oauth-authorization-resource.test.ts --runInBand`.

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Implement the minimal adapter**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getOAuthAuthorizationResource(
  supabase: SupabaseClient,
  authorizationId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_oauth_authorization_resource', {
    p_authorization_id: authorizationId,
  });
  if (error) throw error;
  return typeof data === 'string' ? data : null;
}
```

- [ ] **Step 4: Run the adapter test and verify GREEN**

Run: `npx jest tests/unit/mcp/oauth-authorization-resource.test.ts --runInBand`.

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Commit message: `feat: load oauth authorization resource`.

### Task 3: Consent Binding And Revalidation

**Files:**
- Modify: `src/components/mcp/OAuthConsentClient.tsx`
- Modify: `tests/unit/mcp/oauth-consent-behavior.test.ts`
- Modify: `tests/unit/mcp/oauth-consent-wiring.test.ts`

**Interfaces:**
- Consumes: `getAuthorizationDetails(authorizationId)` without a `resource` field and `getOAuthAuthorizationResource(supabase, authorizationId)`.
- Produces: a `LoadedRequest` containing public authorization details plus the independently loaded resource, with approval enabled only after strict resource parsing and project membership verification.

- [ ] **Step 1: Change consent fixtures to the real Supabase response shape**

Remove the fabricated `resource` property from `authorizationDetails`. Mock `getOAuthAuthorizationResource` and add assertions that approval stays disabled when it returns `null`, a malformed URL, or a different resource during approval-time reload.

For the successful path:

```ts
getOAuthAuthorizationResource
  .mockResolvedValueOnce(projectResource(PROJECT_A))
  .mockResolvedValueOnce(projectResource(PROJECT_A));
```

- [ ] **Step 2: Run consent tests and verify RED**

Run: `npx jest tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts --runInBand`.

Expected: FAIL because the component still reads `details.resource` and never calls the RPC adapter.

- [ ] **Step 3: Load and bind the resource after public details**

Import the adapter. Change `BoundDetails` to require `resource: string`, then after validating public details call:

```ts
const resource = await getOAuthAuthorizationResource(supabase, authorizationId);
if (!active) return;
const boundProjectId = projectIdFromOAuthResource(resource);
```

Construct the stored request with `details: { ...next, resource }`. Treat adapter errors like missing bindings and keep approval disabled.

- [ ] **Step 4: Re-read the resource immediately before approval**

In the existing approval-time `try`, load both latest public details and latest resource. Require the same authorization ID, absence of `redirect_url`, exact resource equality, the same parsed project ID, and a fresh successful project lookup before calling `approveAuthorization`.

- [ ] **Step 5: Run consent and MCP unit tests**

Run: `npx jest tests/unit/mcp --runInBand`.

Expected: all MCP unit tests PASS and successful consent tests assert two resource RPC calls.

- [ ] **Step 6: Commit Task 3**

Commit message: `fix: recover project binding for oauth consent`.

### Task 4: Full Verification And Production Rollout

**Files:**
- Modify only files required by review findings.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: reviewed PR, passing required checks, deployed main migration/application, and verified real OAuth flow.

- [ ] **Step 1: Run local verification**

Run `npm run typecheck`, `npm run build`, `npm run test:mcp`, the MCP/database Jest suites, and `git diff --check origin/main...HEAD`.

Expected: all commands PASS. Load `.env.local` into the build process if required; never print secret values.

- [ ] **Step 2: Request independent code review**

Review the migration privilege boundary, internal Auth schema dependency, initial binding load, approval-time race checks, and test realism. Resolve every Critical or Important finding and rerun affected tests.

- [ ] **Step 3: Push and open a PR**

Push `mcp-oauth-resource-binding` and open a PR to `main` titled `fix: preserve mcp oauth project binding`.

- [ ] **Step 4: Wait for all required checks and merge**

Use `gh pr checks --watch`. Investigate failures before rerunning. Merge with squash only when all required checks pass.

- [ ] **Step 5: Verify production migration and app deployment**

Wait for the main deployment workflow to finish. Confirm the production RPC is callable only with an authenticated user and returns no other user's authorization binding.

- [ ] **Step 6: Verify real Codex OAuth and MCP operations**

Start a fresh `codex mcp login keco-main-phase1`. Confirm the URL includes the exact project resource and only supported identity scopes. Complete consent, then verify `initialize`, `tools/list`, `keco_connection_probe`, refresh behavior, and membership revocation behavior without logging tokens, authorization codes, PKCE verifiers, or full JWTs.
