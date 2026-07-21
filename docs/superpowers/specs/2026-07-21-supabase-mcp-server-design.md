# Supabase-Hosted Keco MCP Server Design

**Date:** 2026-07-21  
**Status:** Proposed, pending written-spec review  
**Scope:** A remote, project-bound MCP server hosted in Supabase Edge Functions and compatible with Codex and Claude

## 1. Summary

Keco will expose a standards-compliant remote Model Context Protocol (MCP)
server from a Supabase Edge Function. External MCP clients such as Codex and
Claude will authenticate through OAuth, bind each configured server connection
to one Keco project, and discover Keco tools, resources, and prompts through
the MCP protocol.

The MCP server and its core tool execution will run in Supabase. It will not
proxy tool calls to the Next.js `/api/agent-chat` route. Read operations will
use the caller's Supabase JWT and row-level security (RLS). Multi-step writes
will use narrow, atomic PostgreSQL RPCs that authenticate with `auth.uid()` and
enforce current project membership.

The first release intentionally exposes a small, useful surface. It includes
project, table, and document reads; semantic search; common table and document
writes; resource URIs; and reusable prompts. Destructive operations, bulk
imports, and Agent-specific confirmation or suspension workflows remain out of
scope.

## 2. Goals and Non-Goals

### 2.1 Goals

- Provide a remote Streamable HTTP MCP endpoint hosted in Supabase Edge
  Functions.
- Support OAuth-based user authorization for Codex and Claude.
- Bind one configured MCP endpoint to exactly one Keco project.
- Recheck the user's current project role on every request.
- Expose a focused first-release set of Tools, Resources, and Prompts.
- Keep normal data access under the caller's identity and existing RLS.
- Make compound writes atomic through PostgreSQL RPCs.
- Define measurable latency, query-count, payload, and cold-start budgets.
- Establish reusable database operations that the Keco web application can
  adopt over time.

### 2.2 Non-Goals

- Turning the existing in-app Agent or its ReAct loop into the MCP server.
- Running an LLM inside the MCP server to decide which tool to call.
- Exposing every existing Agent tool in the first release.
- Supporting destructive deletes, bulk script import, or complex orchestration.
- Maintaining an in-memory MCP session across Edge Function instances.
- Using MCP annotations or client confirmations as an authorization boundary.
- Moving the existing Keco web application to Supabase Edge Functions.

## 3. Current State

Keco currently has an in-app Agent behind `/api/agent-chat`. Its tools implement
an internal `AgentTool` interface and are passed to an OpenAI-compatible chat
completion API as function tools. The Agent provides its own ReAct loop, SSE
events, conversation scope, permission resolution, confirmation cards, and
pending-action persistence.

That system is not an MCP server. It does not implement MCP initialization,
capability negotiation, JSON-RPC MCP methods, Streamable HTTP transport, MCP
resource URIs, or MCP prompt discovery. Several current tools also depend on
Next.js modules, Node APIs, path aliases, dynamic imports, Yjs-related services,
and application-only confirmation state. They cannot be copied unchanged into
a Deno-based Edge Function.

The database already has useful foundations: project collaboration roles, RLS,
document collaboration/version RPCs, semantic embedding tables, and atomic
library row helpers. There is no existing `supabase/functions` implementation,
so the MCP function will be a new deployment unit.

## 4. Chosen Architecture

```text
Codex / Claude
    |
    | OAuth 2.1-style authorization code flow with PKCE
    v
Supabase Auth OAuth Server
    |
    | access token / refresh token
    v
Supabase Edge Function
/functions/v1/mcp/{projectId}
    |
    +-- MCP protocol and Streamable HTTP transport
    +-- authentication, scope, and project-role checks
    +-- Tool, Resource, and Prompt registries
    +-- Edge-compatible query operations
    +-- atomic PostgreSQL RPC calls
    +-- audit and performance telemetry
    |
    v
Supabase Postgres + RLS
```

### 4.1 Why the MCP Server Runs in Supabase

The server remains close to Supabase Auth, RLS, and Postgres. It can use the
caller's JWT directly, avoids a dependency on the Keco Next.js deployment, and
supports independent deployment and scaling. The cost is that the first-release
operations need a Deno/Edge-compatible execution layer rather than direct
imports from `src/lib/agent`.

