# Unified Account-Scoped Keco MCP Entry Design

**Date:** 2026-07-23
**Status:** Approved
**Production target:** Supabase project `lulrcirmwwvvnupmwqcq`
**Production web origin:** `https://keco-studio-main.vercel.app`
**Supersedes:** Only the requirement that every new MCP client URL contain a
project ID. Existing project-bound endpoints remain supported during migration.

## 1. Summary

Keco will add one account-scoped MCP endpoint:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp
```

Users configure and authorize this endpoint once. After OAuth, the MCP server
lists every project the authenticated account currently owns or collaborates
on, including the account's current `admin`, `editor`, or `viewer` role. The
user identifies a project in natural language. The agent resolves that request
to the stable project ID returned by `list_projects` and supplies the ID only in
internal tool calls.

The server does not persist an active project. Every project-scoped operation
revalidates current membership and role before reading or writing data.

Existing project-bound endpoints remain available:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp/{projectId}
```

They retain their current OAuth project-grant and tool contracts so existing
clients and credentials continue to work.

## 2. Goals

- Let a user configure one Keco MCP endpoint without finding a project UUID.
- Discover all currently accessible projects after OAuth.
- Return each project's effective role and allowed MCP action classes.
- Let users refer to projects by name, role, creation date, or a prior numbered
  list entry while agents use project IDs internally.
- Revalidate authorization on every project-scoped request.
- Preserve existing project-bound endpoints and credentials during migration.
- Preserve exact OAuth session/resource binding without relying on a pending
  consent state.
- Validate the complete flow with real Supabase OAuth and real MCP clients in
  production.

## 3. Non-Goals

- Persisting a user's active or most recently selected project.
- Adding `select_project` session state.
- Allowing project names to replace stable project IDs in tool schemas.
- Adding delete, project administration, or collaborator-management tools.
- Adding custom `mcp:read` or `mcp:write` OAuth scopes.
- Migrating existing project-bound tokens into account-scoped tokens.
- Managing production Supabase OAuth Server configuration through
  `supabase/config.toml`.

## 4. Confirmed Supabase Constraints

The design follows the behavior of the versions used by this repository:

- CI, Playwright, migrations, and Edge Function deployment pin Supabase CLI
  `2.90.0` through `supabase/setup-cli@v1`.
- The application pins `@supabase/supabase-js` and `@supabase/auth-js`
  `2.87.1`.
- Supabase Auth's `getAuthorizationDetails()` may return `redirect_url`
  immediately when consent already exists or is automatically approved. The
  SDK explicitly requires the caller to complete that redirect.
- A working flow cannot depend on an authorization remaining in `pending` or
  on a user pressing a manual Approve button.
- In Supabase CLI `2.90.0`, `[auth.oauth_server]` is mapped to GoTrue
  environment variables for the local `supabase start` stack.
- In that CLI version, remote OAuth Server config serialization is explicitly
  unimplemented. `supabase link` and `supabase db push` therefore do not prove
  that production OAuth Server settings match `config.toml`.
- Production OAuth Server enablement, authorization path, dynamic client
  registration, discovery, and code exchange must be verified against the
  deployed service.
- The current production-safe pattern binds an OAuth authorization to the exact
  OAuth session created in the authorization-code exchange transaction. The
  account-scoped endpoint preserves this property at service scope.

## 5. Architecture

### 5.1 Endpoint modes

The Edge Function accepts two exact public URL forms:

| Mode | Public URL | Authorization context |
| --- | --- | --- |
| Account-scoped | `/functions/v1/mcp` | User, OAuth client, OAuth session |
| Legacy project-bound | `/functions/v1/mcp/{projectId}` | Existing project-bound context |

Query strings, fragments, credentials, trailing path segments, malformed UUIDs,
and noncanonical origins remain invalid.

The account-scoped path creates an account-level context:

```ts
type AccountMcpContext = {
  requestId: string;
  userId: string;
  clientId: string;
  sessionId: string;
  bearerToken: string;
};
```

A project-scoped tool call derives a short-lived project context only after
authorization succeeds:

```ts
type AuthorizedProjectContext = AccountMcpContext & {
  projectId: string;
  role: "admin" | "editor" | "viewer";
};
```

No context is saved as a user's active project.

### 5.2 Account-scoped request flow

```text
Client calls /functions/v1/mcp
  -> 401 protected-resource challenge when unauthenticated
  -> Supabase OAuth authorization
  -> immediate redirect_url or manual pending-consent fallback
  -> authorization-code exchange
  -> exact OAuth session receives a service-level MCP grant
  -> client calls list_projects
  -> user identifies a project in natural language
  -> agent passes the returned projectId internally
  -> server rechecks current membership and role
  -> operation executes in a project-scoped context
```

