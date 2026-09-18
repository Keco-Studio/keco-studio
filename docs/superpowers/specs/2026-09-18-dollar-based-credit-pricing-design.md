# Dollar-Based Credit Pricing Design

**Date:** 2026-09-18

**Status:** Approved in chat for the database-first implementation

## Goal

Replace the current token-ratio rule with a cost-based rule:

```text
1 USD of provider cost = 3 Keco Credits
```

The provider cost is derived from the model-specific price that was in effect
when the request completed. Prices are data, never application constants, so an
operator can add a future price version without a deployment or historical
rebilling.

## Scope

This delivery covers the accounting database, the DeepSeek usage capture needed
for it, Credit summaries, and the existing Account/Admin values that display
those summaries.

It does not add a pricing-management UI, automatic scraping of provider price
pages, or a `/user/balance` integration.

## Current DeepSeek Price Seed

The active configured model is `deepseek-flash`. The initial USD prices per
one million tokens are copied from the official DeepSeek pricing page on the
migration date:

| Rate window | Cached input | Uncached input | Output |
| --- | ---: | ---: | ---: |
| Off-peak | 0.003 | 0.15 | 0.60 |
| Peak | 0.006 | 0.30 | 1.20 |

Peak is Monday through Friday, `01:00-04:00` and `06:00-10:00` UTC. All other
times are off-peak. The price rows state their own effective start time. A
later provider change is represented by inserting a new row with a later start
time; existing rows and charged events are immutable.

## Price Catalog

Add a private `ai_model_price_versions` table with:

- immutable UUID identifier;
- canonical provider and exact model name;
- `peak` or `off_peak` rate window;
- effective start timestamp;
- USD price per million cached-input, uncached-input, and output tokens;
- creation timestamp and an operator-facing bounded note.

All price values use PostgreSQL `numeric`, never binary floating point.
Constraints reject negative prices, invalid provider/window values, invalid
model names, duplicate effective versions, and overlapping active versions for
the same provider/model/window. RLS remains enabled. Browser roles receive no
table privileges; only `service_role` can read or insert rows.

Future adjustment is an append-only SQL insert for both windows. The insert
must use the actual model identifier returned by the provider and a future
`effective_from`; it must not update or delete an existing version.

## Usage Cost Capture

Extend reported chat usage with `inputCacheHitTokens` and
`inputCacheMissTokens`. For DeepSeek streaming responses these are taken from
the final response's cache detail fields. If a compatible provider reports only
the total input count, its input is conservatively stored as uncached.

Each billable event records:

- the selected price-version ID;
- the exact `usd_cost` calculated from cache-hit input, cache-miss input, and
  output counts;
- pricing rule version `2`.

The database computes the selected price and USD cost from the persisted model,
completion time, and token fields. This keeps authenticated and service-worker
paths on one trusted calculation boundary. A reported DeepSeek event with no
matching active price version is retained as unpriced and increases the
incomplete count; it must not consume arbitrary Credits.

Cost is persisted as `numeric`, with no per-request Credit rounding. The
calculation is:

```text
usd_cost = cached_input / 1_000_000 * cached_input_price
         + uncached_input / 1_000_000 * uncached_input_price
         + output / 1_000_000 * output_price
credits  = sum(usd_cost) * 3
```

## Credit Summary Migration

The existing version-1 `ceil(total_tokens / 3)` rule is retired from all
current Credit summaries. Existing events do not carry cache splits or a valid
cost price version, so they are not re-rated from today's prices. The migration
starts a new cost-accounting epoch and labels older events as legacy usage in
admin diagnostics rather than presenting a false dollar-based Credit number.

Allocated Credits remain whole-number ledger grants. Used, remaining, and
overage values become decimal Credits in the database and API contracts. The
browser formats them to a fixed, human-readable precision without changing the
underlying calculation.

## Security And Verification

- Price lookup and cost assignment occur in PostgreSQL, not in browser code.
- Authenticated callers continue to derive user identity from `auth.uid()`;
  they cannot choose a price version or submit a USD amount.
- Tests cover price-version constraints, peak/off-peak selection, cache
  accounting, version immutability, aggregate cost-to-Credit conversion,
  unmatched-model incompleteness, and the existing authorization boundaries.
- Tests must demonstrate that the old token ratio no longer affects Credit
  usage after the cost-accounting epoch begins.