Business rules must not be copied indefinitely between Next.js and Edge.
Compound invariants and transactions belong in focused Postgres RPCs. Pure
validation and result-shaping logic may be shared only when it has no Node,
Next.js, browser, or Agent-runtime dependency and can be built reliably in both
environments. The Keco web application can migrate to the same RPCs separately;
that migration is not required to ship the first MCP release.

### 4.2 Project Binding

The project is part of the protected MCP endpoint:

```text
https://{project-ref}.supabase.co/functions/v1/mcp/{projectId}
```

The client never supplies `projectId` as a tool argument. A user who connects
two projects configures two MCP server URLs. Every request parses the bound ID,
checks that it is a valid UUID, and resolves the caller's current role in that
project before exposing or executing project capabilities.

The path is authoritative only for selecting the requested project. It is not
proof of access. RLS and operation-specific authorization remain mandatory.

### 4.3 Stateless Transport

The first release uses stateless Streamable HTTP. Each JSON-RPC request is
self-contained and reconstructs identity, project, role, scopes, and operation
context from the request and database. The function does not rely on process
memory or Edge-instance affinity. Legacy HTTP+SSE transport is not supported.

Where an MCP client sends a session identifier, the server may echo or validate
it for protocol compatibility, but correctness must not depend on an in-memory
session record.

## 5. OAuth and Authorization

### 5.1 Authorization Flow

```text
Client reads protected-resource metadata
  -> client registration or pre-registered client lookup
  -> authorization request with PKCE S256
  -> user signs in to Keco/Supabase
  -> consent UI shows client, project, and requested scopes
  -> user approves or denies
  -> authorization code exchange
  -> client receives access and refresh tokens
  -> client calls the project-bound MCP endpoint with Bearer token
```

Supabase Auth's OAuth server is the preferred authorization server. It must be
enabled with the consent flow required by the deployed Supabase version. Dynamic
client registration is preferred because it gives Codex and Claude the least
manual setup. Exact support for metadata discovery, dynamic registration,
scopes, and redirect URI handling is a release gate, not an assumption.

### 5.2 Discovery Compatibility Gate

Before implementing business tools, a protocol probe must establish that both
Codex and Claude can:

1. Discover protected-resource and authorization-server metadata.
2. Register or use a supported OAuth client.
3. Complete authorization code + PKCE.
4. Obtain and refresh a token.
5. Call `initialize` and `tools/list` on the Edge Function.

Supabase's function gateway may not serve every well-known metadata path in the
shape expected by every MCP client. If direct discovery fails, the fallback is
a Supabase custom domain or a minimal metadata router that points back to the
Supabase authorization and MCP endpoints. Tool execution must remain in the Edge
Function. A client-specific, undocumented login workaround is not acceptable as
the production design.

### 5.3 Consent and Project Grant

The consent screen displays the client name, project name, requested scopes,
and whether write access is requested. It must verify that the signed-in user
currently belongs to the project before approval.

If the deployed OAuth server cannot encode the project grant in its native
authorization record, Keco stores a separate revocable grant keyed by the
stable OAuth client identity, user ID, and project ID. The Edge Function checks
that grant in addition to token validity and current project membership. No
grant table may contain raw access or refresh tokens.

### 5.4 Scopes and Roles

The first-release scopes are:

```text
mcp:read
mcp:write
```

The effective permission is the intersection of token scope, approved project
grant, and current project role:

| Current role | `mcp:read` | `mcp:write` |
|---|---:|---:|
| Viewer | Allow | Deny |
| Editor | Allow | Allow |
| Admin | Allow | Allow |
| No current membership | Deny | Deny |

A role downgrade or collaborator removal takes effect on the next request. A
previously issued token never preserves a higher project role.

### 5.5 Token Handling

- Use authorization code flow with PKCE `S256`.
- Match redirect URIs exactly.
- Use short-lived access tokens and refresh-token rotation where supported.
- Support grant/token revocation through the selected OAuth configuration.
- Never log Authorization headers, tokens, authorization codes, or PKCE values.
- Use the caller's Bearer token to construct the Supabase client used for normal
  reads and writes.
- Configure gateway JWT behavior so unauthenticated discovery can succeed while
  protected MCP operations still return a standards-compatible `401`. Function
  code must explicitly authenticate every protected request.

## 6. MCP Protocol Surface

