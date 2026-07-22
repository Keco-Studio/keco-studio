# Keco MCP Phase 2 Complete Delivery Design

**Date:** 2026-07-22
**Status:** Approved for implementation
**Supersedes:** The separate Phase 2, Phase 3, and Phase 4 delivery boundaries in `2026-07-21-supabase-mcp-server-design.md`
**Production target:** Supabase project `lulrcirmwwvvnupmwqcq`, Vercel `https://keco-studio-main.vercel.app`
**Production acceptance project:** `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`

## 1. Outcome

This delivery turns the existing authenticated Phase 1 connection probe into the
complete first Keco MCP product. One project-bound Supabase Edge Function exposes
bounded read Tools, non-destructive write Tools, Resources, and Prompts to Codex
and Claude. PostgreSQL remains the authorization and transaction boundary; all
reads and table/row writes use the caller's JWT and RLS. The only privileged
exception is the document replacement RPC described in section 8.2, because
PostgreSQL cannot independently validate Yjs snapshot semantics.

The work previously described as Phases 2, 3, and 4 ships as this single Phase 2.
Implementation may use several commits and internal tasks, but the release is not
complete until protocol, data, security, performance, operations, deployment, and
real-client gates all pass.

Deletes, bulk imports, moves, irreversible operations, Agent confirmation state,
and LLM orchestration remain excluded.

## 2. Existing Production Baseline

Phase 1 is deployed and proves the following production path:

- stateless Streamable HTTP through `/functions/v1/mcp/{projectId}`;
- Supabase OAuth authorization code flow with PKCE;
- project binding preserved from authorization through consent and token exchange;
- a current membership check on every protected request;
- Codex OAuth login and invocation of `keco_connection_probe`.

The current Edge server declares only Tools and registers only the probe. It has
no business operations, Resources, Prompts, operation context, audit, or rate
limits. Phase 2 extends that baseline rather than replacing the OAuth flow.

Supabase Auth rejected custom `mcp:read` and `mcp:write` scopes in production.
Therefore Phase 2 must not advertise, request, parse, or depend on those scopes.
The effective permission is instead the intersection of:

1. a valid access token issued for the exact protected resource;
2. the endpoint-bound project ID;
3. the user's current accepted project membership and role; and
4. the operation's required role.

The OAuth consent screen continues to name the bound project. The protected
resource metadata omits unsupported scopes. Supabase identity scopes such as
`openid profile email phone` do not grant Keco project permissions.

## 3. External MCP Contract

### 3.1 Tools

The server keeps `keco_connection_probe` and adds these read Tools:

| Tool | Contract |
|---|---|
| `list_project_structure` | Return project metadata, folders, table schemas, and bounded document summaries without table rows. |
| `query_table_rows` | Read one table page, optionally selecting semantic field labels and an exact 1-based row index. |
| `list_documents` | Read a deterministic page of document metadata. |
| `read_document` | Read full, outline, heading, or line-bounded Markdown and return a stable document state token. |
| `semantic_search` | Search project tables and documents, using embeddings first and an explicit text/fuzzy fallback. |

It adds these non-destructive write Tools:

| Tool | Contract |
|---|---|
| `create_table` | Atomically create one table, its fields, and its initial empty row. |
| `create_table_row` | Atomically reuse the first empty row or append one row, validating semantic field labels and values. |
| `update_table_row` | Atomically update one row selected by stable row ID or exact 1-based row index. |
| `create_document` | Atomically create a document with initialized Markdown and authoritative Yjs state. |
| `update_document` | Replace Markdown only when the supplied state token and included Yjs update IDs still match. |

Every input schema is strict. Unknown properties, caller-supplied project IDs,
malformed UUIDs, ambiguous duplicate field labels, unrecognized field labels,
invalid enum/reference/formula values, invalid Markdown/MDX, and oversized input
fail with a stable domain error. A dual-project member cannot use an identifier
from another accessible project through the bound endpoint.

Read Tools use:

```json
{
  "readOnlyHint": true,
  "destructiveHint": false,
  "idempotentHint": true,
  "openWorldHint": false
}
```

Create Tools are non-read-only, non-destructive, and non-idempotent. Update Tools
are non-read-only and non-destructive; `idempotentHint` is false because conflict
tokens and server timestamps make replay behavior observable.

