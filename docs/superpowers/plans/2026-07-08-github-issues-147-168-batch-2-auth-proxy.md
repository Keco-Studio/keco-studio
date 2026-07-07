# GitHub Issues 147-168 Batch 2 Auth And Proxy Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the #149/#154 security exposure by making protected routes fail closed and removing custom browser-readable Supabase session cookie writes.

**Architecture:** Extract protected route classification and unauthenticated response decisions into pure helpers under `src/lib/auth/proxyPolicy.ts`. Keep `src/proxy.ts` responsible for wiring Next request/response and Supabase SSR cookie refresh, but stop serializing sessions into custom readable cookies. Use the existing app-level `SupabaseProvider` as the single client source for React components.

**Tech Stack:** Next.js proxy, `@supabase/ssr`, Supabase JS, Jest static/unit tests.

## Global Constraints

- User-facing final replies stay in Chinese.
- Code, comments, identifiers, and API names stay in English.
- Use TDD for behavior changes where a practical test surface exists.
- Preserve unrelated user changes.
- Keep commits scoped by issue or remediation batch.
- Prefer existing project patterns over new abstractions.
- Every batch must end with a targeted verification command, and the final remediation must run the broadest practical validation chain.
- Do not push commits.
- If a command fails because of sandboxing or network restrictions, rerun it with escalated permissions.

---

### Task 1: Add Proxy Policy Tests

**Files:**
- Create: `src/lib/auth/proxyPolicy.ts`
- Create: `tests/unit/auth/proxy-policy.test.ts`
- Create: `tests/unit/auth/session-cookie-security-static.test.ts`
- Modify: `src/proxy.ts`
- Modify: `src/lib/SupabaseContext.tsx`
- Delete: `src/lib/hybridStorageAdapter.ts`
- Delete: `src/lib/sessionStorageAdapter.ts`
- Delete: `src/lib/tabIsolatedStorageAdapter.ts`
- Delete: `src/lib/utils/cookieStorageAdapter.ts`
- Delete: `src/lib/useSupabaseClient.ts`
- Delete: `src/lib/supabase.ts`

**Interfaces:**
- Produces: `isProtectedPagePath(pathname: string): boolean`
- Produces: `isProtectedApiPath(pathname: string): boolean`
- Produces: `isPublicPath(pathname: string): boolean`
- Produces: `getUnauthenticatedAction(pathname: string): { type: 'next' } | { type: 'redirect'; destination: string } | { type: 'json'; status: 401; body: { error: string } }`
- Produces: `shouldBypassProxyAuth(): boolean`

- [x] **Step 1: Write failing policy and static security tests**

Add tests asserting:

```ts
expect(getUnauthenticatedAction('/projects')).toEqual({ type: 'redirect', destination: '/auth/login' });
expect(getUnauthenticatedAction('/abc123')).toEqual({ type: 'redirect', destination: '/auth/login' });
expect(getUnauthenticatedAction('/api/projects')).toEqual({ type: 'json', status: 401, body: { error: 'Authentication required' } });
expect(getUnauthenticatedAction('/api/invitations/decline')).toEqual({ type: 'next' });
expect(getUnauthenticatedAction('/forgot-password')).toEqual({ type: 'next' });
```

Add a static test asserting `src/proxy.ts` does not contain:

```ts
"sb-session"
"sb-access-token"
"httpOnly: false"
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/auth/proxy-policy.test.ts tests/unit/auth/session-cookie-security-static.test.ts --runInBand
```

Expected: FAIL because `proxyPolicy.ts` does not exist and `src/proxy.ts` still writes custom browser-readable cookies.

- [x] **Step 3: Implement proxy policy helpers**

Create `src/lib/auth/proxyPolicy.ts` with pure path classification helpers. Treat `/`, `/auth/**`, `/forgot-password`, `/accept-invitation`, `/decline-invitation`, static/internal assets, and invitation accept/decline APIs as public. Treat `/api/**` except public APIs as protected API routes. Treat dashboard paths such as `/projects`, `/<projectId>`, `/<projectId>/<libraryId>`, and related nested dashboard paths as protected pages.

- [x] **Step 4: Update proxy implementation**

Modify `src/proxy.ts` to:

- Use `getUnauthenticatedAction`.
- Return JSON 401 for protected API routes when auth check fails, times out, or returns no user.
- Redirect protected page routes to `/auth/login?redirectTo=<current path plus query>` when auth check fails, times out, or returns no user.
- Continue allowing public routes.
- Stop writing `sb-session` and `sb-access-token`.
- Let `@supabase/ssr` set its own cookies through `setAll`.

- [x] **Step 5: Update Supabase provider storage**

Modify `src/lib/SupabaseContext.tsx` to remove `createHybridStorageAdapter()` and use Supabase's default browser auth storage for the single app-level client. Leave broader full httpOnly server-auth migration as a separate follow-up because the installed `@supabase/ssr` browser client defaults to non-httpOnly document cookies.

- [x] **Step 6: Remove unused legacy auth modules**

Delete `src/lib/hybridStorageAdapter.ts`, `src/lib/sessionStorageAdapter.ts`,
`src/lib/tabIsolatedStorageAdapter.ts`, `src/lib/utils/cookieStorageAdapter.ts`,
`src/lib/useSupabaseClient.ts`, and `src/lib/supabase.ts` after confirming no live imports remain.

- [x] **Step 7: Verify targeted tests and typecheck**

Run:

```bash
npm run test:unit -- tests/unit/auth/proxy-policy.test.ts tests/unit/auth/session-cookie-security-static.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [x] **Step 8: Commit Batch 2**

Run:

```bash
git add src/proxy.ts src/lib/auth/proxyPolicy.ts src/lib/SupabaseContext.tsx src/lib/hybridStorageAdapter.ts src/lib/sessionStorageAdapter.ts src/lib/tabIsolatedStorageAdapter.ts src/lib/utils/cookieStorageAdapter.ts src/lib/useSupabaseClient.ts src/lib/supabase.ts tests/unit/auth/proxy-policy.test.ts tests/unit/auth/session-cookie-security-static.test.ts docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-2-auth-proxy.md
git commit -m "fix: fail closed auth proxy checks"
```

Expected: Commit created. Do not push.

## Self-Review

- Spec coverage: this plan covers the fail-open proxy and custom token cookie exposure parts of #149/#154.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: helper return types are stable and consumed by tests and proxy.
