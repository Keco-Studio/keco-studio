# Keco MCP Phase 2 Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete project-bound Keco MCP product, including reads, non-destructive atomic writes, Resources, Prompts, search fallback, limits, audit, rate limiting, operations, deployment, and real Codex/Claude validation.

**Architecture:** A stateless Supabase Edge Function creates one immutable caller context per request and registers role-appropriate MCP capabilities over focused operation modules. Caller-JWT/RLS queries serve reads and table writes; hardened PostgreSQL RPCs own transactions, telemetry, and cross-project checks; document replacement alone uses a narrow service-role RPC after the trusted Edge codec constructs and verifies Yjs state.

**Tech Stack:** Deno 2.9.3, TypeScript 5.9.3, MCP TypeScript SDK 1.29.0, Supabase JS 2.87.1, PostgreSQL/RLS/pgvector/pg_trgm, Zod 4 through the MCP SDK, Yjs/Lexical/MDXEditor, Jest, Playwright, GitHub Actions.

## Global Constraints

- Work only in `/home/hetu/project/keco-studio/.worktrees/mcp-phase-2-complete` on branch `mcp-phase-2-complete`, based on `b9f02e53`.
- Implement first and add focused tests afterward; do not use TDD or require RED/GREEN evidence.
- Deliver original MCP Phases 2, 3, and 4 together as this single Phase 2.
- Do not add deletes, bulk imports, moves, irreversible operations, Agent confirmation state, or LLM orchestration.
- The endpoint path is the only project selector. Tool inputs and Resource query strings never accept `projectId`.
- Do not advertise, request, parse, or enforce unsupported `mcp:read` or `mcp:write` OAuth scopes.
- All reads and table/row writes use the caller JWT and RLS. Only trusted Yjs document replacement may use a dedicated service-role client and service-role-only RPC.
- Recheck current membership and role on every request and inside every mutation RPC. Viewer is read-only; editor/admin may use the released writes.
- Request body is strictly below 256 KiB; MCP response is strictly below 1 MiB; full document Markdown is at most 100 KiB UTF-8.
- Table/document page default is 50 and maximum 200; search default is 10 and maximum 30.
- Cursor envelopes are HMAC-SHA-256 authenticated with `MCP_CURSOR_SECRET`, project/operation/object-bound, and expire after 24 hours.
- Search is embedding-first with a five-second timeout and explicitly reports `semantic` or `text_fuzzy` plus the exact degradation reason.
- Rate limits per user/project/60-second bucket are: static 240, read 120, write 30, search 20.
- Audit retention is 90 days and audit/log metadata never includes credentials, raw document bodies, raw queries, or full row values.
- `update_document` requires epoch, revision, and the complete ordered update-ID tail; a mismatch returns `DOCUMENT_CONFLICT` without mutation.
- Formula fields are rejected by MCP creation/writes until PostgreSQL formula parity exists; media cells are not writable through MCP.
- Production target is Supabase `lulrcirmwwvvnupmwqcq`, Vercel `https://keco-studio-main.vercel.app`, acceptance project `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`.
- Never commit or print access tokens, refresh tokens, JWTs, authorization codes, PKCE values, service keys, client secrets, or unmasked personal data.

---

### Task 1: Request Context, Limits, Cursors, and MCP Result Boundary

**Files:**
- Create: `supabase/functions/mcp/context.ts`
- Create: `supabase/functions/mcp/limits.ts`
- Create: `supabase/functions/mcp/cursor.ts`
- Create: `supabase/functions/mcp/errors.ts`
- Create: `supabase/functions/mcp/results.ts`
- Create: `supabase/functions/mcp/context.test.ts`
- Create: `supabase/functions/mcp/cursor.test.ts`
- Create: `supabase/functions/mcp/results.test.ts`
- Modify: `supabase/functions/mcp/auth.ts`
- Modify: `supabase/functions/mcp/auth.test.ts`
- Modify: `supabase/functions/mcp/http.ts`
- Modify: `supabase/functions/mcp/http.test.ts`
- Modify: `supabase/functions/mcp/server.ts`

