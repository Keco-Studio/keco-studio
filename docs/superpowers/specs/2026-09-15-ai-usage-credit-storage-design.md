# AI Usage, Credit, and Storage Accounting Design

**Date:** 2026-09-15

**Status:** Approved for implementation

## Goal

Give Keco Admin an authoritative account-wide and per-user view of external AI
usage and stored files. DeepSeek usage is converted using the approved business
rule:

```text
3 DeepSeek tokens = 1 Keco Credit
```

The system must retain provider-reported raw usage, attribute it to the user and
feature that caused it, count every provider request that can incur cost, and
avoid presenting missing usage as zero. Storage is a separate physical-byte
metric and is never converted into Credits.

## Product Rules

- A DeepSeek Credit is derived from provider-reported total tokens. Input and
  output tokens currently have equal weight.
- For any aggregation group, sum all billable DeepSeek tokens first and then
  compute `ceil(sum(total_tokens) / 3)`. Do not round each request separately.
- A request repair, model-output retry, worker retry, or other new provider
  request can incur cost and therefore produces a distinct usage event.
- Retrying persistence for the same provider attempt must not produce another
  event. Every outbound attempt receives one stable event key that is reused
  only for persistence retries.
- `max_tokens` and `max_completion_tokens` are limits, not usage, and never
  participate in Credit calculation.
- Usage missing from a provider response is unknown, not zero. Unknown events
  are retained and make the corresponding aggregate incomplete.
- MiniMax vision, embeddings, and PixelLab are recorded in the same audit
  surface but do not consume Keco Credits under pricing rule version 1.
- Historical calls made before this ledger is deployed cannot be reconstructed
  reliably. Admin must show the tracking start time and must not fabricate a
  historical zero.
- Storage used means bytes currently present in Keco's production Supabase
  Storage buckets. Deleted objects stop contributing; live orphaned or failed
  objects still contribute because they still consume physical storage.

## Scope

### In scope

- One append-only ledger for Chat Completion, embedding, and PixelLab provider
  attempts.
- Provider usage capture in both streaming and non-streaming LLM clients.
- Attribution for Agent, GDD, Game Design System, Create Map, Script import,
  title generation, simulation mapping, embeddings, PixelLab maps, and PixelLab
  character/animation work.
- DeepSeek Credit aggregation using the approved 3:1 token ratio.
- Account-wide and current-user aggregation for the Keco Admin overview.
- Physical Storage totals and per-user attribution for current objects.
- Completeness indicators for unknown AI usage and unattributed storage.
- Tests for capture, idempotency, aggregation, authorization, and UI states.

### Out of scope

- Debiting balances, blocking requests, quotas, subscriptions, invoices, or
  payment settlement.
- Assigning Credit prices to MiniMax, embeddings, or PixelLab.
- Reconstructing historical per-user usage from provider invoices.
- Estimating tokens locally when the provider does not report them.
- Storing prompts, completions, API keys, image bytes, or provider response
  bodies in the usage ledger.
- Treating database row sizes, generated document text, or vector column sizes
  as Supabase Storage usage.

## Architecture

```text
Authenticated route / background job
  -> creates an attributed usage context
  -> feature service invokes provider client
  -> provider client creates one event key per outbound attempt
  -> provider response exposes actual usage when available
  -> best-effort usage recorder inserts one append-only event
  -> SQL aggregation sums raw usage by account and user
  -> Credit projection applies the versioned 3-token denominator
  -> Keco Admin overview reads the aggregate

Supabase storage.objects
  -> inventory function filters approved production buckets
  -> physical bytes are summed by bucket
  -> owner/business registries attribute bytes where possible
  -> Keco Admin overview reads total, attributed, and unattributed bytes
```

Usage persistence must not make a successful product operation fail. A ledger
write failure is reported to server telemetry and an operational counter, while
the provider result continues to the feature. The event key permits a bounded
outbox or explicit replay to insert the missing event later without duplication.

## Usage Context

Every external provider call receives a server-created context:

```ts
type AiUsageContext = {
  actorUserId: string;
  projectId?: string;
  feature: AiUsageFeature;
  operation: string;
  correlationId: string;
  jobId?: string;
  artifactId?: string;
};
```

`actorUserId` comes from the authenticated user for synchronous routes and from
the durable job owner for workers. It is never accepted directly from an
untrusted request body. `correlationId` groups all provider attempts caused by
one user action or durable job. `jobId` and `artifactId` allow GDD and map work
to be reconciled across worker leases and retries.

