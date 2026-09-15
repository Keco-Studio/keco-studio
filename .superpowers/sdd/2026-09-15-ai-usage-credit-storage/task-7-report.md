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

## Fix Round 1

### Root cause

The original client recorders only inspected top-level MCP result fields and
recorded success when `mcp()` returned, before `listTools`, map submit/poll, or
character calls applied their own structural checks. REST fallback operation
names inherited hyphens from provider paths, which the safe metadata allowlist
correctly rejected. Entry-point usage contexts did not carry durable stored job
IDs for later poll/validate calls.

### RED

Added realistic nested `structuredContent` and labelled `content[].text`
fixtures, a REST fallback persistence assertion, and malformed list/create/poll
fixtures. Before production changes, ran:

```text
npx deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/ai-usage.test.ts
# 3 passed, 4 failed: nested IDs/credits undefined; rest_create-tileset retained a hyphen; malformed results were recorded successful.
npx deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character/ai-usage.test.ts
# 1 passed, 2 failed: nested character ID undefined; malformed calls were recorded successful.
```

### Implementation

- Both clients now inspect only direct result fields, `structuredContent`, and
  labelled `content[].text` values for allowlisted identifiers and finite,
  non-negative native credits.
- Map REST operation names are normalized to stable underscore identifiers, for
  example `rest_create_tileset`.
- `mcp()` accepts a structural validator executed within the tracked callback.
  List responses require a tools array, map create requires a provider job ID,
  map poll requires an object result, and character calls require an object
  result plus a creation identity for `create_character`.
- Map and character entry points now include only sanitized durable provider job
  IDs from authorized asset/attempt state in the event context.

### GREEN

```text
npx deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map
# 110 passed, 0 failed
npx deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character
# 56 passed, 0 failed
npx deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts
# pass
npx deno check --config supabase/functions/pixellab-character/deno.json supabase/functions/pixellab-character/index.ts
# pass
```

### Self-review

- Nested extraction cannot persist raw `content` text, prompts, URLs, image
  bytes, response bodies, or secrets; it returns only regex-bounded IDs and
  finite numeric credits.
- Poll/validate correlation uses provider job IDs loaded by existing
  authorization, never a client assertion.
- Every malformed MCP fixture raises the existing stable invalid-response path
  before successful event recording, and records `provider_error` with null
  usage.
- The changes do not invoke PixelLab in tests and do not affect paid-operation
  authorization or lifecycle state transitions.

## Fix Round 2

### Root cause

The first telemetry hardening pass read labelled text and structured result
objects, but did not decode JSON objects delivered in MCP `content[].text`.
Separately, character creation validation used the telemetry-specific
identifier extractor instead of the canonical provider response parser, so a
valid human-readable `id: <uuid>` response was rejected.

### RED

Added fixture responses with JSON-encoded text identifiers and credits for map
and character calls, plus a character creation response with `id: <uuid>`.
Before production changes, the first two fixtures recorded no provider ID and
the character creation fixture threw `pixellab_invalid_response`.

### Implementation

- Both MCP telemetry extractors now parse JSON objects from recognized
  `content[].text` blocks, alongside direct and structured result objects.
- Character creation validation uses `providerCharacterId`, the canonical
  parser already used for provider responses.
- Text fallbacks reconstruct only recognized text blocks for canonical parsing,
  then apply the existing bounded identifier filter before event persistence.

### GREEN

```text
npx deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map
# 111 passed, 0 failed
npx deno test --config supabase/functions/pixellab-character/deno.json --allow-env --allow-net supabase/functions/pixellab-character
# 58 passed, 0 failed
npx deno check --config supabase/functions/pixellab-map/deno.json supabase/functions/pixellab-map/index.ts
# pass
npx deno check --config supabase/functions/pixellab-character/deno.json supabase/functions/pixellab-character/index.ts
# pass
```

### Self-review

- JSON parsing is constrained to recognized MCP text blocks and accepts only
  top-level objects; non-JSON text stays on the existing labelled-text path.
- Parsed response values are never stored. The ledger receives only bounded
  identifiers, finite non-negative credits, and allowlisted metadata.
- Tests use injected transports and make no PixelLab calls.