**Interfaces:**
- Produces `McpRequestContext`, `createMcpRequestContext(request, authContext)`, `PageEnvelope<T>`, `encodeCursor`, `decodeCursor`, `McpDomainError`, `toolSuccess`, and `toolFailure`.
- `handleProtocolRequest(request, context, dependencies?)` becomes the only protocol entry point.

- [ ] **Step 1: Implement the immutable request context.** Extract the bearer value once, build a Supabase client with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and that bearer header, generate a UUID request ID, and retain token/client identity only in memory. Extend authorization to return the bearer value and safe verified client identifier without logging either.
- [ ] **Step 2: Implement shared hard limits and byte accounting.** Export exact constants from Global Constraints, validate integer limits without silent clamping, and measure UTF-8 with `TextEncoder`.
- [ ] **Step 3: Implement authenticated opaque cursors.** Use Web Crypto HMAC-SHA-256, canonical JSON fields `{v,kind,projectId,objectId,position,expiresAt}`, base64url encoding, constant-time signature comparison, and stable `INVALID_CURSOR` errors.
- [ ] **Step 4: Implement public domain errors and MCP result mapping.** Allow only the stable codes from the design, return `isError: true` for expected Tool failures, and turn unknown errors into `INTERNAL_ERROR` without internal messages.
- [ ] **Step 5: Thread context through HTTP and protocol handling.** Preserve existing OAuth challenge/CORS/body/response behavior and ensure no protocol callback can be invoked without authorized context.
- [ ] **Step 6: Add focused tests after implementation.** Cover token non-serialization, viewer/editor contexts, missing env, cursor tamper/expiry/project/kind/object mismatch, exact byte boundaries, safe errors, and authorized HTTP context propagation.
- [ ] **Step 7: Verify and commit.** Run `npm run check:mcp` and `npm run test:mcp`; expect all MCP checks to pass. Commit `feat: add mcp request execution boundary`.

### Task 2: Database Read, Search, Rate Limit, and Audit Foundation

**Files:**
- Create: `supabase/migrations/20260722010000_mcp_read_search_telemetry.sql`
- Create: `tests/unit/database/mcp-read-search-telemetry-migration.test.ts`
- Create: `tests/unit/database/mcp-read-search-telemetry.behavior.test.ts`
- Modify: `tests/unit/database/helpers/rlsTestClient.ts`

**Interfaces:**
- Produces RPCs `mcp_read_project_structure`, `mcp_text_search`, `mcp_vector_search`, `mcp_begin_operation`, `mcp_complete_operation`, and `mcp_cleanup_telemetry`.
- Produces tables `mcp_rate_limit_buckets` and `mcp_audit_events` plus document listing/search indexes.

- [ ] **Step 1: Create hardened telemetry tables.** Use append-only audit rows and atomic fixed-window buckets; revoke all direct access from `public`, `anon`, and `authenticated`; add indexes for operations, alerts, and 90-day cleanup.
- [ ] **Step 2: Implement admission/completion RPCs.** Derive actor with `auth.uid()`, recheck accepted project role, enforce exact class limits, bound every text/json argument, return operation ID/remaining/reset time, and prevent callers from completing another user's operation.
- [ ] **Step 3: Implement fixed-query structure RPC.** Return project/folders/tables/fields plus at most 200 document summaries without rows or content, using one SQL statement/RPC and endpoint project checks.
- [ ] **Step 4: Implement semantic and fallback search RPCs.** `mcp_vector_search` derives the actor, excludes chat sources, searches library/document sources with maximum 30; `mcp_text_search` uses full-text plus `pg_trgm` similarity across schemas, rows, and documents with bounded excerpts and project/RLS checks.
- [ ] **Step 5: Add required indexes and cleanup scheduling function.** Add `(project_id, updated_at DESC, id DESC)` for documents, project/source vector support, and text-search indexes justified by the implemented queries. Cleanup function remains unavailable to MCP roles.
- [ ] **Step 6: Add migration contract and local Postgres behavior tests after implementation.** Cover grants/search paths, viewer read, editor/admin access, outsider/removed/dual-project denial, fixed result bounds, vector exclusion of chat, text fallback, class limits, concurrent admission, redaction bounds, immutable audit, and 90-day cleanup.
- [ ] **Step 7: Verify and commit.** Run the two Jest test files; when local Supabase is available run with `RLS_DB_TESTS=1`. Commit `feat: add mcp read search and telemetry rpcs`.