The Edge Function implements the negotiated MCP protocol version supported by
the selected official TypeScript SDK version. The implementation uses the SDK's
Streamable HTTP transport and protocol schemas rather than maintaining a custom
JSON-RPC dispatcher. The dependency version is pinned and upgraded deliberately.

Required first-release methods include:

- `initialize` and initialized lifecycle handling
- `ping`
- `tools/list` and `tools/call`
- `resources/list`, `resources/templates/list`, and `resources/read`
- `prompts/list` and `prompts/get`

Capabilities are declared accurately. The server does not announce subscriptions,
resource-change notifications, sampling, roots, or elicitation unless they are
actually implemented and tested.

## 7. Tools

### 7.1 Read Tools

| Tool | Purpose | Important limits |
|---|---|---|
| `list_project_structure` | List folders, table schemas, and document summaries | No table rows; bounded document summaries |
| `query_table_rows` | Read rows from one table with filters and pagination | Default 50, maximum 200 |
| `list_documents` | Page through document metadata | Default 50, maximum 200 |
| `read_document` | Read full, outline, heading, or line-bounded content | Full response subject to content budget |
| `semantic_search` | Search indexed project tables, documents, and permitted indexed content | Default 10, maximum 30 results |

These names form an external MCP API. Internal Agent names such as
`query_assets` may continue unchanged inside the Keco application; MCP schemas
should use domain-neutral table terminology and receive explicit compatibility
tests.

### 7.2 Write Tools

| Tool | Purpose | Transaction/concurrency rule |
|---|---|---|
| `create_table` | Create a table, fields, and initial empty row | One atomic RPC |
| `create_table_row` | Validate semantic field names and create or reuse a row | One atomic RPC |
| `update_table_row` | Update a row by stable ID or UI row index | One atomic RPC with project/table checks |
| `create_document` | Create a document and initialize collaboration state | One atomic RPC |
| `update_document` | Replace document content against an expected state token | Conflict-safe RPC; never silent last-write-wins |

Write operations are executed when the MCP client calls them. The existing Keco
confirmation cards and pending-action store are not used. Clients receive tool
annotations and may ask the user for confirmation, but server-side scopes, roles,
RLS, validation, and audit remain authoritative.

Example annotation for a non-destructive create operation:

```json
{
  "readOnlyHint": false,
  "destructiveHint": false,
  "idempotentHint": false,
  "openWorldHint": false
}
```

Read tools use `readOnlyHint: true`. Update tools set `idempotentHint` only if the
implemented contract is actually safe to repeat with identical arguments.

### 7.3 Deferred Tools

The first release does not expose:

- Delete tools of any kind
- Bulk script or story import
- Move or rename operations
- Conversation-option tools
- Agent confirmation, pause, resume, or pending-action tools
- Bulk reference-field orchestration
- Document editing that cannot preserve current collaboration/version invariants

## 8. Resources

Resources use stable URIs under the `keco` scheme:

```text
keco://project
keco://project/structure
keco://tables
keco://tables/{tableId}/schema
keco://tables/{tableId}/rows
keco://documents
keco://documents/{documentId}
```

`resources/list` returns only bounded entry resources. It must not enumerate all
rows or document contents during connection. Parameterized table and document
access is advertised through resource templates.

Resource URI parsing must reject malformed identifiers, path traversal, unknown
query parameters, and identifiers outside the bound project. Large collections
use cursor pagination. Truncated responses explicitly include `nextCursor`, the
number returned, and whether more content exists.

`query_table_rows` remains the preferred interface when filters or structured
arguments are needed. Resources provide addressable reads; they do not duplicate
every query capability.

## 9. Prompts

The first release provides three prompt templates:

| Prompt | Purpose |
|---|---|
| `analyze_project` | Inspect project structure and summarize important tables and documents |
| `build_tables_from_document` | Read a selected document, propose a schema, then use table write tools |
| `update_project_data` | Inspect a table schema and safely update specified project data |

Prompt definitions are static and version-controlled. `prompts/get` validates
arguments and returns MCP prompt messages and instructions. Retrieving a prompt
does not execute a tool or write data. Any mutation still requires an explicit
MCP tool call.

## 10. Edge and Database Boundaries

### 10.1 Edge Function Responsibilities

- Streamable HTTP and MCP lifecycle handling
- OAuth/Bearer authentication
- Project ID, grant, scope, and role resolution
- Tool/resource/prompt registration and input validation
- Calling bounded PostgREST queries or atomic RPCs
- Mapping domain results to MCP content and structured content
- Audit and performance telemetry
- External embedding request for semantic search