### 5.3 No active-project state

The server must not store project selection by user, OAuth client, refresh
token, or MCP connection. A stateful selection could make simultaneous Codex,
Claude, or browser sessions silently switch one another's target project.

Every project tool therefore receives `projectId` internally. The ID is an
identifier, not authorization; current membership and role remain mandatory.

## 6. OAuth And Service-Level Session Grants

### 6.1 Protected resource

The new OAuth protected resource is the exact account endpoint:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp
```

Its metadata names the existing Supabase Auth authorization server. It does not
advertise unsupported custom application scopes.

The consent page supports both valid Supabase Auth outcomes:

- If `getAuthorizationDetails()` returns `redirect_url`, redirect immediately.
- If it returns a pending request, render the existing manual Approve/Deny
  fallback and use the supported SDK consent APIs.

Neither branch prepares or finalizes a Keco grant from the browser.

### 6.2 Additive service-grant table

Add a separate private table, conceptually:

```text
oauth_mcp_service_grants
```

It records:

```ts
{
  authorizationId: string;
  userId: string;
  clientId: string;
  resource: string;
  sessionId: string;
  approvedAt: string;
  exchangedAt: string;
}
```

The table contains no project ID and no role. It proves only that the exact
OAuth session completed authorization for the account-scoped Keco MCP resource.
Direct access is revoked from public, anon, authenticated, and service-role
clients. Runtime access occurs through narrowly scoped security-definer RPCs.

### 6.3 Exchange binding

Add a service-specific `AFTER DELETE` trigger for consumed rows in
`auth.oauth_authorizations`, following the already production-verified exchange
binding pattern.

The trigger inserts a service grant only when:

- the consumed authorization was approved;
- its resource matches the exact account-scoped MCP URL shape;
- exactly one OAuth session for the same user and client was created in the
  current database transaction;
- the session is bound to that user and OAuth client.

The trigger does not require the authorization to have previously been pending
and does not require the user to own a project. A zero-project account may
authorize successfully and receive an empty project list.

The existing project-grant trigger remains unchanged. The two triggers accept
disjoint resource shapes, so execution order cannot bind a resource into the
wrong table.

### 6.4 Runtime service-grant check

The account endpoint authorizes a request only when all of these are true:

1. The bearer token is valid.
2. The token identifies a verified OAuth client and OAuth session.
3. The current user, client, session, and exact account resource match one
   service-grant row.
4. The matching Supabase OAuth consent has not been revoked.
5. The authorization-code exchange completed.

A normal Supabase login token is not sufficient. A legacy project token cannot
call the account endpoint, and an account token cannot call a legacy project
endpoint.

## 7. Project Discovery And User Interaction

### 7.1 `list_projects`

The account endpoint adds:

```ts
list_projects({
  limit?: number;   // default 50, maximum 100
  cursor?: string;
})
```

The result is deterministic and bounded:

```json
{
  "ok": true,
  "items": [
    {
      "projectId": "uuid-used-internally",
      "name": "Game Design",
      "description": "Primary game project",
      "createdAt": "2026-07-20T08:00:00Z",
      "role": "admin",
      "capabilities": {
        "read": true,
        "create": true,
        "update": true
      }
    }
  ],
  "returnedCount": 1,
  "hasMore": false,
  "nextCursor": null
}
```

The query returns projects owned by the user plus accepted collaborator rows.
Owners resolve to `admin`. Rejected or unaccepted invitations do not count.
Results must be deduplicated and sorted by `projectId ASC`. Creation time remains
part of every result so agents can display and disambiguate duplicate names.
Pagination reuses the existing signed MCP cursor codec and binds the cursor to
the authenticated user plus the last project ID, preventing cursor replay across
accounts and preventing duplicate or skipped projects between pages without an
unbounded creation-time sort. The database RPC retains `p_before_created_at`
only for signature compatibility; account cursors always send it as `NULL`.

### 7.2 Duplicate project names

Listing projects never interrupts merely because duplicate names exist. The
agent displays every result with role and creation date, for example:

```text
1. Game Design
   Admin, created 2026-07-20

2. Game Design
   Viewer, created 2026-07-18
```

The agent asks the user to disambiguate only when a requested operation cannot
identify one project from the available name, role, date, or prior list number.

Examples:

- `List my projects` lists both and asks no question.
- `Read documents in Game Design` asks which duplicate project.
- `Read documents in the Admin Game Design project` resolves directly.
- `Use the second Game Design project` resolves from the prior numbered list.

The agent must not prefer an admin project, switch to a writable duplicate, or
silently choose the newest project. An unresolved target requires user input.

## 8. Tool And Resource Surface

### 8.1 Account tools

The account endpoint exposes:

- `keco_connection_probe`
- `list_projects`
- the existing read tools with required internal `projectId`
- the existing non-destructive write tools with required internal `projectId`

Examples:

```ts
list_project_structure({ projectId })
list_documents({ projectId, limit, cursor })
read_document({ projectId, documentId, mode })
query_table_rows({ projectId, tableId, limit, cursor })
semantic_search({ projectId, query, source })