### 3.2 Resources

The server declares Resources and resource templates accurately:

```text
keco://project
keco://project/structure
keco://tables
keco://tables/{tableId}/schema
keco://tables/{tableId}/rows
keco://documents
keco://documents/{documentId}
```

`resources/list` returns only the three bounded entry resources
`keco://project`, `keco://tables`, and `keco://documents`. Parameterized table and
document access is exposed through templates. Collection Resources accept only
documented `limit` and `cursor` query parameters. Unknown parameters, fragments,
userinfo, ports, path traversal, non-canonical paths, malformed IDs, and foreign
project IDs are rejected.

Resources return `application/json` text. The same operation layer powers Tools
and Resources so authorization, ordering, pagination, audit, and payload behavior
cannot drift.

### 3.3 Prompts

The static, version-controlled prompt registry contains:

- `analyze_project`: inspect structure, then read bounded tables/documents before summarizing;
- `build_tables_from_document`: inspect a document, propose a schema, then use explicit table write calls;
- `update_project_data`: inspect the target schema and rows, then make explicit row updates.

`prompts/get` validates strict arguments and returns MCP prompt messages only. It
never reads project data or executes a mutation. Prompt retrieval remains
available to all authorized project roles, even when the prompt describes a
write workflow; the eventual write Tool enforces the role.

## 4. Request Context and Authorization

HTTP authorization produces one immutable request context:

```ts
type McpRequestContext = {
  requestId: string;
  projectId: string;
  userId: string;
  role: 'admin' | 'editor' | 'viewer';
  accessToken: string;
  clientId: string | null;
  db: SupabaseClient;
};
```

The database client is configured with the inbound access token. The token is
held only in memory for the request and is never serialized, logged, included in
errors, or passed to audit functions. Tool and Resource code can access data only
through this context.

The HTTP layer resolves the role once for capability filtering, then every query
is still protected by RLS and every write RPC rechecks current membership through
`auth.uid()`. A viewer receives read Tools only. Admin and editor roles receive
the full non-destructive Tool set. Removal or downgrade takes effect on the next
request; an old access token cannot preserve the previous role.

If a verified token contains a stable OAuth client identifier, it is copied into
`clientId`; otherwise it remains null. Missing client identity never weakens rate
limits because the mandatory key is user plus project plus operation class.

## 5. Operation Layer

The Edge function is split into focused modules:

- protocol registry and result/error mapping;
- request context and caller-JWT database client;
- strict schemas and common limits;
- opaque cursor codec and response byte accounting;
- project/table/document read operations;
- search provider and fallback orchestration;
- write RPC adapters and document codec;
- Resource URI parser and Resource handlers;
- static Prompt registry;
- rate admission, audit completion, and safe telemetry.

Handlers return structured objects. One adapter converts them to MCP text and
`structuredContent`. Expected domain failures become a valid Tool result with
`isError: true`, a concise message, and a stable code. Internal SQL, PostgREST
details, stack traces, existence in another project, and secrets are never
returned.

Initial error codes are:

```text
PROJECT_ACCESS_REVOKED
WRITE_FORBIDDEN
TABLE_NOT_FOUND
ROW_NOT_FOUND
DOCUMENT_NOT_FOUND
FIELD_VALIDATION_FAILED
DOCUMENT_CONFLICT
INVALID_CURSOR
INVALID_RESOURCE_URI
PAYLOAD_TOO_LARGE
RATE_LIMITED
SEARCH_DEGRADED
UPSTREAM_EMBEDDING_UNAVAILABLE
INTERNAL_ERROR
```

## 6. Read Design

### 6.1 Project Structure

`list_project_structure` performs a fixed number of project-bounded queries, not
one schema query per table. The target is three database round trips:

1. project, folders, and tables;
2. all field definitions for the returned table IDs;
3. at most 200 document summaries ordered by `updated_at DESC, id DESC`.

The operation joins records in memory. Its round-trip count is constant as table
count grows and it never loads table rows or document bodies.

### 6.2 Table Rows

Rows are ordered by `row_index ASC, id ASC`. A page fetches at most `limit + 1`
assets for one bound-project table and then fetches values only for those asset
IDs. It never hydrates the full table. Fields are returned using their semantic
labels plus stable IDs; duplicate normalized labels make semantic writes fail
closed until the schema is disambiguated.

