# Unified Account-Scoped Keco MCP Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-ready account-scoped `/functions/v1/mcp` endpoint that discovers all projects accessible to the authenticated Keco account while preserving the existing project-bound endpoints.

**Architecture:** Route requests into either account or legacy project mode. Account OAuth tokens are bound to an exact service-level grant, then each project operation resolves current membership and role before deriving a project context; no active-project state is stored. Database RPCs provide bounded project discovery and live role resolution, while mode-specific server registration keeps legacy schemas unchanged.

**Tech Stack:** Supabase Edge Functions and Postgres, Supabase Auth OAuth Server, TypeScript/Deno, MCP SDK 1.29.0, Next.js 16, React 19, Jest, Playwright, Supabase CLI 2.90.0.

## Global Constraints

- Do not use TDD for this implementation; implement each coherent task first, then run focused verification.
- Keep Supabase CLI pinned to `2.90.0` and Supabase JS/Auth pinned to `2.87.1`.
- Do not add `mcp:read` or `mcp:write` OAuth scopes.
- Do not persist a selected project or add `select_project`.
- Keep `/functions/v1/mcp/{projectId}` and all legacy tool/resource/prompt schemas working.
- Every account-mode project operation must recheck live membership and role.
- Project absence and inaccessible projects return `PROJECT_NOT_ACCESSIBLE`; viewer writes return `PROJECT_WRITE_FORBIDDEN`.
- Production acceptance uses `https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp` and real OAuth clients.
- Never record credentials, authorization codes, refresh tokens, PKCE values, cookies, or client secrets in logs or evidence.

---

### Task 1: Service Grant and Project Discovery Database Contract

**Files:**
- Create: `supabase/migrations/20260723100000_mcp_account_scope.sql`
- Create: `tests/unit/database/mcp-account-scope-migration.test.ts`
- Create: `tests/unit/database/mcp-account-scope.behavior.test.ts`
- Create: `scripts/fixtures/mcp-account-projects.sql`
- Create: `scripts/fixtures/mcp-account-projects-gates.sql`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `public.oauth_mcp_service_grants` keyed by `authorization_id`, with exact `user_id`, `client_id`, `resource`, and `session_id` binding.
- Produces: `public.has_oauth_mcp_service_grant(p_client_id TEXT, p_resource TEXT) RETURNS BOOLEAN`.
- Produces: `public.mcp_resolve_project_role(p_project_id UUID) RETURNS TEXT`, returning `admin`, `editor`, `viewer`, or `NULL` under `auth.uid()`.
- Produces: `public.mcp_list_accessible_projects(p_limit INTEGER, p_before_created_at TIMESTAMPTZ, p_after_project_id UUID)` returning `project_id`, `name`, `description`, `created_at`, and `role` sorted by `created_at DESC, project_id ASC`.
- Produces: account-level telemetry admission compatible with `list_projects` without inventing a project UUID.

- [ ] **Step 1: Implement the additive migration**

Create the private service-grant table, indexes, RLS/revokes, `AFTER DELETE` exchange trigger, service-grant check, project-role resolver, bounded project-list RPC, and account telemetry admission. The trigger must accept only the exact root resource pattern and must use exactly one `auth.sessions` row created in the current transaction:

```sql
IF OLD.status <> 'approved'
   OR OLD.resource !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/functions/v1/mcp$' THEN
  RETURN OLD;
END IF;

SELECT array_agg(s.id ORDER BY s.id)
INTO v_session_ids
FROM auth.sessions AS s
WHERE s.user_id = OLD.user_id
  AND s.oauth_client_id = OLD.client_id
  AND s.xmin::TEXT::BIGINT = pg_current_xact_id()::TEXT::BIGINT;
```

The list RPC must clamp the limit to `1..100`, deduplicate owner/collaborator access, ignore unaccepted collaborators, and use this keyset predicate:

```sql
p_before_created_at IS NULL
OR project.created_at < p_before_created_at
OR (project.created_at = p_before_created_at AND project.id > p_after_project_id)
```

