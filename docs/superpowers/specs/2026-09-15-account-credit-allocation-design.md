# Account Credit Allocation and Visibility Design

**Date:** 2026-09-15
**Status:** Approved in chat; awaiting written-spec review
**Depends on:** `2026-09-15-ai-usage-credit-storage-design.md`

## Goal

Persist a 100,000,000 Credit allocation for the account identified by the
configured `KECO_ADMIN_USER_ID`, show that account's allocated, consumed, and
remaining Credits on `/account`, and show account-wide plus per-user Credit
consumption on `/keco-admin`. The same database facts must support both screens
and an operator's independent SQL verification.

## Decisions

- `100000000` is an initial allocation, not a frontend display override.
- Remaining Credits equal `max(allocated Credits - consumed Credits, 0)`.
- Consumed Credits retain their full value even after the account is exhausted;
  the UI does not hide overage.
- DeepSeek chat-completion usage is converted using the existing versioned
  rule, aggregate-first `ceil(total tokens / 3)`.
- PixelLab provider-generation attempts remain visible usage events but do not
  consume account Credits until a product pricing rule exists.
- This release provides accounting visibility only. It does not enforce quota
  at AI request time and does not add an Admin credit-editing UI.
- Identity joins use immutable Supabase Auth UUIDs, never email addresses.

## Architecture

The existing `ai_usage_events` table remains the source of consumed usage. A
new append-only Credit allocation ledger becomes the source of allocated
Credits. Authenticated Account and service-role-only Admin summary functions
derive their values from those two sources, and server API routes expose
validated response contracts to the browser.

```text
credit ledger -------+
                     +--> database summaries --> authenticated APIs --> Account
ai_usage_events -----+                                      +-------> Keco Admin
```

No browser client can select or mutate raw accounting tables. Account requests
are scoped to `auth.uid()`. Admin aggregation is available only through the
existing Keco Admin authorization check and a service-role client.

## Credit Ledger

Create `public.credit_ledger_entries` with:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `credit_delta bigint not null check (credit_delta <> 0)`
- `reason text not null` with a bounded length
- `reference_key text not null unique` with a bounded length
- `created_at timestamptz not null default clock_timestamp()`

Positive deltas allocate Credits. Negative deltas are reserved for audited
operator corrections, so an incorrect allocation can be reversed without
rewriting history. The table has RLS enabled and grants no access to
`public`, `anon`, or `authenticated`; `service_role` receives only the access
needed by server accounting and the operator command. Updates and deletes are
not part of the application contract.

`reference_key` is the idempotency boundary. The initial allocation uses a
stable key such as `initial-admin-allocation-2026-09-15`, so rerunning the
operator command cannot double-credit the account.

The configured UUID is intentionally not embedded in a migration. After the
migration is applied, an operator command reads `KECO_ADMIN_USER_ID` and
`SUPABASE_SERVICE_ROLE_KEY`, validates that the Auth user exists, and inserts
the idempotent `100000000` entry. The command reports identifiers and amounts,
not secrets.

## Database Summaries

Add two narrow summary interfaces:

1. An authenticated own-account function derives values only for `auth.uid()`.
2. A service-role-only Admin function returns account totals and a map keyed by
   Auth UUID for joining to the paginated Auth user list.

Both return:

- allocated Credits from the ledger sum;
- consumed Credits from versioned DeepSeek events;
- remaining Credits, clamped to zero;
- overage Credits when consumption exceeds allocation;
- incomplete usage-event count;
- the AI usage tracking start timestamp.

The Admin account total is calculated from the same aggregate sources as its
per-user values. Unknown usage remains an explicit count and never fabricates a
Credit amount. A malformed or failed summary is an error, not a zero balance.

## Server APIs

Add `GET /api/account/credits` under the existing route-auth wrapper. It calls
the own-account summary through the signed-in user's Supabase session and
returns a private, no-store response:

```ts
type AccountCreditSummary = {
  allocated: number;
  used: number;
  remaining: number;
  overage: number;
  incompleteCount: number;
  trackedFrom: string;
};
```

Extend `GET /api/keco-admin/overview` after its existing authorization gate.
Its service layer reads Auth users, AI/Credit summaries, and the separately
planned physical Storage summary concurrently. Each user row receives
`creditAllocated`, `creditUsed`, `creditRemaining`, `creditOverage`, and
`creditUsageIncompleteCount`. The overview receives matching account totals.