Default row limit is 50 and maximum is 200. A direct `rowIndex` lookup returns at
most one row and cannot be combined with a cursor. Optional selected fields are
resolved against the table schema before reading values.

### 6.3 Documents

Document listings use `updated_at DESC, id DESC` keyset ordering. Default limit is
50 and maximum is 200. A matching `(project_id, updated_at DESC, id DESC)` index
supports the path.

`read_document` merges the stored Yjs snapshot with the ordered update tail and
derives Markdown from authoritative state. It returns:

```json
{
  "stateToken": {
    "epoch": 4,
    "revision": 18,
    "updateIds": ["..."]
  }
}
```

Full reads are bounded to 100 KiB of UTF-8 Markdown before JSON/MCP overhead. If
the body exceeds the budget, the operation returns an outline and explicit
truncation metadata instead of a partial body. Heading and 1-based inclusive line
reads are independently bounded. The overall MCP response remains strictly below
1 MiB.

### 6.4 Pagination

Cursors are opaque base64url JSON envelopes with version, operation kind, bound
object ID, ordering tuple, and expiry. They are authenticated with HMAC-SHA-256
using `MCP_CURSOR_SECRET`, expire after 24 hours, and are bound to the endpoint
project. A cursor from another operation, project, or table is invalid.

Every paged result includes:

```json
{
  "items": [],
  "returnedCount": 0,
  "hasMore": false,
  "nextCursor": null
}
```

No collection silently truncates.

## 7. Search Design

`semantic_search` accepts a 1-1000 code-point query, an optional source filter,
and a default limit of 10 with a maximum of 30.

The preferred path is:

1. normalize the query;
2. obtain one query embedding with a five-second hard timeout;
3. call a caller-JWT vector RPC that derives the actor from `auth.uid()`, binds
   the supplied project, excludes private chat chunks, and returns bounded
   library/document excerpts;
4. report `searchMode: "semantic"`.

The Edge worker keeps a bounded 128-entry, 10-minute LRU of query vectors keyed
by provider, model, dimensions, and SHA-256 of normalized text. Correctness does
not depend on cache survival across workers.

When embedding configuration is absent, the provider times out/rate-limits, the
vector has the wrong dimension, or vector search is unavailable, the operation
runs the text/fuzzy RPC instead of failing the entire MCP service. The fallback
combines PostgreSQL full-text ranking with `pg_trgm` similarity/substring matching
over table schemas, row values, document names, and document content. It is
project-bound and RLS-protected.

Fallback results always report:

```json
{
  "searchMode": "text_fuzzy",
  "degraded": true,
  "degradationReason": "embedding_timeout"
}
```

Allowed reasons are `embedding_not_configured`, `embedding_timeout`,
`embedding_rate_limited`, `embedding_invalid_response`, and
`vector_search_unavailable`. Fallback is never described as semantic search. If
both paths fail, the Tool returns `UPSTREAM_EMBEDDING_UNAVAILABLE` with no secret
or upstream body.

## 8. Write Design

All write Tools require editor or admin role and use one primary PostgreSQL RPC.
Each caller-JWT `SECURITY DEFINER` RPC has `search_path = ''`, derives the actor
from `auth.uid()`, checks the bound project and every referenced object,
validates inputs, revokes default execution, and grants only `authenticated`.

### 8.1 Tables and Rows

`mcp_create_table` validates the folder, unique table name, 1-100 fields, field
types, enum options, and reference table ownership. Formula fields are rejected
until PostgreSQL has proven parity with Keco's TypeScript formula engine. It
creates the table, ordered fields, and row 1 atomically. It rejects duplicate
normalized field labels.

`mcp_create_table_row` locks the table's rows, resolves labels to field IDs,
validates required values, scalar/array/enum/reference types, rejects writes to
formula and media fields, then reuses the first empty display row using Keco's
visible-value rules or allocates
`max(row_index) + 1`. Row creation, value upsert, and timestamp touches are one
transaction.

`mcp_update_table_row` selects exactly one target using either `rowId` or
`rowIndex`, never both. It locks the row, performs the same field validation,
upserts the requested values, and touches the row/table/folder/project timestamps
in one transaction. Empty updates are rejected.