- [ ] **Step 2: Add migration and real-database behavior coverage**

Assert disjoint root/project resource triggers, exact session binding, zero-project authorization, revoked consent denial, owner/admin/editor/viewer resolution, unaccepted collaborator exclusion, duplicate-name preservation, deterministic pagination, and immediate role changes. Use the existing `RLS_DB_TESTS=1` local Supabase test pattern.

- [ ] **Step 3: Add the representative 100-project performance fixture and CI gate**

Seed 100 accessible projects plus inaccessible and unaccepted rows, verify the first/next pages, and reject sequential scans of the project membership path with `EXPLAIN (FORMAT JSON)` assertions in `mcp-account-projects-gates.sql`.

- [ ] **Step 4: Run focused verification and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/database/mcp-account-scope-migration.test.ts
RLS_DB_TESTS=1 npm run test:unit -- --runInBand tests/unit/database/mcp-account-scope.behavior.test.ts
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f scripts/fixtures/mcp-account-projects.sql
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f scripts/fixtures/mcp-account-projects-gates.sql
```

Expected: all Jest tests pass and both SQL scripts exit `0` with bounded index-backed plans.

Commit:

```bash
git add supabase/migrations/20260723100000_mcp_account_scope.sql tests/unit/database/mcp-account-scope-migration.test.ts tests/unit/database/mcp-account-scope.behavior.test.ts scripts/fixtures/mcp-account-projects.sql scripts/fixtures/mcp-account-projects-gates.sql .github/workflows/ci.yml
git commit -m "feat: add account MCP database authorization"
```

### Task 2: Account HTTP Route, OAuth Authorization, and Context Types

**Files:**
- Modify: `supabase/functions/mcp/auth.ts`
- Modify: `supabase/functions/mcp/auth.test.ts`
- Modify: `supabase/functions/mcp/context.ts`
- Modify: `supabase/functions/mcp/context.test.ts`
- Modify: `supabase/functions/mcp/http.ts`
- Modify: `supabase/functions/mcp/http.test.ts`
- Modify: `supabase/functions/mcp/errors.ts`

**Interfaces:**
- Produces: `McpEndpoint = { mode: "account" } | { mode: "project"; projectId: string }` from exact `/mcp` and `/mcp/{uuid}` paths.
- Produces: `AccountAuthContext = { userId: string; clientId: string; sessionId: string; bearerToken: string }`.
- Produces: `AccountMcpRequestContext` and existing `ProjectMcpRequestContext`, united as `McpRequestContext` with a `mode` discriminator.
- Consumes: `has_oauth_mcp_service_grant` from Task 1.
- Preserves: `authorizeProject()` and legacy project challenges.

- [ ] **Step 1: Add strict endpoint parsing and canonical account resource construction**

Use exact public/gateway path forms and reject query strings, fragments, credentials, suffixes, and malformed UUIDs:

```ts
export type McpEndpoint =
  | { mode: "account" }
  | { mode: "project"; projectId: string };

export function extractMcpEndpoint(url: URL): McpEndpoint | null;
export function canonicalAccountResource(
  requestUrl: string,
  resourceOrigin?: string | null,
): string | null;
```

- [ ] **Step 2: Implement account OAuth grant authorization**

Decode only the verified `client_id`, `session_id`, and issuer origin from the token after `auth.getUser(token)` succeeds. Require the exact root resource and call:

```ts
hasOAuthServiceGrant(
  clientId: string,
  resource: string,
  token: string,
): Promise<boolean>;
```

Return `unauthenticated`, `forbidden`, or `operational_error` with the same fail-closed distinction as legacy authorization.

- [ ] **Step 3: Make request contexts mode-discriminated and credential-safe**

Define:

```ts
export type AccountMcpRequestContext = Readonly<{
  mode: "account";
  requestId: string;
  userId: string;
  clientId: string;
  sessionId: string;
  bearerToken: string;
  supabase: SupabaseClient;
}>;

