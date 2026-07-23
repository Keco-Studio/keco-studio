# MCP Production Runtime Recovery Implementation Plan

> **For agentic workers:** Execute in delivery order and verify each production gate before continuing.

**Goal:** Restore the real production MCP happy path and its project-bound OAuth authorization.

**Architecture:** First remove the independent request-context crash. Then create a satisfiable OAuth session binding at authorization-code exchange and reinstate the exact runtime binding lookup.

**Tech Stack:** Supabase Edge Functions, Deno, PostgreSQL, Supabase OAuth, MCP Streamable HTTP, Codex CLI.

## Global Constraints

- Use the production Supabase and Vercel environments for release acceptance.
- Never output OAuth tokens, codes, cookies, PKCE values, or service credentials.
- Preserve current project membership and role enforcement.
- Optimize for delivery speed; do not use TDD.

---

### Task 1: Recover request-context creation

**Files:**
- Modify: `supabase/functions/mcp/context.ts`
- Test: `supabase/functions/mcp/context.test.ts`

- [ ] Call `crypto.randomUUID()` with its receiver intact.
- [ ] Cover the default runtime path without an injected request ID.
- [ ] Run focused and full MCP checks.
- [ ] Deploy and verify the real Codex happy path.

### Task 2: Restore a satisfiable OAuth project binding

**Files:**
- Create: a new additive Supabase migration
- Modify: `supabase/functions/mcp/auth.ts`
- Test: authorization and database binding suites

- [ ] Bind the exchanged OAuth session to the authorization record's exact user, client, project, and resource.
- [ ] Restore the exact runtime binding check before membership resolution.
- [ ] Cover cross-client and cross-project replay.
- [ ] Deploy and rerun production authorization and tool acceptance.