The provider-neutral clients accept a recorder callback rather than importing
Supabase or constructing a service-role client. Routes and workers create the
recorder with their existing authenticated or service-role client and pass it
through feature dependencies. This preserves testability and prevents generic
transport code from owning authorization.

Provider identity is explicit configuration, not a hostname or model-name
guess. `StreamLlmOptions` gains a canonical `provider`, backed by
`LLM_PROVIDER` and feature-specific provider variables where configuration is
currently split. Existing DeepSeek defaults declare `deepseek`. An unknown or
missing provider is recorded as non-billable until configured; it must never be
silently classified as DeepSeek merely because it implements the OpenAI API.

## Usage Ledger

Create `public.ai_usage_events` with these logical fields:

| Field | Meaning |
| --- | --- |
| `id` | Server-generated UUID primary key |
| `event_key` | Stable unique key for one outbound attempt |
| `user_id` | Auth user that caused the work; nullable only after user deletion |
| `project_id` | Related project when one exists; nullable after project deletion |
| `feature` | Stable product area such as `agent_chat`, `gdd`, or `create_map` |
| `operation` | Stage within the feature, such as `generate_core` or `repair_plan` |
| `request_kind` | `chat_completion`, `embedding`, or `provider_generation` |
| `provider` | Canonical provider name: `deepseek`, `minimax`, `openai`, or `pixellab` |
| `model` | Exact requested model when applicable |
| `correlation_id` | One product action or durable job execution identity |
| `job_id` | Optional durable job identity stored as text |
| `artifact_id` | Optional generated-resource identity stored as text |
| `attempt` | One-based logical provider-attempt number within the operation |
| `provider_request_id` | Sanitized provider request identifier when returned |
| `outcome` | `succeeded`, `provider_error`, `transport_error`, or `aborted` |
| `usage_status` | `reported` or `unknown` |
| `input_tokens` | Provider-reported prompt/input tokens |
| `output_tokens` | Provider-reported completion/output tokens |
| `total_tokens` | Provider total, or validated input plus output fallback |
| `provider_credits` | Provider-native credits when explicitly reported |
| `pricing_rule_version` | `1` for the approved DeepSeek rule; null when not billable |
| `started_at` / `finished_at` | Attempt timing |
| `metadata` | Bounded non-sensitive diagnostic identifiers only |
| `created_at` | Ledger insertion time |

Token fields are non-negative `bigint` values and remain null for unknown
usage. If `total_tokens` is absent but both input and output values are present,
the client sets total to their sum. Inconsistent negative, fractional, or
smaller-than-components totals are rejected as unknown rather than accepted.

The database enforces unique `event_key`, bounded strings, object-shaped
metadata no larger than 4 KiB, valid outcomes, coherent token nullability, and the rule
that only reported DeepSeek token events may carry `pricing_rule_version = 1`.
Direct table access is revoked from `anon` and `authenticated`. Synchronous
authenticated routes call a security-definer recording RPC that derives the
actor from `auth.uid()` and does not accept a different user identity. Durable
workers use their existing service-role client and a server-only insert helper
with the job's validated owner. Admin reads use narrowly scoped aggregate
functions, not raw events.

User and project foreign keys use `on delete set null`. The cost event remains
in the account total after deletion without retaining prompts or content, while
it no longer appears as usage for a current user or project.

## Credit Calculation

Pricing rule version 1 is:

```text
provider = deepseek
request_kind = chat_completion
usage_status = reported
credits = ceil(sum(total_tokens) / 3)
```

The SQL aggregate uses exact integer/numeric arithmetic. Account Credit usage
includes attributable and deleted-user DeepSeek usage because both consumed the
account provider budget. Per-user Credit usage includes only events whose
current `user_id` matches that user.

Example:

```text
request A: 10 tokens
request B: 11 tokens
sum:       21 tokens
credits:   ceil(21 / 3) = 7
```

It is incorrect to calculate `ceil(10 / 3) + ceil(11 / 3) = 8`.

An aggregate also returns `unknownEventCount`. When it is non-zero, the numeric
Credit value is a known minimum and the UI labels the total as incomplete. The
system never estimates unknown usage from text length or configured limits.

## Provider Capture

### Streaming Chat Completion

The streaming parser captures usage wherever the compatible provider emits it,
including a final usage-only SSE chunk without a choice. It must not require
`finish_reason` and usage to be present in the same chunk. The request enables
the provider's supported usage-in-stream option when required.

At stream completion, the client normalizes usage, invokes the recorder once,
and then invokes the existing finish callback. If the stream is interrupted
after the provider accepted it but before usage arrives, it records an unknown
event with the appropriate outcome.

