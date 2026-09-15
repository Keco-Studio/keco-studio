# Task 7: PixelLab Provider Events

## Implementation

- Added `supabase/functions/_shared/ai-usage.ts`, a Deno-compatible service-role
  writer for `ai_usage_events`. It maps PixelLab events to the migration schema,
  uses `event_key` conflict-ignore upserts, bounds fields, permits only the
  `providerOperation` metadata key, and logs only bounded identifiers and error
  codes when ledger persistence fails.
- Wrapped every PixelLab MCP/REST client attempt in map and character clients.
  Each wrapper creates its UUID immediately before the request, records a
  distinct event for retries, uses `provider_generation`/`pixellab` with null
  usage, classifies transport/provider failures, and reads only allowlisted
  provider identifiers and finite non-negative native credit fields.
- Wired recorders in both Edge Function entry points using authorization-derived
  actor, project, asset, and generation identity. Request operation telemetry is
  allowlisted before recording. No client-asserted identity is used without the
  existing authorization path.
- Added fixture-transport tests for map submit/retry/poll/validate sequencing,
  character plus animation calls, native credits, idempotent writer options,
  transport failures, and absence of raw provider response markers.

## TDD Evidence

### RED

Before production code, ran separately because the functions have different
import maps:

```text
npx deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/ai-usage.test.ts
npx deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character/ai-usage.test.ts
```

Both failed as expected: `TS2307 Cannot find module .../_shared/ai-usage.ts`
and the new client usage injection arguments were not yet supported.

### GREEN

```text
npx deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map
# 106 passed, 0 failed
npx deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character
# 54 passed, 0 failed
npx deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts
# pass
npx deno check --config supabase/functions/pixellab-character/deno.json supabase/functions/pixellab-character/index.ts
# pass
```

No real PixelLab calls were made; tests use injected transports.

## Files

- `supabase/functions/_shared/ai-usage.ts`
- `supabase/functions/pixellab-map/index.ts`
- `supabase/functions/pixellab-map/pixellab-client.ts`
- `supabase/functions/pixellab-map/ai-usage.test.ts`
- `supabase/functions/pixellab-character/auth.ts`
- `supabase/functions/pixellab-character/index.ts`
- `supabase/functions/pixellab-character/pixellab-client.ts`
- `supabase/functions/pixellab-character/ai-usage.test.ts`

## Self-review

- Map submit/retry/poll/validate attempts pass through the tracked client. Poll
  during validation remains an event with null usage; validation never creates
  billable tokens or Keco Credits.
- Character and animation MCP calls, discovery retries, and background-job REST
  retries are tracked as distinct UUID events.
- Identity comes from validated `AuthorizedAsset`, `authorizeProject`, or
  `authorizeServiceRequest` results. Character authorization now exposes the
  already-validated actor identity to the recorder.
- Native credits are accepted only when numeric, finite, non-negative, and
  bounded. Unknown/string values are omitted.
- Metadata, provider IDs, and logs are bounded/allowlisted. Raw request bodies,
  response bodies, prompts, image bytes, secrets, URLs, and user-supplied
  operation text are not persisted by this telemetry.

## Concerns

None.