All numeric and timestamp fields are strictly parsed. Non-negative values must
be safe JavaScript integers. APIs return generic `503` failures without leaking
database details and retain `Cache-Control: private, no-store`.

## Account UI

Keep `/account` as one focused settings page. Add a Credits section above the
existing email section, using the current unframed, border-separated Account
layout. It displays three stable numeric values:

- Allocated
- Used
- Remaining

The initial successful state therefore shows `100,000,000` allocated before
new tracked usage is deducted. A compact status identifies the usage tracking
start time. Unknown usage and exhausted/overage states use accessible warning
text. Loading placeholders preserve layout dimensions. A query failure shows a
retryable error and never renders zero.

## Keco Admin UI

Replace the disconnected Credit placeholder with live data. The top Credit
panel emphasizes total consumed Credits and includes allocated and remaining
totals as secondary values. Each Auth user row shows consumed Credits first and
remaining Credits second; exhausted accounts receive a visible status. A
tooltip exposes incomplete usage counts without treating unknown provider
usage as known Credit consumption.

Storage work remains governed by Task 8 of the existing AI usage plan. The
Credit implementation must not replace its physical-object accounting design.
Plan filters and account subscription labels remain out of scope.

## Error Handling

- Missing ledger rows mean zero allocated Credits; this is a valid account
  state.
- Missing usage rows since the tracking epoch mean zero consumed Credits.
- Database/RPC errors and malformed payloads fail the relevant API request.
- Account and Admin retain explicit loading, first-load failure, and retry
  states.
- A refresh failure leaves the last successful Admin values visible.
- Negative derived allocation is rejected by summary validation rather than
  displayed as a valid balance.
- Usage over allocation preserves actual consumed and overage values while
  clamping only the displayed remaining amount to zero.

## Security

- Raw Credit and usage tables are inaccessible to browser roles.
- The own-account function binds identity internally from `auth.uid()` and
  accepts no caller-selected user UUID.
- The Admin function executes only for `service_role`; the API performs the
  existing Keco Admin authorization check before constructing that client.
- Operator allocation validates UUID, amount, reason, and reference key and
  never prints service credentials.
- Email changes do not affect allocations or usage attribution.

## Verification

Automated coverage will include:

- migration structure, constraints, RLS, grants, and function permissions;
- behavior tests for aggregate-first Credit conversion, unknown usage,
  idempotent allocation, negative correction, exhaustion, and user isolation;
- strict server parser and API authorization/failure tests;
- Account loading, success, warning, failure, and retry UI tests;
- Admin account totals, per-user values, unknown usage, and refresh fallback;
- existing Billing, AI usage, Keco Admin, typecheck, lint, and migration checks.

After automated verification, apply the migration to the configured Supabase
environment, run the idempotent initial allocation for `KECO_ADMIN_USER_ID`,
and verify both pages without making a paid PixelLab call.

Provide this read-only verification shape for the Supabase SQL editor:

```sql
-- Replace the UUID below with the immutable Supabase Auth user id.
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
select
  entry.user_id,
  sum(entry.credit_delta) as allocated_credits,
  count(*) as ledger_entry_count
from public.credit_ledger_entries as entry
cross join params
where entry.user_id = params.user_id
group by entry.user_id;

-- Use the same Auth user id here.
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as user_id
)
select
  event.user_id,
  sum(event.total_tokens) as deepseek_tokens,
  case
    when sum(event.total_tokens) = 0 then 0
    else (sum(event.total_tokens) + 2) / 3
  end as consumed_credits
from public.ai_usage_events as event
cross join params
where event.user_id = params.user_id
  and event.pricing_rule_version = 1
group by event.user_id;
```

The final handoff will also provide a combined allocation/used/remaining query
matching the shipped summary function exactly.

## Rollout Boundaries

Implementation belongs on `feat/ai-usage-credit-storage`, where the usage event
schema and provider instrumentation already exist. The existing Task 9 Admin
contract must be expanded to include allocation and balance while preserving
its consumed-usage and Storage requirements. Uncommitted Billing and Keco Admin
authorization edits in the main checkout must not be overwritten or included
in this feature's commits accidentally.