export type ProjectMcpRequestContext = Readonly<{
  mode: "project";
  requestId: string;
  userId: string;
  projectId: string;
  role: ProjectRole;
  clientId: string | null;
  bearerToken: string;
  supabase: SupabaseClient;
}>;
```

Keep bearer tokens and Supabase clients non-enumerable.

- [ ] **Step 4: Route account and legacy requests with mode-specific challenges**

For unauthenticated account requests, emit:

```text
Bearer resource_metadata="${KECO_PUBLIC_URL}/api/mcp/oauth-protected-resource"
```

For legacy requests, retain `?project_id={uuid}`. Account and project authorizers must be separate dependencies so tests can prove cross-mode replay denial.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
npm run check:mcp
npm run test:mcp -- supabase/functions/mcp/auth.test.ts supabase/functions/mcp/context.test.ts supabase/functions/mcp/http.test.ts
```

Expected: Deno type checking succeeds and all route/auth/context tests pass.

Commit:

```bash
git add supabase/functions/mcp/auth.ts supabase/functions/mcp/auth.test.ts supabase/functions/mcp/context.ts supabase/functions/mcp/context.test.ts supabase/functions/mcp/http.ts supabase/functions/mcp/http.test.ts supabase/functions/mcp/errors.ts
git commit -m "feat: route account scoped MCP requests"
```

### Task 3: Account Project Discovery and Live Project Authorization

**Files:**
- Create: `supabase/functions/mcp/account-projects.ts`
- Create: `supabase/functions/mcp/account-projects.test.ts`
- Modify: `supabase/functions/mcp/cursor.ts`
- Modify: `supabase/functions/mcp/cursor.test.ts`
- Modify: `supabase/functions/mcp/operations.ts`
- Modify: `supabase/functions/mcp/database.ts`

**Interfaces:**
- Consumes: `AccountMcpRequestContext` from Task 2 and database RPCs from Task 1.
- Produces: `listAccessibleProjects(context, { limit?, cursor? }): Promise<ProjectListPage>`.
- Produces: `authorizeAccountProject(context, projectId, access): Promise<ProjectMcpRequestContext>` where `access` is `"read" | "write"`.
- Produces: `accountHasWritableProject(context): Promise<boolean>` for discovery-time tool advertisement only.

- [ ] **Step 1: Extend cursor binding for account project pages**

Allow a cursor to bind to the authenticated user without a project ID while preserving every legacy cursor byte and validation rule:

```ts
export type CursorBinding =
  | { kind: string; scope: "project"; projectId: string; objectId?: string | null }
  | { kind: string; scope: "account"; userId: string; objectId?: string | null };
```

The account position is `{ createdAt: string; projectId: string }` and is rejected when replayed by another user.

- [ ] **Step 2: Implement bounded project discovery**

Call `mcp_list_accessible_projects` with `limit + 1`, map roles to capabilities, and return:

```ts
type ProjectListItem = {
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
  role: "admin" | "editor" | "viewer";
  capabilities: { read: true; create: boolean; update: boolean };
};
```

- [ ] **Step 3: Implement live project role derivation**

Validate UUID syntax, call `mcp_resolve_project_role` on every project operation, return `PROJECT_NOT_ACCESSIBLE` for `NULL`, and return `PROJECT_WRITE_FORBIDDEN` when a viewer requests write access. Derive a fresh project context without mutating or caching the account context.

- [ ] **Step 4: Adapt database and operation helpers to derived project contexts**

Keep existing project RPC inputs unchanged. Account callers must pass only an `authorizeAccountProject()` result into current read/write operations so the stable `projectId` continues to come from server context.

- [ ] **Step 5: Run focused verification and commit**

Run:

```bash
npm run check:mcp
npm run test:mcp -- supabase/functions/mcp/account-projects.test.ts supabase/functions/mcp/cursor.test.ts supabase/functions/mcp/operations.test.ts supabase/functions/mcp/database.test.ts
```