create_table({ projectId, ...input })
create_table_row({ projectId, tableId, ...input })
update_table_row({ projectId, tableId, ...input })
create_document({ projectId, ...input })
update_document({ projectId, documentId, ...input })
```

Legacy project endpoints retain their current schemas without `projectId`.

### 8.2 Tool discovery

- Every service-authorized account sees the probe, project discovery, and read
  tools.
- Write tools are advertised only if the account currently has at least one
  `admin` or `editor` project.
- Tool discovery is an ergonomic hint, not an authorization decision.
- Every write call rechecks the target project's current role.
- A mixed-role account may see write tools but cannot use them on a viewer
  project.

### 8.3 Permission matrix

| MCP operation class | Admin | Editor | Viewer |
| --- | --- | --- | --- |
| List accessible projects | Yes | Yes | Yes |
| Read structure, tables, documents | Yes | Yes | Yes |
| Search project content | Yes | Yes | Yes |
| Create tables, rows, documents | Yes | Yes | No |
| Update rows and documents | Yes | Yes | No |

Admin and editor currently have identical MCP write permissions because the MCP
surface has no deletion, membership, or project-administration tools.

### 8.4 Resources and prompts

The account endpoint adds an account resource and project-scoped templates,
conceptually:

```text
keco://projects
keco://projects/{projectId}
keco://projects/{projectId}/structure
keco://projects/{projectId}/tables/{tableId}/schema
keco://projects/{projectId}/tables/{tableId}/rows{?limit,cursor}
keco://projects/{projectId}/documents/{documentId}
```

Project-oriented MCP prompts receive an internal `projectId`. They do not rely
on selected-project state. Legacy resources and prompts remain available only
on legacy endpoints with their current behavior.

## 9. Project Authorization

For every account-endpoint project operation, validation occurs in this order:

1. Validate the service OAuth session grant.
2. Validate `projectId` syntax.
3. Resolve project ownership or an accepted collaborator role under the caller's
   bearer token and RLS.
4. Return `admin` for the owner or the current accepted collaborator role.
5. Check whether the operation is read or write.
6. Create the project-scoped request context and execute the operation.

Membership removal and role downgrade apply on the next request. Roles are not
stored in OAuth tokens or service grants and are not cached across requests.

Project absence and lack of access share the public error
`PROJECT_NOT_ACCESSIBLE` to avoid revealing whether another user's project
exists. Viewer writes return `PROJECT_WRITE_FORBIDDEN`.

## 10. Errors And Operational Behavior

| Condition | Result |
| --- | --- |
| Missing bearer token | HTTP 401 with account resource metadata |
| Invalid or expired token | HTTP 401 |
| Valid Supabase token without service grant | HTTP 403 |
| Revoked OAuth consent | HTTP 403 |
| Legacy token replayed to account endpoint | HTTP 403 |
| Account token replayed to legacy endpoint | HTTP 403 |
| Missing or inaccessible project | `PROJECT_NOT_ACCESSIBLE` |
| Viewer attempts a write | `PROJECT_WRITE_FORBIDDEN` |
| No accessible projects | Successful empty `list_projects` page |
| Authorization backing query fails | HTTP 503 |

Credential-shaped values, authorization codes, refresh tokens, PKCE values,
cookies, and client secrets must never appear in logs, telemetry, evidence, or
tool results.

## 11. Performance

- `list_projects` is a bounded cursor-based read with default 50 and maximum 100
  items.
- It reads project metadata and roles only; it does not load project structure,
  table rows, document content, or search indexes.
- Owner and accepted-collaborator paths use existing user/project indexes.
- The representative 100-project fixture must remain index-backed and reject a
  sequential full-table membership scan.
- Project role checks are intentionally uncached to preserve immediate
  revocation and downgrade semantics.
- `list_projects` uses the existing MCP read telemetry, response-size boundary,
  and read rate-limit class.
- Local representative-load timing and a real production request timing are
  release evidence.

## 12. Migration And Deployment

### 12.1 Additive rollout

The rollout is additive:

1. Add the service-grant table, RPC, and exchange trigger through a migration.
2. Add account protected-resource metadata and consent handling in Vercel.
3. Add the account route, authorization context, and project-aware tool surface
   to the MCP Edge Function.
4. Keep all legacy routes and grants intact.
5. Perform real OAuth and MCP acceptance after deployment.

The existing deployment workflow order remains correct:

```text
Database migrations
  -> Vercel deployment
  -> production codec health check
  -> MCP Edge Function deployment
  -> real-client acceptance