### 10.2 Database Responsibilities

- RLS and current project membership enforcement
- Cross-project referential integrity
- Multi-step write transactions
- Field type, required value, enum, and reference validation that must hold for
  every caller
- Row allocation/reuse and ordering invariants
- Document state-token validation, backup/version creation, and conflict checks
- Revocable project grants where required by the OAuth integration
- Append-only MCP audit records with filtered metadata

### 10.3 RPC Security Rules

- RPCs use `auth.uid()`; they do not trust a caller-provided user ID.
- Any `SECURITY DEFINER` function sets an explicit empty or safe `search_path`.
- Default execution rights are revoked and only required roles receive execute
  permission.
- Each RPC verifies that every referenced object belongs to the bound project.
- Ordinary MCP execution does not use `service_role`.
- The Edge Function may use privileged credentials only for a narrowly defined
  platform operation that cannot be performed under a user JWT, never as a
  shortcut around user authorization. Any such exception requires a separate
  threat review.

### 10.4 Document Concurrency

`read_document` returns a stable state token, including the values needed by the
document update RPC. `update_document` requires that expected token. The database
locks the document, verifies the collaboration epoch/revision and update tail,
creates the required backup/version, and applies the new state atomically. A
changed token returns `DOCUMENT_CONFLICT`; the server never overwrites a newer
state silently.

The Edge implementation must preserve the current sanctioned Markdown/MDX and
Yjs-state invariants. If a Deno-compatible implementation cannot produce a valid
replacement Yjs state, `update_document` is held from the first release rather
than weakening document integrity. This is a tool-level release gate.

## 11. Request Processing

For each protected MCP request, the server performs the following work once:

1. Validate HTTP method, content type, accepted response types, and request size.
2. Authenticate the Bearer token and establish the Supabase user.
3. Parse and validate the project ID from the endpoint.
4. Load the approved project grant, token scopes, and current project role.
5. Build an immutable request context reused by every handler in the request.
6. Validate the JSON-RPC/MCP request through the MCP SDK.
7. Filter capabilities or reject calls according to effective permission.
8. Validate tool arguments or resource URI parameters.
9. Execute bounded queries or one atomic write RPC using the user JWT.
10. Emit filtered audit/performance telemetry and return an MCP response.

Authentication, project-role resolution, and grant loading must not be repeated
inside multiple helper layers during the same request. Database RLS or RPC checks
still independently enforce access at execution time.

## 12. Error Model

Protocol failures use the MCP SDK's standards-compliant JSON-RPC behavior:

| Condition | Response |
|---|---|
| Invalid JSON | JSON-RPC `-32700` |
| Invalid JSON-RPC/MCP request | JSON-RPC `-32600` |
| Unknown method | JSON-RPC `-32601` |
| Invalid params | JSON-RPC `-32602` |
| Internal protocol failure | JSON-RPC `-32603` |
| Missing/invalid authentication | HTTP `401` with protected-resource metadata reference |
| Valid identity but insufficient grant/scope/role | HTTP `403` |
| Request or user rate limited | HTTP `429` |

Expected tool-domain failures return a valid `tools/call` result with
`isError: true`, a concise human-readable message, and a stable structured code.
Initial codes include:

```text
PROJECT_ACCESS_REVOKED
PROJECT_GRANT_REQUIRED
TABLE_NOT_FOUND
ROW_NOT_FOUND
DOCUMENT_NOT_FOUND
FIELD_VALIDATION_FAILED
DOCUMENT_CONFLICT
PAYLOAD_TOO_LARGE
RATE_LIMITED
UPSTREAM_EMBEDDING_UNAVAILABLE
```

Errors do not reveal whether an object exists in another project. Unexpected
database details, SQL text, stack traces, tokens, and internal secrets are never
returned to clients.

## 13. Performance Design

### 13.1 Eliminate N+1 Queries

The current Agent implementation of project structure can query properties once
per library. The Edge version must not reproduce that behavior. It uses either
one read RPC or a fixed set of parallel, project-bounded queries for folders,
tables, field definitions, and document summaries, then joins them in memory.
Database round trips must not grow linearly with table count.

### 13.2 Atomic, Single-Round-Trip Writes