References accept stable `{assetId, fieldId}` entries only. The referenced row,
field, allowed reference table, and bound project are all checked in SQL. Display
labels are derived when read rather than persisted as a cross-row cache, so a
single row transaction cannot leave stale reference labels.

### 8.2 Documents

The existing Keco document codec is the compatibility authority. A small
Edge-compatible codec module uses the same Yjs/Lexical node and sanctioned MDX
rules; shared fixtures prove byte-level decodability and Markdown equivalence in
Node and Deno.

`mcp_create_document` receives validated Markdown and its generated Yjs snapshot,
checks the folder project, creates the document with collaboration epoch 0 and
revision 1, and writes all state in one transaction. It does not create a legacy
Markdown-only row.

`update_document` requires the complete `stateToken` returned by
`read_document`. The Edge codec merges the current snapshot and update tail,
derives current Markdown, validates replacement Markdown, and generates the
replacement Yjs snapshot. Unlike other operations, replacement invokes a
`service_role`-only RPC through a dedicated client created inside this handler.
The RPC accepts the already authenticated `actorUserId`, but independently locks
and verifies current project membership and role, project/document identity, and
the complete conflict token. The privileged client is never exposed to shared
operation helpers and is destroyed with the request. This narrow exception is
required because SQL can validate canonical base64 and bounds but cannot prove
that a purported merged Yjs snapshot actually contains the database update tail.

The RPC locks the document and verifies:

- document belongs to the endpoint-bound project;
- current epoch and revision equal the token;
- the ordered update-ID tail equals the token;
- current/replacement snapshots and Markdown meet size/format invariants.

It creates a `pre_agent` version from the trusted codec's fully merged current
state, replaces Yjs and Markdown, increments epoch and
revision, records epoch reason `agent`, and removes only the consumed old-epoch
updates in the same transaction. Any mismatch returns `DOCUMENT_CONFLICT` and
does not modify data. This Tool does not ship unless cross-runtime codec fixtures
and concurrent conflict tests pass. The privileged RPC remains revoked from
`public`, `anon`, and `authenticated`; direct caller-JWT invocation must fail.

Embedding reindex is asynchronous and never changes mutation success. A failed
reindex is observable through telemetry and later repair tooling.

## 9. Rate Limits and Audit

Rate limiting is PostgreSQL-backed and cannot be bypassed by reaching another
Edge instance. The key is `{userId, projectId, operationClass, 60-second bucket}`.
Exact initial limits are:

| Class | Limit per user/project |
|---|---:|
| static protocol (`initialize`, lists, prompts) | 240/minute |
| read | 120/minute |
| write | 30/minute |
| search | 20/minute |

One hardened `mcp_begin_operation` RPC rechecks membership, atomically increments
the appropriate bucket, and appends an admission audit event. It returns a random
operation ID and remaining allowance. Rejected admission appends a rate-limited
event when possible and returns `RATE_LIMITED`. Protocol-wide abuse may return
HTTP 429; a Tool-specific rejection is a valid MCP Tool error.

After execution, `mcp_complete_operation` appends a completion event referencing
the operation ID. Audit storage is append-only: authenticated callers have no
direct select/insert/update/delete grants. Functions accept only bounded safe
metadata and derive user ID themselves.

Audit events include request/operation ID, timestamp, project, actor, optional
stable client ID, operation name/class, admitted/completed/rate-limited status,
stable error code, total/database/embedding/serialization duration, request and
response bytes, and a filtered argument summary. They exclude tokens, auth codes,
PKCE data, client secrets, raw document bodies, raw search queries, full row
values, and upstream error bodies. Search audit stores query length and hash only.

Audit retention is 90 days. A scheduled cleanup function deletes expired audit
and rate-bucket rows using a privileged database schedule; normal MCP roles cannot
invoke cleanup. Missing completion events older than five minutes are an alert
signal, not a reason to mutate admission history.

## 10. Performance and Payload Budgets

| Surface | Budget |
|---|---:|
| incoming HTTP body | less than 256 KiB |
| outgoing MCP response | less than 1 MiB |
| full document Markdown | at most 100 KiB UTF-8 |
| table rows | default 50, maximum 200 |
| document metadata | default 50, maximum 200 |
| search results | default 10, maximum 30 |
| warm static protocol P95 | under 300 ms |
| ordinary read P95 | under 800 ms |
| project structure P95 | under 1 s |
| ordinary write P95 | under 1 s |
| semantic search P95 | under 3 s |
| cold request P95 | under 2 s |