```

The migration is present before the Edge Function can accept account-scoped
traffic.

### 12.2 CLI and remote-config safeguards

- Keep Supabase CLI pinned to `2.90.0` in CI and deployment workflows for this
  change.
- Run `supabase start` and `supabase db reset` with that pinned version in CI.
- Treat local `[auth.oauth_server]` as local-stack configuration only.
- Do not claim that `supabase db push` updates production OAuth Server settings.
- Verify production discovery, dynamic client registration, authorization, and
  code exchange directly after deploy.
- Continue deploying the Edge Function with `--no-verify-jwt`; the function's
  own service-grant and project-role checks remain the authorization boundary.

### 12.3 Rollback

If account-scoped acceptance fails, disable or reject the exact `/mcp` route.
Legacy `/mcp/{projectId}` traffic remains available. The additive service-grant
table and trigger may remain deployed while the Edge route is rolled back; no
destructive database rollback is required.

## 13. Test Strategy

### 13.1 Route and metadata tests

- Accept the exact account and legacy endpoint forms.
- Reject malformed paths, suffixes, query strings, fragments, credentials, and
  noncanonical resource origins.
- Return account metadata without `project_id` for the account challenge.
- Preserve current project metadata for legacy challenges.

### 13.2 OAuth and database behavior tests

- Code exchange creates exactly one matching service grant.
- An immediate `redirect_url` completes authorization without a pending state.
- A manual pending-consent branch remains supported.
- A normal Supabase session has no service grant.
- Account and legacy resource tokens cannot be replayed across endpoint modes.
- Refresh preserves the OAuth session binding.
- Consent revocation invalidates the account token.
- Wrong client, user, session, authorization, or resource fails closed.
- The service trigger and legacy trigger ignore one another's resource shapes.

These tests run against the real local Supabase database and auth schema started
by Supabase CLI `2.90.0`, not only against mocked gateway interfaces.

### 13.3 Project and tool behavior tests

Use fixtures where one user is:

- admin of project A;
- editor of project B;
- viewer of project C;
- not a member of project D;
- a member of two same-name projects E and F with different roles/dates.

Verify exact project visibility, roles, capabilities, pagination, admin/editor
writes, viewer write denial, immediate role changes, and same-name preservation.

Legacy tool schemas and behavior remain unchanged. Account tool schemas require
internal `projectId` and reauthorize each target.

### 13.4 Real production acceptance

Release completion requires a fresh OAuth flow against the production account
endpoint using real Windows Codex and at least one independent MCP client such
as Claude.

Required Codex scenarios:

```text
List my Keco projects.
```

Lists every accessible project with role and creation date. Duplicate names do
not cause an unsolicited question.

```text
Read the documents in Game Design.
```

If the name is ambiguous, the agent asks which listed project the user means.

```text
Read the documents in the Admin Game Design project.
```

The uniquely identified project is used without another question.

```text
Create a document in the Viewer Game Design project.
```

The write is rejected. The agent must not switch to a writable duplicate.

Also verify:

- a zero-project account receives an empty project page;
- anonymous requests return 401;
- nonmembers cannot discover projects;
- legacy production MCP credentials still work;
- account/project cross-resource replay is rejected;
- no production data is modified except uniquely named, approved,
  non-destructive acceptance fixtures;
- no secret-shaped values appear in evidence.

## 14. Release Gates

The feature is complete only when all of the following are true:

- MCP type checks, Deno tests, Jest MCP suites, database behavior tests, build,
  CodeQL, and all Playwright shards pass.
- The 100-project discovery fixture is bounded and index-backed.
- The merge-triggered main CI and deployment workflows are green.
- Database migration, Vercel, codec secret sync, and production MCP Edge
  Function deployment succeed in the established order.
- Real production OAuth, project listing, role enforcement, ambiguity handling,
  resource reads, and legacy compatibility pass.
- Rollback of only the account route has been demonstrated or reviewed as
  operationally sufficient.

## 15. Security Invariants

- A project ID never grants access by itself.
- A service grant never grants access to every project by itself.
- Every project operation requires both a valid service OAuth session and
  current project membership.
- Roles come from current database state, not agent claims or token scopes.
- Agents may use project IDs internally but users are never required to provide
  them.
- Ambiguity never authorizes silent project selection.
- Existing project-bound authorization remains isolated from account-scoped
  authorization.
- All failures default to denial without leaking project existence or
  credentials.