`create_table`, `create_table_row`, `update_table_row`, `create_document`, and
`update_document` use one primary RPC each. Validation and all dependent writes
run in the same transaction. A failed operation leaves no partial table, field,
row, document state, or audit mutation.

### 13.3 Read and Payload Budgets

| Surface | Default | Hard maximum |
|---|---:|---:|
| Table rows | 50 | 200 per response |
| Document metadata | 50 | 200 per response |
| Semantic search results | 10 | 30 per response |
| Document content returned at once | Bounded mode preferred | About 100 KiB UTF-8 |
| MCP JSON response | N/A | 1 MiB |
| Incoming request body | N/A | 256 KiB |

Exact byte limits are configuration constants with tests. Oversized full-document
reads return an outline plus instructions for heading/line reads. Collection
reads return opaque cursors and never silently truncate. Project structure
contains schema summaries but no table rows.

### 13.4 Static Capabilities

Tool schemas, resource templates, and prompt definitions are module-level static
registries. `initialize`, prompt listing, resource-template listing, and base
tool listing do not read project data. Role-based filtering uses the request
authorization context already resolved for protected calls.

### 13.5 Semantic Search

Semantic search has a separate budget because it calls an embedding provider
before a vector-match RPC:

- External embedding timeout: 5 seconds maximum.
- Default 10 and maximum 30 matches.
- Return only bounded excerpts and required metadata.
- Cache query embeddings by embedding-model version and normalized query text.
- Do not cache final permission-filtered search results across users/projects.
- Fail the search tool explicitly without degrading other MCP operations.
- Store embedding credentials only as Supabase secrets.

### 13.6 Cold Start and Bundle Control

The MCP function imports only the MCP SDK/transport, Supabase client, lightweight
validation, registries, and first-release operations. It does not bundle the
Next.js Agent core, LLM chat client, script import pipeline, or unrelated UI and
document modules. Heavy optional code is loaded only by the corresponding tool
when Edge-runtime measurements show that doing so helps.

### 13.7 Latency and Query Budgets

Service-side targets, measured at the Edge Function, are:

| Operation | Target |
|---|---:|
| Warm `initialize` / static capability list | P95 < 300 ms |
| Ordinary read tool | P95 < 800 ms |
| Project structure | P95 < 1 s |
| Ordinary write RPC | P95 < 1 s |
| Semantic search | P95 < 3 s, excluding severe provider incidents |
| Cold-start request | P95 < 2 s |

An ordinary tool uses no more than three database round trips. A compound write
uses one primary transaction RPC. Measurements distinguish warm and cold starts
and include authentication, authorization, database, external provider, and
serialization time.

## 14. Rate Limiting and Audit

Rate limits are keyed by user, project, client identity where available, and
operation class. Read, write, and semantic-search limits are separate. Limits
must not rely only on Edge-instance memory. The implementation may use a
database-backed window/counter or a supported distributed rate-limit service;
the selection belongs in the implementation plan after measurement.

Each tool call records:

- Timestamp and request/correlation ID
- User ID, project ID, and stable client identity
- Tool name and read/write classification
- Success, stable error code, and duration breakdown
- Request and response byte sizes
- A filtered argument summary

Audit records exclude access tokens, refresh tokens, authorization codes, PKCE
values, raw secrets, full document bodies, and unbounded row content. Audit
retention and access policy must be defined before production rollout.

## 15. Testing and Acceptance

### 15.1 Unit Tests

- MCP registration and capability declaration
- Tool argument schemas and annotations
- Resource URI/template parsing
- Prompt argument validation
- Scope and role permission matrix
- Domain-to-MCP error mapping
- Pagination cursors and payload limits

### 15.2 Database Tests

- RLS permits project reads and rejects cross-project reads
- Viewers cannot execute write RPCs
- Editors/Admins can execute only permitted writes
- RPCs derive the actor from `auth.uid()`
- Compound writes are atomic under injected failures
- Referenced table, row, field, folder, and document IDs must share the bound
  project
- Role downgrade and collaborator removal take effect immediately
- Concurrent document changes return `DOCUMENT_CONFLICT`
- RPC grants and `search_path` settings remain hardened

### 15.3 Edge Integration Tests

- `initialize`, `ping`, and negotiated capabilities
- Every first-release Tool success and failure path
- Resource lists, templates, reads, pagination, and truncation metadata
- Prompt discovery and retrieval
- Missing, invalid, expired, and wrong-audience tokens
- Malformed JSON-RPC, unsupported methods, oversized payloads, and rate limits
- Cross-project IDs embedded in tool arguments or resource URIs