Expected: project list, pagination, cross-user cursor rejection, role changes, viewer denial, and legacy cursor tests pass.

Commit:

```bash
git add supabase/functions/mcp/account-projects.ts supabase/functions/mcp/account-projects.test.ts supabase/functions/mcp/cursor.ts supabase/functions/mcp/cursor.test.ts supabase/functions/mcp/operations.ts supabase/functions/mcp/database.ts
git commit -m "feat: resolve account MCP project access"
```

### Task 4: Mode-Specific MCP Tools

**Files:**
- Create: `supabase/functions/mcp/account-tools.ts`
- Create: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/read-tools.ts`
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/telemetry.ts`
- Modify: `supabase/functions/mcp/telemetry.test.ts`

**Interfaces:**
- Consumes: `listAccessibleProjects`, `authorizeAccountProject`, and `accountHasWritableProject` from Task 3.
- Produces: account schemas with required `projectId`; preserves legacy schemas without `projectId`.
- Produces: account-aware telemetry that admits `list_projects` at account scope and project operations under the derived project context.

- [ ] **Step 1: Register `list_projects` and account read tools**

`list_projects` accepts only optional `limit` and `cursor`. Each existing read schema gains required `projectId` only in account mode, removes it before calling the existing operation, and resolves live read access first.

- [ ] **Step 2: Register account write tools conditionally**

Advertise write tools only when `accountHasWritableProject()` is true. Each schema requires `projectId`; every call resolves live write access and denies viewer targets without selecting another project.

- [ ] **Step 3: Preserve legacy server registration and protocol classification**

Create the server by context mode:

```ts
if (context.mode === "account") {
  await registerAccountTools(server, context);
} else {
  registerReadTools(server, context);
  registerWriteTools(server, context);
}
```

Classify `list_projects` as read telemetry. Preserve probe behavior and all legacy discovery snapshots.

- [ ] **Step 4: Run focused verification and commit**

Run:

```bash
npm run check:mcp
npm run test:mcp -- supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/telemetry.test.ts
```

Expected: account schemas require `projectId`, viewer writes fail with the exact code, write discovery reflects current accessible roles, and legacy schemas remain byte-for-byte equivalent in test snapshots.

Commit:

```bash
git add supabase/functions/mcp/account-tools.ts supabase/functions/mcp/account-tools.test.ts supabase/functions/mcp/read-tools.ts supabase/functions/mcp/write-tools.ts supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/telemetry.ts supabase/functions/mcp/telemetry.test.ts
git commit -m "feat: expose account scoped MCP tools"
```

### Task 5: Account Resources and Prompts

**Files:**
- Modify: `supabase/functions/mcp/resources.ts`
- Create: `supabase/functions/mcp/resources-account.test.ts`
- Modify: `supabase/functions/mcp/prompts.ts`
- Create: `supabase/functions/mcp/prompts-account.test.ts`

**Interfaces:**
- Consumes: account context and project resolver from Task 3.
- Produces: `keco://projects` plus project-scoped account templates.
- Preserves: all legacy `keco://project`, `keco://tables`, and `keco://documents` resources and existing prompt arguments.

- [ ] **Step 1: Add account resources and templates**

Register exact account URIs:

```text
keco://projects
keco://projects/{projectId}
keco://projects/{projectId}/structure
keco://projects/{projectId}/tables/{tableId}/schema
keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}
keco://projects/{projectId}/documents/{documentId}
```

Every project URI validates the IDs, resolves live read access, and then invokes the existing bounded operation.

- [ ] **Step 2: Add required internal `projectId` to account prompts**

Account prompt arguments begin with `{ projectId: uuid }`; generated messages explicitly instruct the agent to use the listed stable project ID and never silently choose among duplicate names. Legacy prompt contracts remain unchanged.

- [ ] **Step 3: Run focused verification and commit**

Run:

```bash
npm run check:mcp
npm run test:mcp -- supabase/functions/mcp/resources-account.test.ts supabase/functions/mcp/prompts-account.test.ts supabase/functions/mcp/server.test.ts
```

Expected: account resources/prompts reauthorize their target and legacy lists remain unchanged.

Commit:

```bash
git add supabase/functions/mcp/resources.ts supabase/functions/mcp/resources-account.test.ts supabase/functions/mcp/prompts.ts supabase/functions/mcp/prompts-account.test.ts
git commit -m "feat: add account MCP resources and prompts"
```

### Task 6: Protected Resource Metadata and OAuth Consent

**Files:**
- Modify: `src/lib/mcp/oauthMetadata.ts`
- Modify: `src/lib/mcp/oauthProjectBinding.ts`
- Modify: `src/app/api/mcp/oauth-protected-resource/route.ts`
- Modify: `src/components/mcp/OAuthConsentClient.tsx`
- Modify: `tests/unit/mcp/oauth-metadata.test.ts`
- Modify: `tests/unit/mcp/oauth-project-binding.test.ts`
- Modify: `tests/unit/mcp/oauth-consent-behavior.test.ts`
- Modify: `tests/unit/mcp/oauth-consent-wiring.test.ts`

**Interfaces:**
- Produces: account metadata when `project_id` is absent and legacy metadata when it is present.
- Produces: `classifyOAuthResource(resource): { mode: "account" } | { mode: "project"; projectId: string } | null`.
- Preserves: immediate `redirect_url` handling before any project lookup or pending-consent assumption.

- [ ] **Step 1: Build exact account protected-resource metadata**

Use:

```ts
export function buildAccountResourceUrl(supabaseUrl: string): string {
  return `${normalizeSupabaseOrigin(supabaseUrl)}/functions/v1/mcp`;
}
```

Metadata advertises the existing Supabase Auth authorization server and header bearer method, without custom scopes.

- [ ] **Step 2: Classify OAuth resources by exact configured origin and path**

Reject credentials, search, fragments, trailing slashes, suffixes, and other origins. The root path returns account mode; the UUID suffix returns legacy project mode.

- [ ] **Step 3: Support both consent modes and both Supabase Auth outcomes**

After `getAuthorizationDetails()`:

```ts
if (details.redirect_url) {
  window.location.assign(details.redirect_url);
  return;
}
```

For pending account requests, show that the client requests access to the Keco account, without requiring a project lookup. For pending legacy requests, retain the current project access check and copy. Neither branch prepares or finalizes grants in the browser.

- [ ] **Step 4: Run focused verification and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/mcp/oauth-metadata.test.ts tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
npm run typecheck
```

Expected: immediate redirects, account pending approval, legacy pending approval, invalid resource rejection, and metadata variants pass.

Commit:

```bash
git add src/lib/mcp/oauthMetadata.ts src/lib/mcp/oauthProjectBinding.ts src/app/api/mcp/oauth-protected-resource/route.ts src/components/mcp/OAuthConsentClient.tsx tests/unit/mcp/oauth-metadata.test.ts tests/unit/mcp/oauth-project-binding.test.ts tests/unit/mcp/oauth-consent-behavior.test.ts tests/unit/mcp/oauth-consent-wiring.test.ts
git commit -m "feat: authorize account scoped MCP OAuth"
```

### Task 7: Documentation, Probes, and Rollback Contract

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `docs/mcp/operations-runbook.md`
- Modify: `.github/workflows/README.md`
- Modify: `scripts/probe-mcp-oauth.ts`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `scripts/probe-mcp-performance.ts`
- Modify: `tests/unit/mcp/oauth-probe.test.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`
- Modify: `tests/unit/mcp/performance-probe.test.ts`

**Interfaces:**
- Documents the root endpoint as the default setup and the UUID endpoint as legacy-compatible.
- Produces sanitized probe evidence for account discovery, role enforcement, performance, replay denial, and legacy compatibility.

- [ ] **Step 1: Update client setup and user interaction guidance**

Document one root URL, OAuth login, `list_projects`, role/capability display, and duplicate-name behavior. State that users never need to enter project IDs and that agents must ask only when an operation remains ambiguous.

- [ ] **Step 2: Update operational deployment and rollback guidance**

Record the deployment order, Supabase CLI remote OAuth configuration limitation, exact production checks, and rollback by disabling only the root route while retaining legacy traffic.

- [ ] **Step 3: Extend probes without logging secrets**

Add account resource discovery, DCR/authorization/code-exchange checks, list-project timing, viewer denial, cross-resource replay denial, and legacy probe support. Evidence may contain request IDs, durations, roles, counts, and sanitized project labels only.

- [ ] **Step 4: Run focused verification and commit**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/mcp/oauth-probe.test.ts tests/unit/mcp/capabilities-probe.test.ts tests/unit/mcp/performance-probe.test.ts tests/unit/mcp/evidence-scan.test.ts
npm run typecheck
```