### Task 3: Atomic Table, Row, and Document RPCs

**Files:**
- Create: `supabase/migrations/20260722020000_mcp_atomic_writes.sql`
- Create: `tests/unit/database/mcp-atomic-writes-migration.test.ts`
- Create: `tests/unit/database/mcp-atomic-writes.behavior.test.ts`

**Interfaces:**
- Produces caller-JWT RPCs `mcp_create_table`, `mcp_create_table_row`, `mcp_update_table_row`, `mcp_create_document`.
- Produces service-role-only `mcp_replace_document_content`.

- [ ] **Step 1: Implement common SQL validation helpers.** Use `search_path = ''`, derive caller identity, validate editor/admin membership, normalize semantic labels, validate scalar/array/boolean/date/enum/reference types, reject formula/media writes, validate reference target project/table/row/field, and expose no helper to anon/public.
- [ ] **Step 2: Implement atomic table creation.** Validate 1-100 ordered fields, unique normalized labels, folder and reference tables, reject formula definitions, insert table/fields/one truly empty row, touch ancestors, and roll back all state on failure.
- [ ] **Step 3: Implement atomic row creation.** Serialize per table with an advisory lock, reuse one visibly empty row or allocate the next row index, validate the complete row including required and boolean defaults, derive legacy name, persist cells/timestamps, and return stable IDs.
- [ ] **Step 4: Implement atomic row update.** Require exactly one selector, resolve UI row ordering with stable tie-breakers, optionally verify expected row ID, merge and validate the locked row, prevent required clears, persist the patch and authoritative timestamps, and never update another table/project.
- [ ] **Step 5: Implement atomic document creation.** Accept only trusted normalized Markdown/Yjs pairs, validate folder/name/duplicates/payloads, create collaborative state directly at epoch 0/revision 1/reason `initialize`, and return the full token.
- [ ] **Step 6: Implement trusted document replacement.** Keep it service-role-only, accept authenticated actor/project from the Edge handler, recheck current role, lock document, compare epoch/revision/full ordered tail, insert one `pre_agent` backup from trusted merged state, replace content/Yjs, increment epoch/revision/reason, remove consumed tail, and fail with `PT409` atomically.
- [ ] **Step 7: Add migration and local database tests after implementation.** Cover all roles, removed users, every cross-project identifier position, label ambiguity, every supported writable type, enum/reference/required/empty-row behavior, concurrency allocation, row-index expected-ID conflict, formula/media rejection, partial-failure rollback, direct authenticated denial of document replacement, and two-writer document conflict.
- [ ] **Step 8: Verify and commit.** Run targeted Jest suites and local behavior tests. Commit `feat: add atomic mcp write rpcs`.

### Task 4: Read Tools, Search, Resources, and Prompts