### 15.4 OAuth Tests

- Metadata discovery
- Dynamic registration or documented registration fallback
- Authorization code + PKCE `S256`
- Consent denial and missing project membership
- Exact redirect URI rejection
- Token refresh, rotation, expiration, and revocation
- Grant revocation and role/scope downgrade

### 15.5 Client Compatibility Tests

Both Codex and Claude must independently complete:

1. MCP endpoint configuration.
2. Automatic OAuth discovery and browser authorization.
3. `initialize`, Tools, Resources, and Prompts discovery.
4. A project structure read and a bounded document/table read.
5. One client-confirmed, non-destructive write such as creating a test row.
6. Token refresh without manual reconfiguration.
7. A rejected write after role downgrade or grant revocation.

Compatibility is not inferred from SDK conformance alone. Both real clients are
release gates.

### 15.6 Performance Tests

- Small and large project fixtures with many tables, fields, rows, and documents
- Assert fixed query count for project structure to catch N+1 regressions
- Warm/cold latency histograms for every operation class
- Response-size and pagination boundary tests
- Concurrent writes and document conflicts
- Embedding timeout and provider-degradation behavior
- Sustained and burst rate-limit behavior

## 16. Delivery Phases

### Phase 1: Protocol and OAuth Probe

- Create the minimal Edge Function structure.
- Configure OAuth server, consent, metadata, and client registration.
- Implement only `initialize`, `ping`, and a static `tools/list`.
- Prove Codex and Claude discovery, authorization, refresh, and invocation.
- Resolve custom-domain/metadata routing if the Supabase gateway is insufficient.

No business-tool implementation proceeds until this compatibility gate passes.

### Phase 2: Read Surface

- Add request authorization context and project binding.
- Implement read Tools, Resources, and Prompts.
- Add the fixed-query project structure read.
- Add pagination, payload budgets, audit, and read rate limits.
- Verify RLS and cross-project isolation.

### Phase 3: Write Surface

- Add atomic table and row RPCs.
- Add atomic document creation and conflict-safe update when its Edge integrity
  gate passes.
- Register write tools with accurate annotations.
- Add write scopes, role checks, audit, and write rate limits.
- Run real-client confirmation and write tests.

### Phase 4: Production Hardening

- Complete performance/load testing against large fixtures.
- Tune indexes, query counts, cold-start bundle, and limits.
- Establish dashboards and alerts for latency, failures, auth errors, rate limits,
  and external embedding health.
- Exercise grant/token revocation and incident procedures.
- Publish client setup documentation and a versioned compatibility matrix.

## 17. Release Gates and Risks

1. **OAuth discovery compatibility:** Supabase metadata and dynamic registration
   must work with real Codex and Claude clients, or use the documented custom
   domain/metadata fallback.
2. **Edge SDK compatibility:** The pinned MCP TypeScript SDK and Streamable HTTP
   transport must run in the deployed Supabase Deno runtime. If not, use the
   SDK's supported web-standard build or the narrowest conformant adapter after
   protocol tests; do not silently invent a partial MCP implementation.
3. **Document state integrity:** `update_document` ships only if the Edge/RPC path
   preserves sanctioned Markdown, Yjs state, backups, and conflict semantics.
4. **Business-rule drift:** Rules shared by Keco and MCP should move into hardened
   RPCs; duplicated Edge-only mutations require explicit reconciliation tests.
5. **Large-project performance:** Project structure and resources must meet fixed
   query-count and payload budgets before production.
6. **Annotations are advisory:** Client confirmations vary; scopes, roles, RLS,
   validation, and audit remain the security boundary.

## 18. Success Criteria

The first release is successful when:

- Codex and Claude connect through standard OAuth without a private login hack.
- Each configured connection is bound to one project and cannot cross that
  boundary.
- Viewer, Editor, Admin, revoked, and removed-user behavior matches the defined
  matrix on every request.
- The declared Tools, Resources, and Prompts work in both clients.
- All released writes are atomic, audited, and protected against cross-project
  references; document writes are conflict-safe.
- The server meets the latency, query-count, pagination, payload, and cold-start
  budgets in representative fixtures.
- No normal tool execution uses `service_role`, and logs contain no token or full
  sensitive-content leakage.