### Non-streaming Chat Completion

The non-streaming response parser adds the top-level `usage` contract and calls
the same normalization and recording path before returning content or tool
arguments. A schema-repair call is a separate invocation with a separate event
key and attempt number.

### Transport Retries

The current clients retry transient connection, `429`, and `5xx` failures.
Each HTTP attempt is recorded separately:

- a response with reported usage records that usage;
- a provider or transport failure without usage records `usage_status=unknown`;
- the later successful retry records its own reported usage event.

Unknown failed attempts are visible for reconciliation but contribute no
fabricated Credits. This is deliberately conservative until provider billing
exports can resolve them.

### Embeddings

The OpenAI-compatible embedding parser captures its top-level usage when
present. MiniMax embedding calls store reported provider usage if available;
otherwise they record batch size, input character count, and unknown token
usage in bounded metadata. Neither consumes Keco Credits in version 1.

### PixelLab

PixelLab submission and retry operations record provider-generation events.
Polling and validation are recorded for operational visibility but marked
non-billable. Provider-native credits are stored only if returned explicitly.
No PixelLab operation is assigned synthetic Token usage.

## Feature Coverage

The implementation must assign stable feature and operation values at every
runtime entry point:

| Feature | Operations to cover |
| --- | --- |
| Agent Chat | Every ReAct model iteration and confirmation resume |
| Create Map | V2 plan, V3 plan, validation repair |
| Map collision | One event per vision region and region repair |
| Quick GDD | Initial generation, truncation recovery, review/resource recovery |
| Professional GDD | Planning, core, systems, content, review, and each repair |
| GDD resources | Missing-table repair, dialogue recovery, per-scene dialogue plan/repair, map brief compile/repair |
| Game Design System | Initial generation and schema/language repair |
| Script import | Extractor, auditor, graph, branch, plot, and title stages, including provider retries |
| Simulation | Field mapping and model-output retry |
| Embeddings | Index batches and retrieval-query embeddings |
| PixelLab | Map, character, and animation submit/retry/poll/validate |

Nested helpers must preserve the parent correlation and actor context while
changing only the operation. Concurrent GDD dialogue scenes and collision
regions use distinct event keys and include a bounded scene/region index in
metadata.

## Storage Accounting

### Physical Total

The authoritative source is `storage.objects`, not the duplicated size columns
in business tables. Version 1 inventories these production buckets:

- `tiptap-images`
- `library-media-files`
- `map-assets`
- `character-assets`
- `project-assets`

The account total sums the object size in `metadata->>'size'` once per
`bucket_id + name`. Missing or invalid sizes contribute to an
`unknownObjectCount`, not zero. Folder names and database rows without a
physical object do not contribute. Adding a future bucket requires explicitly
adding it to the approved inventory list.

Because this metric represents physical storage cost, all live objects in the
approved buckets count, including temporarily orphaned and failed-generation
objects. Cleanup reduces the total only after the storage object is actually
deleted.

### User Attribution

Attribution follows this precedence:

1. a valid `storage.objects.owner_id`;
2. the registry record's `created_by` for `project_game_assets`,
   `map_reference_images`, `map_assets` through its map project, and character
   generation attempts through `character_assets`;
3. a UUID path segment only when the relevant bucket contract explicitly
   defines that segment as the uploader identity;
4. unattributed.

Each physical object is assigned at most once. Shared-project objects remain
attributed to the creating user rather than being copied to every collaborator
or reassigned to the project owner. Account totals include unattributed bytes;
per-user totals do not. Admin receives `unattributedBytes` and
`unknownObjectCount` so attribution gaps are visible.

The inventory runs through a service-role SQL function or server service. For
the current scale it may aggregate on demand. If measured latency exceeds the
Admin request budget, the same contract can be backed by a scheduled snapshot
table without changing the UI response.

## Admin Contract

Extend the private, no-store Keco Admin overview response with:

```ts
type KecoAdminUsageMetric = {
  value: number;
  trackedFrom: string;
  incompleteCount: number;
};

type KecoAdminStorageMetric = {
  bytes: number;
  objectCount: number;
  unattributedBytes: number;
  unknownObjectCount: number;
  calculatedAt: string;
};

type KecoAdminUser = {
  // Existing Auth fields remain.
  creditUsed: number;
  deepseekTokens: number;
  creditUsageIncompleteCount: number;
  storageBytes: number;
};

type KecoAdminOverview = {
  totalUsers: number;
  creditUsage: KecoAdminUsageMetric & { deepseekTokens: number };
  storageUsed: KecoAdminStorageMetric;
  refreshedAt: string;
  users: KecoAdminUser[];
};
```

