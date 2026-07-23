# MCP Account Connections Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the authenticated account-level `/mcp` page for connecting Codex or Claude Code and independently managing completed MCP OAuth connections.

**Architecture:** Keep `oauth_mcp_service_grants` as the source of truth. Service-role-only SQL functions expose the smallest possible internal connection tuple to a server-only service; the browser receives only a user-bound HMAC ID plus classified display data. The page separates static command instructions from the asynchronously refreshed connection list.

**Tech Stack:** Next.js App Router, React 19, Ant Design, Supabase/Postgres, Jest, Playwright.

## Global Constraints

- Work directly on local branch `mcp`; do not create a branch or worktree.
- Do not use TDD; add focused tests after implementation.
- Do not run local sandbox build or use local sandbox tests as delivery evidence.
- Do not add another connection table or change legacy project-level MCP behavior.
- Never return OAuth client IDs, session IDs, authorization IDs, tokens, secrets, or raw metadata to the browser.
- Delete only the exact selected OAuth session and cascading service grant, never OAuth client consent.
- Keep `.superpowers` until implementation and all remote validation are complete, then delete it before final delivery.

---

### Task 1: Service-Role Connection RPCs

**Files:**
- Create: `supabase/migrations/20260724100000_mcp_account_connections.sql`
- Create: `tests/unit/database/mcp-account-connections-migration.test.ts`
- Create: `tests/unit/database/mcp-account-connections.behavior.test.ts`

**Interfaces:**
- Produces: `public.list_oauth_mcp_account_connections(p_user_id UUID)` returning authorization ID, registered client name, and exchange time only to `service_role`.
- Produces: `public.revoke_oauth_mcp_account_connection(p_user_id UUID, p_authorization_id TEXT)` returning boolean only to `service_role`.

- [ ] Add a stable `SECURITY DEFINER` list function that revalidates grant, exact account MCP resource, session, client, active consent, and completed timestamps.
- [ ] Add a volatile `SECURITY DEFINER` revoke function that locks the exact grant, revalidates the complete relationship, deletes only its `auth.sessions` row, and verifies the grant cascade.
- [ ] Revoke both functions from `PUBLIC`, `anon`, and `authenticated`; grant execute only to `service_role`.
- [ ] Add migration contract tests plus database behavior tests for user isolation, duplicate clients, exact revocation, token invalidation, and retained sibling connections.

### Task 2: Opaque IDs And Server-Only Service

**Files:**
- Create: `src/lib/server/mcpConnectionId.ts`
- Create: `src/lib/server/mcpConnectionsService.ts`
- Create: `tests/unit/mcp/mcp-connection-id.test.ts`
- Create: `tests/unit/mcp/mcp-connections-service.test.ts`

**Interfaces:**
- Produces: `signMcpConnectionId(userId, authorizationId)` and constant-time candidate matching using `MCP_CONNECTION_ID_SIGNING_SECRET`.
- Produces: `listMcpConnections(userId)` and `disconnectMcpConnection(userId, opaqueId)`.

- [ ] Implement versioned base64url HMAC-SHA-256 IDs bound to the current user with a dedicated 32-byte-or-longer production secret.
- [ ] Classify registered client names as `codex`, `claude`, or `unknown` without exposing the raw name.
- [ ] Resolve deletes only by signing the current user's eligible candidates and constant-time comparison before calling the exact revoke RPC.
- [ ] Add focused tests for determinism, user binding, tampering, classification, sorting, and exact revoke arguments.

### Task 3: Authenticated API Routes

**Files:**
- Create: `src/app/api/mcp/connections/route.ts`
- Create: `src/app/api/mcp/connections/[connectionId]/route.ts`
- Create: `src/lib/auth/sameOriginMutation.ts`
- Create: `tests/unit/mcp/mcp-connections-route.test.ts`

**Interfaces:**
- Produces: `GET /api/mcp/connections` and `DELETE /api/mcp/connections/{connectionId}`.

- [ ] Wrap both endpoints with existing `withAuth`.
- [ ] Return only `{id, client, clientName, connectedAt}` with `Cache-Control: private, no-store`.
- [ ] Fail delete closed for cross-origin requests and map absent/foreign/tampered IDs to the same generic 404.
- [ ] Return generic errors without logging identifiers or database details.
- [ ] Add route tests for auth wrapping, response shape, cache policy, error sanitization, and origin checks.

### Task 4: MCP Account Page And Entry

**Files:**
- Create: `src/app/(dashboard)/mcp/page.tsx`
- Create: `src/app/(dashboard)/mcp/page.module.css`
- Create: `src/components/mcp/McpConnectionCommands.tsx`
- Create: `src/components/mcp/McpConnectionsList.tsx`
- Create: `src/components/mcp/mcpCommands.ts`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/lib/contexts/NavigationContext.tsx`
- Create: `tests/unit/mcp/mcp-account-page.test.tsx`
- Create: `tests/e2e/specs/mcp-account-connections.spec.ts`

**Interfaces:**
- Consumes: authenticated connection APIs from Task 3.
- Produces: `/mcp`, avatar-menu `MCP` entry, `Account / MCP` breadcrumb, copyable Codex/Claude commands, and exact-row disconnect controls.

- [ ] Add `MCP` immediately above `Logout`, close the menu, and route to `/mcp`.
- [ ] Render the approved header, segmented commands, copy tooltip/check feedback, and CSS wrapping that never changes the copied single-line command.
- [ ] Render two compact skeleton rows, empty/error/retry states, duplicate rows, locale time, mobile-hidden time column, and per-row pending state.
- [ ] Use the existing Ant Design confirmation and toast patterns with the approved copy.
- [ ] Refresh on mount, window focus, and successful disconnect without polling or blocking command interaction.
- [ ] Add UI contract and E2E coverage for menu placement, copy fidelity, states, exact disconnect, and desktop/mobile overflow.

### Task 5: Remote Review, CI, Merge, And Production Acceptance

**Files:**
- Modify as required by remote review/CI findings.
- Delete before final delivery: `.superpowers/`

- [ ] Inspect the final diff for secrets, leaked OAuth identifiers, unrelated changes, and legacy MCP regressions.
- [ ] Push `mcp`, open a PR to `main`, and monitor all GitHub-hosted checks to green; repair failures without pausing.
- [ ] Merge the green PR and record the PR URL, Actions URLs, and merge commit.
- [ ] Wait for Vercel and Supabase production deployment, then run authenticated production API/UI/MCP acceptance for isolation, duplicate connections, exact revocation, token invalidation, copy fidelity, and responsive layout.
- [ ] Run the evidence safety scan, delete `.superpowers/`, commit and deliver that deletion without losing any required evidence.