Expected: probe contract tests pass and evidence scanning rejects secret-shaped data.

Commit:

```bash
git add docs/mcp/README.md docs/mcp/operations-runbook.md .github/workflows/README.md scripts/probe-mcp-oauth.ts scripts/probe-mcp-capabilities.ts scripts/probe-mcp-performance.ts tests/unit/mcp/oauth-probe.test.ts tests/unit/mcp/capabilities-probe.test.ts tests/unit/mcp/performance-probe.test.ts
git commit -m "docs: publish account MCP setup and probes"
```

### Task 8: Integrated Verification, Production Rollout, and Real Clients

**Files:**
- Modify when generated evidence is already tracked: `docs/mcp/phase-2-client-matrix.md`
- Modify when generated evidence is already tracked: `docs/mcp/phase-2-performance.json`

**Interfaces:**
- Consumes all prior tasks.
- Produces a merged main deployment and real production acceptance evidence.

- [ ] **Step 1: Run the complete local gate**

Run with Supabase CLI `2.90.0`:

```bash
supabase start --ignore-health-check
supabase db reset
npm run lint
npm run typecheck
npm run typecheck:api
npm run check:mcp
npm run test:mcp
RLS_DB_TESTS=1 npm run test:unit -- --runInBand
npm run build
```

Expected: all commands exit `0`; the database behavior tests use local keys from `supabase status`.

- [ ] **Step 2: Review compatibility and security invariants**

Inspect tool/resource/prompt lists for both modes, verify no project ID authorizes access by itself, verify service grant plus current membership are both required, verify viewer writes use `PROJECT_WRITE_FORBIDDEN`, and verify root/project token replay fails.

- [ ] **Step 3: Push, open the PR, and wait for all required checks**

Push the implementation branch, open a PR to `main`, and do not merge until CI, CodeQL, Vercel preview, migration checks, MCP checks, database behavior tests, build, and all Playwright shards are green.

- [ ] **Step 4: Merge and wait for ordered production deployment**

Confirm the main workflows apply database migrations, deploy Vercel, pass the codec health check, deploy the MCP Edge Function with `--no-verify-jwt`, and finish successfully before real-client acceptance.

- [ ] **Step 5: Execute real production OAuth and MCP acceptance**

Against `https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp`, verify anonymous `401`, OAuth discovery, DCR, authorization, code exchange, `list_projects`, duplicate-name listing, unambiguous role/date targeting, ambiguous-operation clarification, viewer write denial, zero-project empty listing, resource reads, project-role changes, cross-mode replay denial, and legacy endpoint compatibility in Windows Codex plus Claude.

- [ ] **Step 6: Record sanitized evidence and final status**

Record only non-secret request summaries, counts, durations, role outcomes, workflow URLs, and commit identifiers. Run:

```bash
npm run scan:mcp-evidence -- docs/mcp/phase-2-client-matrix.md docs/mcp/phase-2-performance.json
```

Expected: evidence scan exits `0`, and the feature is ready for delivery.