Ordinary reads use no more than three database round trips. Compound writes use
one primary RPC plus admission/completion telemetry. Static registries never load
project data. The Edge bundle does not import the Next.js Agent loop, chat client,
script import pipeline, or UI.

Load fixtures cover at least 100 tables, 2,000 fields, 100,000 rows, and 1,000
documents with large content. Tests assert fixed project-structure query count,
index-backed cursor queries, payload boundaries, concurrent writes, document
conflicts, embedding timeout fallback, and sustained/burst rate behavior.

## 11. Monitoring and Operations

The function emits one bounded JSON log line per request with correlation ID,
operation, outcome, stable error code, class, duration components, byte counts,
role, and a one-way hash of user/project identifiers. It never logs authorization
headers, JWTs, raw IDs alongside personal data, argument bodies, or SQL errors.

Production documentation defines queries/dashboard panels for:

- request volume and success/error/rate-limit ratios;
- P50/P95/P99 total latency by operation class;
- authorization 401/403 and membership revocation;
- database and serialization time;
- semantic versus fallback search share and embedding health;
- document conflict rate;
- missing audit completion events;
- Edge 5xx/cold-start behavior.

Alert thresholds are: 5xx above 2% for five minutes, P95 above twice its class
budget for ten minutes, embedding fallback above 25% for fifteen minutes,
rate-limited calls above 20% for ten minutes, or any detected credential-shaped
audit/log value. The runbook covers provider degradation, rate-limit tuning,
revocation, migration rollback, Edge rollback, and reindex repair.

## 12. Verification and Release Gates

Implementation follows the user's explicit speed constraint: implement first,
then add and run focused verification. TDD is not used.

Required automated evidence:

- Deno typecheck and unit/integration tests for all MCP methods and registrations;
- strict schema, annotation, cursor, URI, error, byte-budget, and fallback tests;
- local migrated-Postgres tests for every RPC, RLS role, cross-project denial,
  atomic failure, rate limit, audit redaction, and document conflict;
- Node/Deno document codec compatibility fixtures;
- full repository lint, typechecks, unit tests, build, and relevant Playwright;
- load/performance evidence against representative fixtures;
- secret scan over logs and committed evidence.

Required real-client evidence after merge and production deployment:

1. Codex and Claude independently complete OAuth for the exact production project.
2. Both discover Tools, Resources/templates, and Prompts.
3. Both read structure, a bounded table page, and a document.
4. Both run semantic search and expose its actual `searchMode`.
5. Both create and update disposable, non-destructive test data with user approval.
6. A stale document token returns `DOCUMENT_CONFLICT` without overwrite.
7. Token refresh works without reconfiguration.
8. Membership removal and viewer downgrade reject the next write request; access
   is restored only after the membership fixture is restored.
9. Cross-project identifiers fail without revealing foreign content.
10. Production latency and rate/audit telemetry meet the stated budgets.

The feature branch is pushed as a PR, CI must pass, review findings classified
Critical/Important must be fixed, the PR is merged to `main`, Supabase migrations
and Edge Function are deployed to `lulrcirmwwvvnupmwqcq`, Vercel main deployment
is allowed to settle, and production probes are rerun. No completion claim is
made from CI or source inspection alone.

## 13. Acceptance Criteria

Phase 2 is complete only when all of the following are true:

- the external Tool, Resource, and Prompt contract above is implemented and
  accurately advertised;
- viewer/editor/admin, removal, downgrade, and dual-project behavior is correct;
- every write is non-destructive, atomic, caller-JWT authorized, and audited;
- document create/update preserves Yjs, Markdown, version, and conflict invariants;
- search is embedding-first and explicitly identifies every fallback;
- pagination, byte limits, rate limits, audit retention, monitoring, and runbooks
  are operational;
- Codex and Claude pass real production compatibility checks;
- CI, review, merge, Supabase deployment, Vercel deployment, and production
  verification are complete;
- no MCP path uses `service_role` except the narrowly scoped, server-generated
  Yjs document replacement described in section 8.2, and no sensitive credential
  or full content is present in logs, audit metadata, evidence, or client errors.