`creditUsage.value` is the account Credit total. `trackedFrom` is the first
ledger event time, or the migration/deployment time when the ledger is empty.
The dashboard replaces the two `Not connected` panels with formatted Credit
and byte totals. Incomplete metrics use a concise warning state and tooltip;
they never silently appear authoritative. The user table shows real Credit and
Storage values while Plan and Actions remain unchanged until their own data
sources exist.

Authorization remains the existing Keco Admin boundary. The browser never
queries `ai_usage_events` or `storage.objects` directly.

## Failure Handling and Observability

- Provider success is not rolled back by usage-ledger failure.
- Every failed ledger insert emits a structured server log containing only the
  event key, provider, feature, operation, and error code.
- A counter for ledger write failures and a count of unknown usage events are
  included in operational monitoring.
- Duplicate event-key inserts are treated as idempotent success.
- Aggregate read failure keeps the previous React Query data visible and uses
  the dashboard's existing refresh-error behavior.
- If Auth succeeds but either usage or storage aggregation fails during first
  load, the overview endpoint returns `503`; it does not substitute zero.
- Oversized or sensitive metadata is rejected before persistence. Prompt and
  output content never enter the ledger or logs.

## Historical Data and Rollout

Historical `agent_traces.token_usage` is incomplete because only the Agent
ReAct path recorded it and some provider responses could be stored as zero when
usage was absent. It must not be merged automatically into the authoritative
ledger. A separate one-time audit may report legacy Agent totals as
non-authoritative, but Keco Admin version 1 starts at ledger deployment.

Rollout order:

1. Deploy the ledger, constraints, aggregate functions, and tracking-start
   marker without changing Admin display.
2. Deploy provider-client capture and confirm usage against DeepSeek's provider
   dashboard in a controlled environment.
3. Add feature attribution progressively, with a test that enumerates every
   external runtime entry point.
4. Deploy embedding and PixelLab non-billable event capture.
5. Deploy storage inventory and reconcile bucket totals against Supabase.
6. Enable Admin Credit and Storage panels only after aggregation reconciliation
   passes.
7. Monitor unknown usage, ledger failures, and unattributed storage before
   using the values for balance enforcement or billing.

## Testing Strategy

- Migration tests verify append-only permissions, event-key uniqueness, token
  constraints, metadata limits, deletion behavior, and aggregate arithmetic.
- LLM client tests cover usage in a normal final chunk, a usage-only streaming
  chunk, non-streaming usage, missing usage, malformed usage, aborts, and each
  transport retry outcome.
- Credit tests prove aggregation-before-rounding, non-DeepSeek exclusion,
  unknown-event reporting, deleted-user account totals, and per-user totals.
- Feature wiring tests enumerate every DeepSeek call site and require an
  attributed usage context.
- GDD tests cover professional stages, table repair, dialogue fan-out, map brief
  repair, worker retry, and stable correlation identities.
- Map tests cover plan repair, multiple collision regions, PixelLab submission
  retry, polling exclusion, and provider-native credit capture.
- Embedding tests cover batch retry and reported/unknown usage without Keco
  Credit conversion.
- Storage tests use objects across every approved bucket, duplicate business
  references, deleted objects, invalid metadata sizes, service-owned objects,
  shared projects, and unattributed objects.
- Admin service and UI tests cover live totals, user rows, loading, refresh,
  incomplete warnings, zero since tracking start, access denial, and aggregate
  failure.

## Acceptance Criteria

1. Every runtime external AI attempt creates one idempotent usage event or a
   visible ledger-write failure signal.
2. Streaming and non-streaming DeepSeek calls capture provider-reported input,
   output, and total tokens without using configured limits as usage.
3. Account and per-user Credits equal `ceil(sum(reported DeepSeek tokens) / 3)`
   at their respective aggregation level.
4. Repairs and retries are charged when they make a new provider request, while
   persistence retries never double count.
5. Unknown usage is visible and never converted to zero Credits.
6. MiniMax, embeddings, and PixelLab remain non-billable under pricing rule
   version 1 while retaining their available raw usage.
7. Storage totals equal current physical bytes across the approved buckets,
   count each object once, and expose unknown and unattributed amounts.
8. Keco Admin displays real Credit and Storage totals and per-user values behind
   the existing authorization boundary.
9. The UI identifies the tracking start date and does not imply complete
   historical coverage.
10. Provider and Supabase reconciliation tests pass before the two Admin panels
    are labeled live.