**Files:**
- Create: `supabase/functions/mcp/database.ts`
- Create: `supabase/functions/mcp/telemetry.ts`
- Create: `supabase/functions/mcp/project-operations.ts`
- Create: `supabase/functions/mcp/table-operations.ts`
- Create: `supabase/functions/mcp/document-operations.ts`
- Create: `supabase/functions/mcp/search.ts`
- Create: `supabase/functions/mcp/resources.ts`
- Create: `supabase/functions/mcp/prompts.ts`
- Create: `supabase/functions/mcp/read-tools.ts`
- Create: `supabase/functions/mcp/project-operations.test.ts`
- Create: `supabase/functions/mcp/table-operations.test.ts`
- Create: `supabase/functions/mcp/document-operations.test.ts`
- Create: `supabase/functions/mcp/search.test.ts`
- Create: `supabase/functions/mcp/resources.test.ts`
- Create: `supabase/functions/mcp/prompts.test.ts`
- Modify: `supabase/functions/mcp/deno.json`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`

**Interfaces:**
- Registers the five read Tools, seven Resource URIs/templates, and three Prompts.
- Produces operation functions reused by Tool and Resource callbacks.

- [ ] **Step 1: Implement caller-JWT data and telemetry adapters.** Wrap typed PostgREST/RPC results, map database codes safely, run admission/completion around operations, and emit one redacted JSON telemetry line.
- [ ] **Step 2: Implement project and table reads.** Use the structure RPC; query one table page plus only that page's values; enforce `row_index,id` cursors, selected semantic labels, exact row lookup, default/max limits, and foreign-project not-found behavior.
- [ ] **Step 3: Implement document reads.** Page metadata by `updated_at,id`; read snapshot and ordered tail consistently; merge Yjs state; return full state token; support full/outline/heading/line modes and 100 KiB UTF-8 fallback metadata.
- [ ] **Step 4: Implement embedding-first search.** Support OpenAI-compatible and MiniMax response shapes, five-second abort timeout, exact vector dimension, a worker-local 128-entry/10-minute hashed-query LRU, caller-JWT vector RPC, and explicit text/fuzzy fallback reasons.
- [ ] **Step 5: Register strict read Tools and annotations.** Do not accept project IDs or unknown properties; return structured content plus concise text; keep probe available and update its phase marker.
- [ ] **Step 6: Implement strict Resources.** Register three static resources and four templates with the SDK `ResourceTemplate`; parse canonical `keco:` URLs, reject unexpected URL features/queries/traversal, and call the same operations as Tools.
- [ ] **Step 7: Implement static Prompts.** Register exact prompt names and strict arguments, return useful MCP messages, and never execute data reads/writes during prompt retrieval.
- [ ] **Step 8: Add focused tests after implementation.** Cover capability declaration, all list/get/read methods, annotations/schemas, fixed query behavior, cursors/pages, payload fallback, URI abuse, prompt validation, vector success, each fallback reason, both-search failure, telemetry redaction, and viewer-visible read surface.
- [ ] **Step 9: Verify and commit.** Run `npm run check:mcp` and `npm run test:mcp`. Commit `feat: add mcp reads resources prompts and search`.

### Task 5: Write Tools and Edge Document Codec

**Files:**
- Create: `supabase/functions/mcp/write-tools.ts`
- Create: `supabase/functions/mcp/write-operations.ts`
- Create: `supabase/functions/mcp/document-codec.ts`
- Create: `supabase/functions/mcp/write-tools.test.ts`
- Create: `supabase/functions/mcp/write-operations.test.ts`
- Create: `supabase/functions/mcp/document-codec.test.ts`
- Modify: `supabase/functions/mcp/deno.json`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify only when required for cross-runtime purity: `src/lib/documents/documentContentCodec.ts`
- Modify only when required for cross-runtime purity: `src/lib/documents/headlessDocumentNodes.ts`

**Interfaces:**
- Registers five write Tools only for editor/admin contexts.
- Provides `encodeDocumentMarkdown`, `readNormalizedDocumentState`, and `replaceDocumentWithToken`.

- [ ] **Step 1: Establish Deno codec compatibility.** Reuse the real Yjs/Lexical/sanctioned-MDX authority without Next.js aliases, DOM, Node globals, or `service-only`; add import-map aliases only for pinned packages. If the full codec cannot run in Supabase Deno after focused remediation, stop this task as blocked rather than ship corrupt document writes.
- [ ] **Step 2: Implement table/row write adapters.** Strictly validate bounded schemas, generate operation IDs/client IDs, call exactly one primary RPC each, map stable errors, and never expose formula/media writes or service credentials.
- [ ] **Step 3: Implement document creation.** Validate/normalize Markdown, generate Yjs, call caller-JWT `mcp_create_document`, and return the full token.
- [ ] **Step 4: Implement document replacement.** Read a consistent current snapshot/tail with caller JWT, verify the client token before expensive codec work, merge/normalize current state, normalize replacement Markdown/Yjs, create a dedicated service-role client only for `mcp_replace_document_content`, and discard it after the call. Never log its key or headers.
- [ ] **Step 5: Register write Tools conditionally.** Viewer `tools/list` excludes them and direct calls fail; editor/admin lists include accurate non-destructive/non-idempotent annotations. Prompt content remains static across roles.
- [ ] **Step 6: Add focused tests after implementation.** Cover strict schemas, unknown fields, role filtering/direct denial, one-RPC writes, secret isolation, SQL error mapping, codec parity fixtures, unsafe MDX, create token, stale epoch/revision/tail, concurrent replacement, and no mutation on conflict.
- [ ] **Step 7: Verify and commit.** Run Deno check/tests plus relevant Node document codec tests. Commit `feat: add non destructive mcp write tools`.

### Task 6: Integration, Performance, Operations, and Production Release

**Files:**
- Create: `scripts/probe-mcp-capabilities.ts`
- Create: `scripts/load-mcp-phase-2.ts`
- Create: `tests/unit/mcp/capabilities-probe.test.ts`
- Create: `tests/unit/mcp/load-probe.test.ts`
- Create: `docs/mcp/README.md`
- Create: `docs/mcp/operations-runbook.md`
- Create after real verification: `docs/mcp/phase-2-client-matrix.md`
- Create after real verification: `docs/mcp/phase-2-performance.json`
- Modify: `scripts/probe-mcp-performance.ts`
- Modify: `tests/unit/mcp/performance-probe.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/README.md`

**Interfaces:**
- Produces non-secret repeatable protocol/load probes, operational queries/runbook, and production evidence.

- [ ] **Step 1: Extend protocol and performance probes.** Verify Tools/Resources/templates/Prompts, bounded reads, explicit search mode, disposable writes, conflict behavior, refresh/revocation/downgrade hooks, and operation-class latency without persisting credentials.
- [ ] **Step 2: Implement representative load fixtures and gates.** Exercise 100 tables, 2,000 fields, 100,000 rows, 1,000 documents, fixed structure query count, cursor/payload edges, concurrent writes/conflicts, rate bursts, embedding fallback, and exact P95 budgets.
- [ ] **Step 3: Add CI and local commands.** Ensure migrations reset locally, DB behavior tests run with RLS, MCP Deno checks run, probe unit tests run, and secret/evidence scans fail CI on credential-shaped material or placeholders.
- [ ] **Step 4: Write setup and operations documentation.** Document Codex/Claude configuration, project-bound URL, OAuth behavior without unsupported scopes, dashboards/queries, alert thresholds, audit retention, provider degradation, revocation, rollback, and reindex repair.
- [ ] **Step 5: Run full local verification.** Run `npm run lint`, `npm run typecheck`, `npm run typecheck:api`, `npm run check:mcp`, `npm run test:mcp`, `npm run test:unit -- --runInBand`, `npm run build`, targeted Playwright, `git diff --check`, migration reset/behavior tests, load probe, and credential scan. Record exact pass/fail evidence.
- [ ] **Step 6: Request whole-branch review and fix findings.** Review `b9f02e53..HEAD` against the approved design; fix all Critical and Important findings and rerun covering tests.
- [ ] **Step 7: Push and create a PR.** Push `mcp-phase-2-complete`, open a PR to `main`, monitor all checks, diagnose and fix failures, and merge only when required CI/review gates pass.
- [ ] **Step 8: Deploy production.** Apply new migrations to Supabase `lulrcirmwwvvnupmwqcq`, deploy the `mcp` Edge Function with required non-secret config/secrets present, confirm Vercel main deployment, and wait for deployment propagation.
- [ ] **Step 9: Run real Codex and Claude acceptance.** Against project `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`, verify OAuth, refresh, capability discovery, reads, actual search mode, disposable writes, conflict, cross-project denial, downgrade/removal on next request, restored fixture access, latency, rate/audit telemetry, and no credential leakage.
- [ ] **Step 10: Commit non-secret evidence.** Create the client matrix and performance evidence only from observed results, scan them for secrets/placeholders, commit them, and merge the evidence follow-up if production evidence cannot exist before the initial deploy.

## Plan Self-Review

- Every Tool, Resource, Prompt, RPC, security boundary, pagination/payload rule, search mode, rate class, audit requirement, client gate, performance gate, monitoring requirement, deployment step, and explicit exclusion in the approved design maps to a task above.
- Interfaces use the same names across tasks; document state token is consistently `{epoch, revision, updateIds}`.
- The sole privileged exception is isolated to `mcp_replace_document_content`; no generic operation or table path receives a service-role client.
- No placeholder implementation or deferred original Phase 2/3/4 work remains. Production evidence files are intentionally created only after observations exist, preventing fabricated evidence.
