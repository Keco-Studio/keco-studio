# Feature Specification: Auth/session hardening — single client, httpOnly cookies, server-only service-role, fail-closed proxy (issues #149, #154)

**Feature Branch**: `git-issues-fix`
**Created**: 2026-07-07
**Status**: Draft — HIGH RISK, deferred (manual implementation)
**Input**: GitHub issues #154 (refresh token in non-httpOnly cookie + three competing Supabase clients) and #149 (proxy fails open, never redirects, non-httpOnly cookies).

## Overview

This spec is **documentation only**. It is deferred from the automated batch because it rewrites the global login/session flow and is high-risk under unattended automation (a regression flakes the entire Playwright auth/nav suite and can leave a broken auth state). It is written in full so it can be implemented later by hand, in one focused PR with careful E2E verification.

**Investigated coupling (why the "obvious" small fix is unsafe):** the `sb-session` / `sb-access-token` cookies that `src/proxy.ts:82-95` writes are `httpOnly: false` **on purpose** — `src/lib/hybridStorageAdapter.ts` reads `sb-session` via `document.cookie` (JS) to restore the SupabaseContext client's session (`src/lib/SupabaseContext.tsx:38`). Flipping `httpOnly: true` in isolation therefore **breaks login**. The only safe fix is the full consolidation #154 describes.

**Three competing clients / adapters today:**
- `src/lib/supabase.ts:17` — module singleton, `sessionStorageAdapter`
- `src/lib/SupabaseContext.tsx:27` — context client, `hybridStorageAdapter` (localStorage-backed "tab id" defeats its own tab isolation)
- `src/lib/useSupabaseClient.ts` — `tabIsolatedStorageAdapter`

Plus `SUPABASE_SERVICE_ROLE_KEY` referenced from a `'use client'` module (`src/lib/services/projectService.ts`) — it only avoids leaking because non-`NEXT_PUBLIC_` env vars are undefined in the browser bundle, but the service-role delete's permission check currently runs client-side.

## User Scenarios & Testing *(mandatory)*

### Scenario 1 — Tokens are not readable by JavaScript (Priority: P1)

**Root cause**: `proxy.ts:82-95` sets `sb-session` and `sb-access-token` with `httpOnly:false`, 7-day maxAge; any XSS yields long-lived account takeover.

**Acceptance Scenarios**:
1. **Given** a logged-in session, **When** inspecting cookies, **Then** auth cookies are `httpOnly: true; secure; sameSite: lax` and not present in `document.cookie`.
2. **Given** the app after consolidation, **When** a user logs in/refreshes/navigates, **Then** the session persists via the standard `@supabase/ssr` cookie flow (no custom adapter).

### Scenario 2 — One client per environment (Priority: P1)

**Root cause**: three GoTrueClient instances with three storage adapters cause session drift, double token refresh, and the "Multiple GoTrueClient instances" hazard.

**Acceptance Scenarios**:
1. **Given** the browser app, **When** it needs Supabase, **Then** exactly one browser client (from `@supabase/ssr` `createBrowserClient`) is used everywhere.
2. **Given** server components/route handlers, **When** they need Supabase, **Then** they use the single SSR server client with cookie handling.

### Scenario 3 — Service-role never reaches the client bundle (Priority: P1)

**Root cause**: `src/lib/services/projectService.ts` (a `'use client'` module) references `SUPABASE_SERVICE_ROLE_KEY`.

**Acceptance Scenarios**:
1. **Given** any service-role usage, **When** the bundle is built, **Then** service-role code lives only in modules marked `import 'server-only'` and never in a client component.

### Scenario 4 — Proxy redirects and fails closed (Priority: P1)

**Root cause**: `src/proxy.ts` never redirects unauthenticated users and returns `response` (fail-open) on auth timeout (`proxy.ts:54-57`).

**Acceptance Scenarios**:
1. **Given** an unauthenticated request to a protected route group, **When** it hits the proxy/middleware, **Then** it is redirected to login.
2. **Given** the Supabase auth check times out, **When** the proxy handles it, **Then** it fails closed (denies/redirects) rather than allowing the request through.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Consolidate to ONE `@supabase/ssr` browser client + ONE SSR server client. Delete `sessionStorageAdapter`, `hybridStorageAdapter`, `tabIsolatedStorageAdapter` and their usages.
- **FR-002**: Auth cookies MUST be `httpOnly: true`, `secure` (prod), `sameSite: 'lax'`, via the standard SSR cookie flow; stop writing `sb-session`/`sb-access-token` manually in `proxy.ts`.
- **FR-003**: Move all service-role usage into `server-only` modules; remove any service-role reference from `'use client'` code; the privileged permission check must run server-side.
- **FR-004**: Introduce a real `middleware.ts` (or wire `proxy.ts`) that redirects unauthenticated users for protected route groups and fails closed on timeout/error.
- **FR-005**: Preserve intended UX: the client-side auth gate (DashboardLayout → AuthForm) must remain coherent with the new server redirect (no double login screens, no loops). See memory [[route-loading-suspense-auth]].

### Non-Functional Requirements

- **NFR-001**: Multi-tab behavior must be defined explicitly (standard SSR cookies are shared across tabs — the current per-tab isolation is a product decision to confirm before deleting the adapters).
- **NFR-002**: Full Playwright auth/nav suite must pass; this is the primary gate.

## Success Criteria *(mandatory)*

- **SC-001**: Auth cookies are httpOnly and absent from `document.cookie` (verifiable in a Playwright test).
- **SC-002**: Only one GoTrueClient instance exists at runtime (no "Multiple GoTrueClient instances" warning).
- **SC-003**: A build-time check / grep confirms no `SUPABASE_SERVICE_ROLE_KEY` reference in any `'use client'` module.
- **SC-004**: Unauthenticated access to a protected route redirects to login; auth timeout fails closed.
- **SC-005**: Playwright auth/nav suite green.

## Out of Scope

- Automated implementation in the current unattended batch (explicitly deferred).
- Changing the identity provider or session lifetime policy.
- The multi-tab isolation product decision itself (must be settled before deleting adapters).
