# Feature Specification: Fix prod lockout — fail-closed proxy vs localStorage session, and dead /auth/login redirect

**Feature Branch**: `f/importscript-enhance` (prod hotfix)
**Created**: 2026-07-09
**Status**: Draft — ready for implementation
**Input**: Production bug — after PR #171 (2026-07-08), clicking any project shows "Project not found"; right-click menu shows only "Collaborators"; a one-time redirect occurs; new projects behave the same. Local dev unaffected. F12 shows `projects?select=owner_id&id=eq.auth`, `libraries?...&id=eq.login`, `invalid input syntax for type uuid: "login"`, `/api/projects/auth/role 401`.

## Overview

Verified root cause (two coupled facts):

1. **The auth proxy reads the session from cookies, but the browser stored it in localStorage.** The Next.js proxy `src/proxy.ts` (exported `proxy()`; in **Next.js 16** `proxy.ts` is the current convention, `middleware.ts` is deprecated — build shows `ƒ Proxy (Middleware)`, so it runs in production) authenticates with `@supabase/ssr` `createServerClient`, reading the session from **cookies**. The browser client `src/lib/SupabaseContext.tsx` used `@supabase/supabase-js` `createClient` with `persistSession:true`, so the session lived in **localStorage** — no auth cookie exists. The proxy's `getUser()` therefore never resolved a user for anyone.

2. **Commit `e3775c4` ("fail closed auth proxy checks") flipped the proxy from fail-open to fail-closed.** Before it, the auth-failure branches were `return response` (let the request through), so the cookie-blind proxy was harmless and the app worked. `e3775c4` changed them to `return buildUnauthenticatedResponse(request)`. Combined with the cookie/localStorage mismatch, **every user is now treated as unauthenticated**:
   - protected page → redirect to `destination: '/auth/login'`, a route that does not exist (`src/app/auth/` has only `callback`, `reset-password`) → falls through to `(dashboard)/[projectId]/[libraryId]` with `projectId="auth"`, `libraryId="login"` → Supabase `400 invalid input syntax for type uuid` + `/api/projects/auth/role 401` → surfaces as "Project not found", role lookup failure (right-click shows only "Collaborators"), and a one-time redirect.
   - protected API → 401.

   Local dev is unaffected because `shouldBypassProxyAuth()` returns true when `NODE_ENV==='development'`.

**Correction note:** two earlier hypotheses (a removed request-cache causing a `getUser` storm; a `middleware.ts`→`proxy.ts` rename disabling the middleware) were investigated and **disproven** — the proxy runs correctly under Next 16, and the `e3775c4` diff shows the fail-open→fail-closed flip. This spec reflects the verified cause.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Logged-in user can open a project (Priority: P1)

**Acceptance Scenarios**:
1. **Given** a logged-in user, **When** they click a project, **Then** the project page loads (no "Project not found").
2. **Given** a logged-in user, **When** they right-click a project they own, **Then** the full owner/admin menu appears, not just "Collaborators".
3. **Given** a just-created project, **When** opened, **Then** it loads normally.

### Scenario 2 — Proxy can see the session (Priority: P1)

**Root cause**: session in localStorage is invisible to a cookie-reading server client.

**Acceptance Scenarios**:
1. **Given** a user logs in via `AuthForm`, **When** the session is established, **Then** it is persisted in cookies readable by the `@supabase/ssr` server client (`sb-<ref>-auth-token`).
2. **Given** a logged-in user with a valid cookie session, **When** the proxy runs `getUser()`, **Then** it resolves the user and lets the request through.

### Scenario 3 — Unauthenticated redirect never targets a dead route (Priority: P1)

**Root cause**: redirect destination `/auth/login` does not exist and there is no standalone login URL.

**Acceptance Scenarios**:
1. **Given** an unauthenticated request to a protected page, **When** the policy resolves, **Then** it does NOT emit a redirect (returns `next`); the client-side `DashboardLayout` renders `AuthForm` in place.
2. **Given** an unauthenticated request to a protected API, **When** the policy resolves, **Then** it returns `401` JSON.
3. **Given** the policy, **When** any path is evaluated, **Then** it never returns a `redirect` to `/auth/login`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The browser Supabase client MUST persist its session in cookies via `@supabase/ssr` `createBrowserClient`, replacing the localStorage-only `createClient`. The `useSupabase()` client surface (61 consumers) is unchanged.
- **FR-002**: `getUnauthenticatedAction` for a protected PAGE MUST return `{ type: 'next' }` (no server redirect); protected APIs keep `401`. This removes the dead `/auth/login` redirect and cannot loop.
- **FR-003**: The proxy keeps its fail-closed behavior for APIs and continues to refresh the cookie session for authenticated requests.
- **FR-004**: No new standalone login route is introduced; login remains the client-side `DashboardLayout`→`AuthForm` gate (user decision).

### Non-Functional Requirements

- **NFR-001**: The 61 `useSupabase` consumers require no changes.
- **NFR-002**: API routes using `createSupabaseServerClient` (Authorization-header based) keep working; same-origin fetches now also carry the auth cookie.
- **NFR-003**: `tests/e2e/specs/auth.spec.ts` / nav suite is the primary regression gate (auth/nav is flaky-sensitive; see memory route-loading-suspense-auth). Not run in this environment (requires real Supabase creds); build + unit tests used instead.

## Success Criteria *(mandatory)*

- **SC-001**: Logged-in user can open any project; right-click shows the full role-appropriate menu.
- **SC-002**: `getUnauthenticatedAction` returns `next` for a protected page and never a `/auth/login` redirect (unit test).
- **SC-003**: `SupabaseContext` uses `createBrowserClient`; no `createClient` from `@supabase/supabase-js` there.
- **SC-004**: `tsc` and jest are green; `next build` succeeds and registers the proxy.

## Out of Scope

- The full three-client consolidation / httpOnly hardening / service-role relocation (spec 006).
- `?redirect=` vs `?redirectTo=` param mismatch and return-to-page after login (user chose "always /projects").
- Reverting `e3775c4`'s fail-closed intent — we keep fail-closed but make it correct by giving the proxy a readable session.
