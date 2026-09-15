# AI Usage, Credit, and Storage Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every external AI attempt, convert reported DeepSeek usage at 3 tokens per Credit, inventory physical Supabase Storage bytes, and display authoritative totals and per-user values in Keco Admin.

**Architecture:** Provider clients emit normalized, attributed usage attempts to an append-only Supabase ledger through an injected recorder. SQL functions aggregate reported DeepSeek tokens before applying the 3:1 Credit conversion and separately inventory live objects in approved Storage buckets; the existing Keco Admin server service combines those aggregates with Auth users. Missing provider usage and unattributed storage remain visible instead of becoming false zeroes.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9, Supabase/PostgreSQL, `@supabase/supabase-js`, Jest 30, React Testing Library, Deno Supabase Edge Functions.

**Spec:** `docs/superpowers/specs/2026-09-15-ai-usage-credit-storage-design.md`

## Global Constraints

- The pricing rule is exactly `3 DeepSeek tokens = 1 Keco Credit`.
- Aggregate reported tokens first, then compute `ceil(sum(total_tokens) / 3)`; never round per request.
- Only explicitly configured `provider: 'deepseek'` Chat Completion events are billable in pricing rule version 1.
- Provider identity must be explicit; never infer it from an OpenAI-compatible endpoint or model name.
- Missing or malformed provider usage is `unknown`, never zero and never locally estimated.
- Every outbound retry, repair, or worker retry is a separate attempt; persistence retries reuse the same `event_key`.
- AI usage recording is best effort and must not fail a successful product operation, but recording failure must emit a bounded structured log.
- Do not store prompts, completions, API keys, image bytes, or raw provider bodies in usage events or logs.
- MiniMax, embeddings, and PixelLab are non-billable under pricing rule version 1.
- Storage totals come from current `storage.objects` in `tiptap-images`, `library-media-files`, `map-assets`, `character-assets`, and `project-assets`.
- Count every live physical object once, including orphaned objects; expose unknown sizes and unattributed bytes.
- Historical `agent_traces` data is not copied into the authoritative ledger.
- Preserve existing dirty-worktree changes. In particular, work with the current Keco Admin authorization edits and `supabase/migrations/20260915000000_create_keco_admin_users.sql`; do not overwrite or revert them.

## File Structure

New domain files:

- `src/lib/ai-usage/types.ts`: provider-neutral usage context, attempt, binding, and normalized token types.
- `src/lib/ai-usage/normalize.ts`: strict provider usage normalization and Credit arithmetic.
- `src/lib/ai-usage/recorder.ts`: authenticated-RPC and service-role recorder factories.
- `src/lib/server/kecoAdminUsage.ts`: parse the AI aggregate RPC contract.
- `src/lib/server/kecoAdminStorage.ts`: parse the Storage aggregate RPC contract.
- `supabase/functions/_shared/ai-usage.ts`: Deno-compatible PixelLab usage writer.
- `scripts/audit-ai-usage.ts`: account ledger and Storage reconciliation report.

New database files:

- `supabase/migrations/20260915110000_ai_usage_accounting.sql`: append-only ledger, authenticated recording RPC, tracking epoch, and Credit aggregate RPC.
- `supabase/migrations/20260915120000_keco_admin_storage_usage.sql`: approved-bucket physical Storage aggregate RPC.

Existing files change only to pass attribution, capture provider usage, or render aggregates. Avoid folding accounting behavior into feature-specific persistence services.

---

### Task 1: Usage Domain Types and Arithmetic

**Files:**
- Create: `src/lib/ai-usage/types.ts`
- Create: `src/lib/ai-usage/normalize.ts`
- Test: `tests/unit/ai-usage/normalize.test.ts`

**Interfaces:**
- Consumes: provider response objects with OpenAI-compatible `prompt_tokens`, `completion_tokens`, and `total_tokens` fields.
- Produces: `AiProvider`, `AiUsageContext`, `AiUsageMetadata`, `AiUsageAttempt`, `AiUsageRecorder`, `AiUsageBinding`, `deriveAiUsageBinding()`, `normalizeTokenUsage()`, and `creditsForTokenTotal()`.

- [ ] **Step 1: Write the failing normalization and Credit tests**

```ts
import { creditsForTokenTotal, normalizeTokenUsage } from '@/lib/ai-usage/normalize';
import { deriveAiUsageBinding } from '@/lib/ai-usage/types';

it('normalizes provider totals without treating limits as usage', () => {
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11, total_tokens: 21 }))
    .toEqual({ inputTokens: 10, outputTokens: 11, totalTokens: 21 });
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11 }))
    .toEqual({ inputTokens: 10, outputTokens: 11, totalTokens: 21 });
  expect(normalizeTokenUsage({ total_tokens: -1 })).toBeNull();
  expect(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 11, total_tokens: 20 }))
    .toBeNull();
  expect(normalizeTokenUsage(undefined)).toBeNull();
});

it('normalizes input-only embedding usage without making embeddings billable', () => {
  expect(normalizeTokenUsage({ prompt_tokens: 8, total_tokens: 8 }, 'embedding'))
    .toEqual({ inputTokens: 8, outputTokens: 0, totalTokens: 8 });
  expect(normalizeTokenUsage({ prompt_tokens: 8, total_tokens: 8 }))
    .toBeNull();
});

it('rounds once after aggregating all DeepSeek tokens', () => {
  expect(creditsForTokenTotal(10n + 11n)).toBe(7n);
  expect(creditsForTokenTotal(0n)).toBe(0n);
});

it('derives a binding without losing recorder, context, or bounded metadata', () => {
  const recorder = jest.fn(async () => undefined);
  const parent = {
    context: {
      actorUserId: 'user-1',
      projectId: 'project-1',
      feature: 'gdd',
      operation: 'quick_generate',
      correlationId: 'job-1',
    },
    recorder,
    metadata: { source: 'worker' },
  };

  expect(deriveAiUsageBinding(parent, {
    operation: 'quick_repair',
    artifactId: 'artifact-1',
    metadata: { repairAttempt: 1 },
  })).toEqual({
    context: {
      ...parent.context,
      operation: 'quick_repair',
      artifactId: 'artifact-1',
    },
    recorder,
    metadata: { source: 'worker', repairAttempt: 1 },
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand tests/unit/ai-usage/normalize.test.ts`

Expected: FAIL because `@/lib/ai-usage/normalize` does not exist.

- [ ] **Step 3: Add the provider-neutral contracts**

```ts
export type AiProvider = 'deepseek' | 'minimax' | 'openai' | 'pixellab' | 'unknown';
export type AiRequestKind = 'chat_completion' | 'embedding' | 'provider_generation';
export type AiUsageOutcome = 'succeeded' | 'provider_error' | 'transport_error' | 'aborted';

export type AiUsageContext = {
  actorUserId: string;
  projectId?: string;
  feature: string;
  operation: string;
  correlationId: string;
  jobId?: string;
  artifactId?: string;
};

export type NormalizedTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiUsageMetadata = Record<string, string | number | boolean | null>;

export type AiUsageAttempt = {
  eventKey: string;
  context: AiUsageContext;
  requestKind: AiRequestKind;
  provider: AiProvider;
  model: string | null;
  attempt: number;
  providerRequestId?: string;
  outcome: AiUsageOutcome;
  usage: NormalizedTokenUsage | null;
  providerCredits?: number;
  startedAt: string;
  finishedAt: string;
  metadata?: AiUsageMetadata;
};

export type AiUsageRecorder = (attempt: AiUsageAttempt) => Promise<void>;
export type AiUsageBinding = {
  context: AiUsageContext;
  recorder: AiUsageRecorder;
  metadata?: AiUsageMetadata;
};

export type AiUsageBindingOverrides =
  Partial<Pick<AiUsageContext, 'operation' | 'jobId' | 'artifactId'>> & {
    metadata?: AiUsageMetadata;
  };

export function deriveAiUsageBinding(
  parent: AiUsageBinding,
  overrides: AiUsageBindingOverrides,
): AiUsageBinding {
  const { metadata, ...contextOverrides } = overrides;
  return {
    context: { ...parent.context, ...contextOverrides },
    recorder: parent.recorder,
    metadata: metadata ? { ...parent.metadata, ...metadata } : parent.metadata,
  };
}
```

- [ ] **Step 4: Implement strict normalization and integer Credit arithmetic**

```ts
import type { AiRequestKind, NormalizedTokenUsage } from './types';

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function normalizeTokenUsage(
  value: unknown,
  requestKind: AiRequestKind = 'chat_completion',
): NormalizedTokenUsage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const input = raw.prompt_tokens ?? raw.input_tokens;
  const reportedOutput = raw.completion_tokens ?? raw.output_tokens;
  const output = requestKind === 'embedding' && reportedOutput === undefined
    ? 0
    : reportedOutput;
  const total = raw.total_tokens;
  if (!nonNegativeInteger(input) || !nonNegativeInteger(output)) return null;
  const resolved = total === undefined ? input + output : total;
  if (!nonNegativeInteger(resolved) || resolved < input + output) return null;
  return { inputTokens: input, outputTokens: output, totalTokens: resolved };
}

export function creditsForTokenTotal(totalTokens: bigint): bigint {
  if (totalTokens < 0n) throw new RangeError('Token total cannot be negative');
  return (totalTokens + 2n) / 3n;
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx jest --runInBand tests/unit/ai-usage/normalize.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the domain layer**

```bash
git add src/lib/ai-usage/types.ts src/lib/ai-usage/normalize.ts tests/unit/ai-usage/normalize.test.ts
git commit -m "feat: define external AI usage accounting"
```

### Task 2: Append-only Ledger and Credit Aggregation

**Files:**
- Create: `supabase/migrations/20260915110000_ai_usage_accounting.sql`
- Create: `tests/unit/database/ai-usage-accounting-migration.test.ts`
- Create: `tests/unit/database/ai-usage-accounting.behavior.test.ts`

**Interfaces:**
- Consumes: normalized attempt JSON from Task 1.
- Produces: `public.ai_usage_events`, `public.ai_usage_tracking_epochs`, `public.record_ai_usage_event(jsonb)`, and `public.keco_admin_ai_usage_summary()`.

- [ ] **Step 1: Write migration contract tests**

```ts
const sql = readFileSync(migrationPath, 'utf8');

expect(sql).toMatch(/create table public\.ai_usage_events/i);
expect(sql).toMatch(/unique[\s\S]+event_key/i);
expect(sql).toMatch(/on delete set null/i);
expect(sql).toMatch(/create (or replace )?function public\.record_ai_usage_event\(p_event jsonb\)/i);
expect(sql).toMatch(/auth\.uid\(\)/i);
expect(sql).toMatch(/create (or replace )?function public\.keco_admin_ai_usage_summary\(\)/i);
expect(sql).toMatch(/sum\([\s\S]*total_tokens[\s\S]*\+ 2[\s\S]*\/ 3/i);
expect(sql).toMatch(/revoke all on table public\.ai_usage_events from public, anon, authenticated/i);
```

Add behavior cases proving duplicate `event_key` is idempotent, an authenticated
caller cannot attribute usage to another UUID, unknown usage remains null, and
`10 + 11` reported DeepSeek tokens aggregate to 7 Credits. Also prove MiniMax,
PixelLab, and embedding events never enter Credit totals; a deleted user's event
remains in the account total but not a current-user total; and metadata over 4
KiB, fractional tokens, invalid outcomes, and inconsistent totals are rejected.

- [ ] **Step 2: Run the database tests and verify RED**

Run: `npx jest --runInBand tests/unit/database/ai-usage-accounting-migration.test.ts tests/unit/database/ai-usage-accounting.behavior.test.ts`

Expected: FAIL because the migration and functions do not exist.

- [ ] **Step 3: Create the private append-only schema**

Implement the table with `event_key uuid not null unique`, nullable
`user_id uuid references auth.users(id) on delete set null`, nullable
`project_id uuid references projects(id) on delete set null`, bounded text,
`bigint` token fields, `jsonb` metadata limited to 4096 bytes, and coherence
checks equivalent to:

```sql
check (
  (usage_status = 'unknown' and input_tokens is null and output_tokens is null and total_tokens is null)
  or
  (usage_status = 'reported' and input_tokens >= 0 and output_tokens >= 0
    and total_tokens >= input_tokens + output_tokens)
),
check (
  pricing_rule_version is null
  or (pricing_rule_version = 1 and provider = 'deepseek'
      and request_kind = 'chat_completion' and usage_status = 'reported')
),
check (pg_catalog.octet_length(metadata::text) <= 4096)
```

Create a one-row `ai_usage_tracking_epochs` table whose timestamp is inserted by
the migration and is not inferred from legacy traces.

- [ ] **Step 4: Add the authenticated insert RPC and service-role permissions**

`record_ai_usage_event(p_event jsonb)` must use `security definer set search_path = ''`,
derive `user_id` from `(select auth.uid())`, reject unauthenticated calls, and
insert with `on conflict (event_key) do nothing`. It must not accept `user_id`
inside `p_event`. Revoke direct table access from `authenticated`; grant only
RPC execution. Grant direct insert/select to `service_role` for durable workers.

- [ ] **Step 5: Add the admin-only aggregate RPC**

Return JSON with exact keys `trackedFrom`, `deepseekTokens`, `credits`,
`unknownEventCount`, and `users`. Use grouped sums before division:

```sql
case when coalesce(sum(total_tokens), 0) = 0 then 0
     else (coalesce(sum(total_tokens), 0) + 2) / 3
end
```

Count unknown DeepSeek Chat Completion attempts separately. Restrict execution
to `service_role`; the existing Keco Admin application authorization remains the
HTTP boundary.

- [ ] **Step 6: Apply locally and run GREEN tests**

Run: `npx supabase migration up && npx jest --runInBand tests/unit/database/ai-usage-accounting-migration.test.ts tests/unit/database/ai-usage-accounting.behavior.test.ts`

Expected: migration applies and both suites pass.

- [ ] **Step 7: Commit the ledger**

```bash
git add supabase/migrations/20260915110000_ai_usage_accounting.sql tests/unit/database/ai-usage-accounting-migration.test.ts tests/unit/database/ai-usage-accounting.behavior.test.ts
git commit -m "feat: add AI usage ledger and credit aggregate"
```

### Task 3: Recorders and Complete Chat Completion Capture

**Files:**
- Create: `src/lib/ai-usage/recorder.ts`
- Modify: `src/lib/agent/llm-client.ts`
- Modify: `src/lib/agent/types.ts`
- Test: `tests/unit/ai-usage/recorder.test.ts`
- Test: `tests/unit/agent/llm-client.test.ts`
- Test: `tests/unit/agent/llm-client-retry.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 RPC/table.
- Produces: `createAuthenticatedAiUsageRecorder()`, `createServiceAiUsageRecorder()`, explicit `provider` and optional `usageBinding` in `StreamLlmOptions`, and one normalized event per HTTP attempt.

- [ ] **Step 1: Write recorder tests**

```ts
const rpc = jest.fn(async () => ({ error: null }));
const recorder = createAuthenticatedAiUsageRecorder({ rpc } as never);
await recorder(attemptFixture());
expect(rpc).toHaveBeenCalledWith('record_ai_usage_event', {
  p_event: expect.not.objectContaining({ user_id: expect.anything() }),
});

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'private detail' } });
await expect(recorder(attemptFixture())).resolves.toBeUndefined();
expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private detail');
```

Also prove the service recorder inserts `user_id`, uses `upsert`/ignore-duplicate
semantics, and serializes token names to snake case.

- [ ] **Step 2: Write failing LLM capture tests**

Add concrete cases for:

```ts
it('captures a final usage-only SSE chunk', async () => {
  global.fetch = jest.fn(async () => new Response([
    'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
    '',
    'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":11,"total_tokens":21}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n'), { status: 200 })) as typeof fetch;
  const recorder = jest.fn(async () => undefined);
  await drain(streamLlm(messages, { provider: 'deepseek', usageBinding: binding(recorder) }));
  expect(recorder).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'deepseek', usage: { inputTokens: 10, outputTokens: 11, totalTokens: 21 },
  }));
});
```

Add non-streaming usage, unknown usage, abort, `429`, `5xx`, transport failure,
and eventual retry-success cases. Assert every HTTP attempt has a distinct
event key while each recorder invocation happens once.

- [ ] **Step 3: Run capture tests and verify RED**

Run: `npx jest --runInBand tests/unit/ai-usage/recorder.test.ts tests/unit/agent/llm-client.test.ts tests/unit/agent/llm-client-retry.test.ts`

Expected: FAIL because the recorders/options and usage-only parsing are absent.

- [ ] **Step 4: Implement bounded recorder factories**

Map `AiUsageAttempt` to the RPC/table contract, set
`pricing_rule_version: attempt.provider === 'deepseek'
  && attempt.requestKind === 'chat_completion' && attempt.usage ? 1 : null`,
truncate diagnostic string values to their schema bounds, and catch/log only
`eventKey`, `provider`, `feature`, `operation`, and a bounded persistence error
code. Emit the stable telemetry event name `ai_usage_ledger_write_failed` so the
logging backend can count write failures without inspecting free-form messages.

- [ ] **Step 5: Instrument every Chat Completion HTTP attempt**

Extend options:

```ts
export interface StreamLlmOptions {
  provider?: AiProvider;
  usageBinding?: AiUsageBinding;
  // existing options remain
}
```

Resolve `provider` from the explicit option or `LLM_PROVIDER`, falling back to
`unknown` rather than examining URL/model. Create `eventKey`, `startedAt`, and
attempt number immediately before each `outboundFetch`. Record a completed,
failed, or aborted attempt in one `finally`-controlled path. Copy the binding's
already-bounded metadata into the attempt and merge only client-owned bounded
fields such as retry number; never add prompts or response content.

The stream parser must store usage from any parsed SSE object before checking
for a choice. The non-streaming `LlmCompletion` contract must include `usage`
and call both the recorder and existing `onFinish` callback.

- [ ] **Step 6: Run GREEN tests and affected agent tests**

Run: `npx jest --runInBand tests/unit/ai-usage tests/unit/agent/llm-client.test.ts tests/unit/agent/llm-client-retry.test.ts tests/unit/agent/turn-budget.test.ts tests/unit/agent/trace-store.test.ts`

Expected: PASS with existing `onFinish` and turn-budget behavior preserved.

- [ ] **Step 7: Commit provider capture**

```bash
git add src/lib/ai-usage src/lib/agent/llm-client.ts src/lib/agent/types.ts tests/unit/ai-usage tests/unit/agent/llm-client.test.ts tests/unit/agent/llm-client-retry.test.ts
git commit -m "feat: capture Chat Completion usage attempts"
```

### Task 4: Agent and Embedding Attribution

**Files:**
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/app/api/agent-chat/confirm/route.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/embedding-client.ts`
- Modify: `src/lib/agent/embedding-index.ts`
- Modify: `src/lib/server/documentEmbeddingIndexService.ts`
- Test: `tests/unit/agent/ai-usage-wiring.test.ts`
- Test: `tests/unit/agent/embedding-client.test.ts`
- Test: `tests/unit/agent/resume-confirmation-core.test.ts`

**Interfaces:**
- Consumes: `AiUsageBinding` and recorder factories from Task 3.
- Produces: attributed `agent_chat` events per ReAct iteration/resume and non-billable `embedding` events for index/query batches.

- [ ] **Step 1: Write failing Agent attribution tests**

Assert the chat and confirm routes build authenticated recorders after Auth,
pass a stable correlation ID based on the turn ID, and use operations
`react_iteration` and `confirmation_resume`. In the core test, assert iteration
metadata is passed without storing the message:

```ts
expect(streamLlm).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
  provider: 'deepseek',
  usageBinding: expect.objectContaining({
    context: expect.objectContaining({
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      feature: 'agent_chat',
      operation: 'react_iteration',
    }),
  }),
}));
```

- [ ] **Step 2: Write failing embedding usage tests**

Return an OpenAI-compatible response with
`usage: { prompt_tokens: 8, total_tokens: 8 }` and assert one
`requestKind: 'embedding'` event with `pricing_rule_version` absent. Return a
MiniMax response without usage and assert an unknown event whose metadata only
contains `batchSize`, `inputCharacters`, and `embeddingType`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npx jest --runInBand tests/unit/agent/ai-usage-wiring.test.ts tests/unit/agent/embedding-client.test.ts tests/unit/agent/resume-confirmation-core.test.ts`

Expected: FAIL because usage bindings are not threaded.

- [ ] **Step 4: Thread the Agent binding**

Add `usageBinding?: AiUsageBinding` to `AgentTurnInput`/resume input. The routes
construct it only after the authenticated user, conversation, project, and turn
identity are known. `continueLoop` derives an operation binding with bounded
metadata `{ iteration }` for every `streamLlm` call. Keep `agent_traces` for
legacy diagnostics, but do not use it as the Credit source.

- [ ] **Step 5: Instrument embedding batches and queries**

Change the public signatures to:

```ts
export async function embedTexts(texts: string[], usageBinding?: AiUsageBinding): Promise<number[][]>;
export async function embedQuery(text: string, usageBinding?: AiUsageBinding): Promise<number[]>;
```

Create one event per HTTP batch attempt. Propagate an optional binding through
`embedding-index.ts` and `documentEmbeddingIndexService.ts`; use operations
`index_batch` and `retrieval_query`, and call
`normalizeTokenUsage(response.usage, 'embedding')` so an input-only usage shape
normalizes to `outputTokens: 0`. Embedding failures remain subject to the
existing cooldown and retry behavior.

- [ ] **Step 6: Run GREEN tests**

Run: `npx jest --runInBand tests/unit/agent/ai-usage-wiring.test.ts tests/unit/agent/embedding-client.test.ts tests/unit/agent/resume-confirmation-core.test.ts tests/unit/agent/trace-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit Agent and embedding attribution**

```bash
git add src/app/api/agent-chat src/lib/agent src/lib/server/documentEmbeddingIndexService.ts tests/unit/agent
git commit -m "feat: attribute agent and embedding usage"
```

### Task 5: Synchronous Map, Simulation, Script, and GDS Attribution

**Files:**
- Modify: `src/app/api/create-map/plan/route.ts`
- Modify: `src/app/api/create-map/collision-grid/route.ts`
- Modify: `src/lib/server/createMapPlanner.ts`
- Modify: `src/lib/server/createMapCollisionAnalyzer.ts`
- Modify: `src/app/api/simulation/field-mapping/route.ts`
- Modify: `src/lib/server/simulationFieldMappingService.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plot/titleSummarizer.ts`
- Modify: `src/lib/gameDesignSystemGeneration.ts`
- Modify: `src/lib/game-design-system/worker.ts`
- Test: `tests/unit/ai-usage/feature-attribution.test.ts`
- Test: existing focused suites for Create Map, story import, simulation, and GDS workers.

**Interfaces:**
- Consumes: Task 3 recorder/binding contracts.
- Produces: complete attribution for non-GDD Next.js Chat Completion entry points.

- [ ] **Step 1: Add failing feature-attribution tests**

Cover these exact mappings:

```text
create_map / plan_v2 | plan_v3 | plan_repair
map_collision / classify_region | repair_region
simulation / field_mapping | field_mapping_repair
script_import / extractor | auditor | graph | branch | plot | title
game_design_system / generate | repair
```

For collision analysis, assert a 512x512 map creates four region attempts at
32x32 cells per region and that a repaired region creates a fifth provider
attempt. For Script import, assert all calls share the import correlation ID but
retain their stage operation.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx jest --runInBand tests/unit/ai-usage/feature-attribution.test.ts tests/unit/create-map/create-map-service.test.ts tests/unit/simulation/ai-field-mapping.test.ts tests/unit/import-script-minimal-plan.integration.test.ts tests/unit/game-design-system-worker-route.test.ts`

Expected: FAIL on missing usage bindings/operations.

- [ ] **Step 3: Attribute Create Map and collision vision**

Add optional binding parameters to `createMapPlanV2`, `createMapPlanV3`, and
`analyzeCreateMapCollisionGrid`. Authenticated routes create the parent binding.
Each model-output repair changes `operation` and each collision region adds
`regionColumn`, `regionRow`, `regionColumns`, and `regionRows` metadata. Declare
the planner provider through `CREATE_MAP_LLM_PROVIDER` (default `deepseek`) and
vision through `CREATE_MAP_VISION_PROVIDER` (default `minimax`).

- [ ] **Step 4: Attribute simulation and story generation**

Add an optional usage binding to `suggestSimulationFieldMappings` and
`ResolveStoryPlanOptions`. Route-level authenticated identities are the only
source of actor/project. `completeStoryPlanLlm` derives stage operations and
lets Task 3 create separate events for its internal provider-abort retries.
Pass the same binding through `retitleStoryPlotPlanWithAi`.

- [ ] **Step 5: Attribute Game Design System jobs**

In `processClaimedGameDesignSystemJob`, construct a service recorder with
`job.owner_id`, the job project when present, correlation `job.id`, and feature
`game_design_system`. Pass it into `generateGameDesignSystemOutput`; label the
second validation request `repair`.

- [ ] **Step 6: Run GREEN tests and typecheck**

Run: `npx jest --runInBand tests/unit/ai-usage/feature-attribution.test.ts tests/unit/create-map tests/unit/simulation/ai-field-mapping.test.ts tests/unit/import-script-minimal-plan.integration.test.ts tests/unit/game-design-system-worker-route.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit synchronous feature attribution**

```bash
git add src/app/api/create-map src/app/api/simulation src/app/api/import-script src/lib/server/createMapPlanner.ts src/lib/server/createMapCollisionAnalyzer.ts src/lib/server/simulationFieldMappingService.ts src/lib/story-plan src/lib/story-plot src/lib/gameDesignSystemGeneration.ts src/lib/game-design-system/worker.ts tests/unit/ai-usage tests/unit/create-map tests/unit/simulation tests/unit/import-script-minimal-plan.integration.test.ts tests/unit/game-design-system-worker-route.test.ts
git commit -m "feat: attribute map and generation usage"
```

### Task 6: Complete GDD Usage Attribution

**Files:**
- Modify: `src/lib/gddGeneration.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/gdd-generation/v2/professionalStages.ts`
- Modify: `src/lib/gdd-generation/v2/dialoguePlanner.ts`
- Modify: `src/lib/gdd-generation/maps/compiler.ts`
- Modify: `src/lib/gdd-generation/resources/worker.ts`
- Modify: `src/lib/gdd-generation/dialogueWorker.ts`
- Test: `tests/unit/ai-usage/gdd-attribution.test.ts`
- Test: existing `tests/unit/gdd-generation/**` and `tests/unit/gdd-generation-routes.test.ts`.

**Interfaces:**
- Consumes: `AiUsageBinding` from Task 3 and job owner/project IDs.
- Produces: one correlated ledger stream for all Quick/Professional GDD model stages and resource repairs.

- [ ] **Step 1: Write a failing GDD operation matrix test**

Use injected completions/streams and assert these operations exactly:

```text
gdd / quick_generate | quick_repair | truncation_recovery
gdd / professional_planning | professional_planning_repair
gdd / professional_core | professional_systems | professional_content
gdd / professional_stage_repair | review
gdd_table / repair_missing_table
gdd_dialogue / recover_scenes | plan_scene | repair_scene
gdd_map / compile_briefs | repair_briefs
```

Assert every call carries `actorUserId = job.owner_id`,
`projectId = job.project_id`, `jobId = job.id`, and
`correlationId = job.id`. Dialogue fan-out must include a scene index but no
dialogue content in metadata.

- [ ] **Step 2: Run GDD tests and verify RED**

Run: `npx jest --runInBand tests/unit/ai-usage/gdd-attribution.test.ts tests/unit/gdd-generation tests/unit/gdd-generation-routes.test.ts`

Expected: FAIL because GDD dependency/runtime contracts do not carry usage.

- [ ] **Step 3: Add one GDD usage runtime contract**

Extend GDD dependency/runtime objects with `usageBinding?: AiUsageBinding` rather
than adding positional parameters. Provide a helper:

```ts
function gddUsage(parent: AiUsageBinding | undefined, operation: string, metadata = {}) {
  return parent ? deriveAiUsageBinding(parent, { operation, metadata }) : undefined;
}
```

Thread it through v1, v2, and professional worker entry points. Preserve all
existing injectable `complete`, `stream`, and `planScene` dependencies.

- [ ] **Step 4: Label primary, recovery, and repair calls**

Assign an operation at the call site, not inside the generic LLM client. Ensure
the length-recovery stream, per-table repair, dialogue recovery, each dialogue
plan/repair, and map brief repair use distinct operations while retaining one
job correlation.

- [ ] **Step 5: Cover asynchronous resource workers**

When `gdd_resource_jobs` execute after the parent completed, load the parent
job's `owner_id` together with existing parent data before invoking a model.
Build a service recorder with the resource job ID in `artifactId` and the parent
GDD job ID in `jobId`. Do the same for dialogue conversion paths that invoke
Script AI stages.

- [ ] **Step 6: Run GREEN GDD suites**

Run: `npx jest --runInBand tests/unit/ai-usage/gdd-attribution.test.ts tests/unit/gdd-generation tests/unit/gdd-generation-routes.test.ts tests/unit/gdd-generation-v2-scope.test.ts && npm run typecheck`

Expected: PASS without changing GDD output, retries, or worker checkpoint semantics.

- [ ] **Step 7: Commit GDD attribution**

```bash
git add src/lib/gddGeneration.ts src/lib/gdd-generation tests/unit/ai-usage/gdd-attribution.test.ts tests/unit/gdd-generation tests/unit/gdd-generation-routes.test.ts tests/unit/gdd-generation-v2-scope.test.ts
git commit -m "feat: track all GDD model usage"
```

### Task 7: PixelLab Provider Events

**Files:**
- Create: `supabase/functions/_shared/ai-usage.ts`
- Modify: `supabase/functions/pixellab-map/pixellab-client.ts`
- Modify: `supabase/functions/pixellab-map/index.ts`
- Modify: `supabase/functions/pixellab-character/pixellab-client.ts`
- Modify: `supabase/functions/pixellab-character/index.ts`
- Test: `supabase/functions/pixellab-map/ai-usage.test.ts`
- Test: `supabase/functions/pixellab-character/ai-usage.test.ts`

**Interfaces:**
- Consumes: Task 2 service-role insert permissions and authorized actor/project identity in each Edge Function.
- Produces: non-billable PixelLab attempt events with optional provider-native Credits.

- [ ] **Step 1: Write failing Deno tests**

Inject a usage writer and assert:

```ts
assertEquals(events[0].provider, 'pixellab');
assertEquals(events[0].requestKind, 'provider_generation');
assertEquals(events[0].context.actorUserId, USER_ID);
assertEquals(events[0].context.projectId, PROJECT_ID);
assertEquals(events[0].usage, null);
assertEquals(events[0].metadata?.providerOperation, 'create_image_pro');
```

Cover map submit/retry/poll/validate and character/animation calls. Verify
poll/validate remain non-billable and raw response bodies are never persisted.

- [ ] **Step 2: Run Deno tests and verify RED**

Run: `npx deno test --allow-env --allow-net supabase/functions/pixellab-map/ai-usage.test.ts supabase/functions/pixellab-character/ai-usage.test.ts`

Expected: FAIL because the shared writer does not exist.

- [ ] **Step 3: Implement the Deno writer**

Expose a small `recordEdgeAiUsage(serviceClient, attempt)` helper that maps to
`ai_usage_events`, inserts with `onConflict: 'event_key', ignoreDuplicates: true`,
catches failures, and logs only bounded identifiers. Generate one event UUID
before each PixelLab MCP/REST attempt.

- [ ] **Step 4: Instrument PixelLab clients and lifecycle entry points**

Pass validated actor/project/correlation context from `index.ts` into client
methods. Store sanitized provider job/request IDs and an explicit operation.
If a provider response includes a numeric native Credit field, normalize it
into `provider_credits`; otherwise leave it null. Never synthesize tokens or
Keco Credits.

- [ ] **Step 5: Run GREEN Edge Function tests and checks**

Run: `npx deno test --allow-env --allow-net supabase/functions/pixellab-map supabase/functions/pixellab-character && npx deno check supabase/functions/pixellab-map/index.ts supabase/functions/pixellab-character/index.ts`

Expected: PASS.

- [ ] **Step 6: Commit PixelLab telemetry**

```bash
git add supabase/functions/_shared/ai-usage.ts supabase/functions/pixellab-map supabase/functions/pixellab-character
git commit -m "feat: record PixelLab provider attempts"
```

### Task 8: Physical Storage Inventory

**Files:**
- Create: `supabase/migrations/20260915120000_keco_admin_storage_usage.sql`
- Create: `tests/unit/database/keco-admin-storage-usage-migration.test.ts`
- Create: `tests/unit/database/keco-admin-storage-usage.behavior.test.ts`
- Create: `src/lib/server/kecoAdminStorage.ts`
- Test: `tests/unit/keco-admin/keco-admin-storage.test.ts`

**Interfaces:**
- Consumes: current `storage.objects` and business registry tables.
- Produces: service-role-only `public.keco_admin_storage_usage()` and `readKecoAdminStorage(client)` returning account and per-user byte totals.

- [ ] **Step 1: Write failing Storage migration tests**

Assert the SQL explicitly allowlists all five bucket IDs, reads
`storage.objects.metadata->>'size'`, deduplicates on `(bucket_id, name)`, and
returns `bytes`, `objectCount`, `unattributedBytes`, `unknownObjectCount`,
`calculatedAt`, and `users`. Assert execution is granted only to service role.

Behavior fixtures must include:

```text
owned library object:             100 bytes
service-owned registered map:     200 bytes, map creator attribution
shared-project character object:  300 bytes, character creator attribution
orphaned live object:              400 bytes, account total only
invalid size object:               unknownObjectCount + 1
overflow size object:              unknownObjectCount + 1
duplicate registry matches:        one physical object and one attribution
business row without object:       contributes nothing
```

Expected account bytes: `1000`; expected unattributed bytes: `400`; invalid and
overflow sizes do not enter byte totals. Include a deleted object by omitting
its `storage.objects` row while retaining its registry row, and assert it does
not contribute.

- [ ] **Step 2: Run Storage tests and verify RED**

Run: `npx jest --runInBand tests/unit/database/keco-admin-storage-usage-migration.test.ts tests/unit/database/keco-admin-storage-usage.behavior.test.ts tests/unit/keco-admin/keco-admin-storage.test.ts`

Expected: FAIL because the migration and service do not exist.

- [ ] **Step 3: Implement the physical-object inventory function**

Build a CTE beginning with one row per approved object:

```sql
with physical_objects as (
  select distinct on (object.bucket_id, object.name)
    object.bucket_id,
    object.name,
    case when object.metadata ->> 'size' ~ '^[0-9]+$'
      and length(object.metadata ->> 'size') <= 18
      then (object.metadata ->> 'size')::bigint else null end as bytes,
    object.owner_id
  from storage.objects as object
  where object.bucket_id = any(array[
    'tiptap-images', 'library-media-files', 'map-assets',
    'character-assets', 'project-assets'
  ])
  order by object.bucket_id, object.name
)
```

Create registry attribution CTEs for `project_game_assets`,
`map_reference_images`, `map_assets -> map_revisions -> map_projects`, and
`character_generation_attempts -> character_assets`. Resolve owner first,
registry creator second, contractually valid UUID path third, else null. UUID
path fallback is allowed only for the first segment of `tiptap-images`,
`library-media-files`, and `project-assets`, whose existing write policies define
that segment as the uploader. Never parse the first segment of `map-assets` or
`character-assets` as a user because those contracts store a project UUID there.
Validate every owner, registry creator, and path candidate against `auth.users`;
ensure each physical object appears once after joins.

- [ ] **Step 4: Restrict and parse the aggregate**

Revoke function execution from public/anon/authenticated and grant service role.
In `readKecoAdminStorage`, validate every count/byte as a non-negative safe
integer, validate timestamps, and reject malformed user maps. Do not substitute
zero on RPC failure or invalid data.

- [ ] **Step 5: Apply migration and run GREEN tests**

Run: `npx supabase migration up && npx jest --runInBand tests/unit/database/keco-admin-storage-usage-migration.test.ts tests/unit/database/keco-admin-storage-usage.behavior.test.ts tests/unit/keco-admin/keco-admin-storage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit Storage accounting**

```bash
git add supabase/migrations/20260915120000_keco_admin_storage_usage.sql src/lib/server/kecoAdminStorage.ts tests/unit/database/keco-admin-storage-usage-migration.test.ts tests/unit/database/keco-admin-storage-usage.behavior.test.ts tests/unit/keco-admin/keco-admin-storage.test.ts
git commit -m "feat: aggregate physical storage usage"
```

### Task 9: Keco Admin API and UI

**Files:**
- Create: `src/lib/server/kecoAdminUsage.ts`
- Modify: `src/lib/server/kecoAdminOverview.ts`
- Modify: `src/lib/types/kecoAdmin.ts`
- Modify: `src/app/api/keco-admin/overview/route.ts`
- Modify: `src/components/keco-admin/KecoAdminDashboard.tsx`
- Modify: `src/components/keco-admin/KecoAdminDashboard.module.css`
- Modify: `tests/unit/keco-admin/keco-admin-overview.test.ts`
- Modify: `tests/unit/keco-admin/keco-admin-overview-route.test.ts`
- Modify: `tests/unit/keco-admin/keco-admin-dashboard.test.tsx`
- Modify: `tests/unit/keco-admin/keco-admin-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2 `keco_admin_ai_usage_summary()`, Task 8 `keco_admin_storage_usage()`, and existing Auth Admin pagination.
- Produces: the approved `KecoAdminOverview` API contract and live Credit/Storage dashboard panels and user cells.

- [ ] **Step 1: Extend tests with the exact response contract**

```ts
const overview = {
  totalUsers: 2,
  creditUsage: {
    value: 7,
    deepseekTokens: 21,
    trackedFrom: '2026-09-15T00:00:00.000Z',
    incompleteCount: 1,
  },
  storageUsed: {
    bytes: 1500,
    objectCount: 3,
    unattributedBytes: 400,
    unknownObjectCount: 1,
    calculatedAt: '2026-09-15T01:00:00.000Z',
  },
  refreshedAt: '2026-09-15T01:00:00.000Z',
  users: [{
    ...authUser,
    creditUsed: 4,
    deepseekTokens: 10,
    creditUsageIncompleteCount: 0,
    storageBytes: 1100,
  }],
};
```

Dashboard assertions must find formatted `7`, `1.5 KB`, per-user `4`, and
`1.1 KB`; an incomplete Credit tooltip; an unattributed Storage tooltip; no
`Not connected` text for these panels; stable skeletons during loading; and the
previous successful values remaining visible when a refresh request fails.

- [ ] **Step 2: Run Admin tests and verify RED**

Run: `npx jest --runInBand tests/unit/keco-admin`

Expected: FAIL because current types/service/UI still render unavailable metrics.

- [ ] **Step 3: Parse AI aggregates and combine all server reads**

Implement `readKecoAdminUsage(client)` with strict validation. In
`readKecoAdminOverview`, start Auth, AI usage, and Storage reads concurrently
after authorization has already succeeded:

```ts
const [auth, usage, storage] = await Promise.all([
  client.auth.admin.listUsers({ page: 1, perPage: USERS_PER_PAGE }),
  readKecoAdminUsage(client),
  readKecoAdminStorage(client),
]);
```

Join user aggregates by immutable Auth UUID. Missing entries for a known user
are valid zero since the explicit tracking epoch; malformed or failed aggregate
RPCs reject the whole overview. Preserve the route's private no-store response
and generic `503` behavior.

- [ ] **Step 4: Replace unavailable panels and table cells**

Remove `unavailableMetrics`. Render Total users, Credit usage, and Storage used
as stable three-column panels. Add helpers:

```ts
function formatCredits(value: number): string {
  return value.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
```

Use existing icons and panel styles. Status copy should identify DeepSeek usage
since `trackedFrom` and physical Supabase Storage. Use native/tooltipped warning
icons for incomplete/unknown values without adding instructional prose.

- [ ] **Step 5: Preserve dirty Keco Admin authorization work**

Before editing the route, inspect its current diff. Retain the database-backed
allowlist behavior already present in the worktree. Do not restore the previous
environment-only authorization implementation and do not include unrelated
authorization changes in this task's commit unless they are already committed
by their owner.

- [ ] **Step 6: Run GREEN Admin tests**

Run: `npx jest --runInBand tests/unit/keco-admin && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Admin integration**

Stage only the accounting changes that belong to this task after reviewing
`git diff`. If Admin files contain pre-existing uncommitted authorization work,
do not commit those hunks without the owner's approval; keep the task commit
limited or coordinate first.

```bash
git add src/lib/server/kecoAdminUsage.ts src/lib/server/kecoAdminStorage.ts src/lib/server/kecoAdminOverview.ts src/lib/types/kecoAdmin.ts src/components/keco-admin tests/unit/keco-admin
git commit -m "feat: show credit and storage usage in Keco Admin"
```

### Task 10: Coverage Guard, Reconciliation, and Release Verification

**Files:**
- Create: `tests/unit/ai-usage/external-ai-entrypoints.test.ts`
- Create: `scripts/audit-ai-usage.ts`
- Modify: `scripts/README.md`
- Modify: `.env.example`
- Modify: `package.json`
- Test: all affected suites.

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: a guard against uninstrumented external calls, an operator-readable reconciliation report, and final release evidence.

- [ ] **Step 1: Write the failing external-entrypoint guard**

The test scans runtime source for direct `/v1/chat/completions`, `/v1/embeddings`,
and `api.pixellab.ai` calls. Allow only the instrumented provider-client files.
It then scans every `completeLlm`, `completeLlmNonStreaming`, `streamLlm`,
`embedTexts`, and `embedQuery` call outside those clients and requires either an
explicit `usageBinding` or a dependency contract proven by the feature-specific
attribution tests.

```ts
expect(unapprovedDirectProviderCalls).toEqual([]);
expect(unattributedLlmCallSites).toEqual([]);
```

- [ ] **Step 2: Run the guard and verify RED if any call site remains**

Run: `npx jest --runInBand tests/unit/ai-usage/external-ai-entrypoints.test.ts`

Expected: FAIL listing any uninstrumented runtime call sites; return to the
owning task and add explicit attribution before continuing.

- [ ] **Step 3: Add the reconciliation script**

Create `npm run audit:ai-usage` backed by `scripts/audit-ai-usage.ts`. It must
use the service-role client, make no mutations, and print:

```text
Tracking start
Reported DeepSeek input/output/total tokens
Calculated Credits at 3:1
Unknown DeepSeek event count
Usage events by provider/feature/outcome
Ledger write errors are external-monitoring only
Storage bytes and objects by approved bucket
Unattributed bytes and unknown-size objects
```

Do not print user emails, prompts, outputs, object names, API keys, or raw
metadata. Document that provider-dashboard totals before `trackedFrom` are not
comparable and that provider-side failed-attempt billing may exceed known usage.

- [ ] **Step 4: Document explicit provider configuration**

Add safe examples without credentials:

```dotenv
LLM_PROVIDER=deepseek
CREATE_MAP_LLM_PROVIDER=deepseek
CREATE_MAP_VISION_PROVIDER=minimax
GDD_GENERATION_LLM_PROVIDER=deepseek
GAME_DESIGN_SYSTEM_LLM_PROVIDER=deepseek
EMBEDDING_PROVIDER=minimax
```

Do not modify existing live values in `.env.local`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npx jest --runInBand tests/unit/ai-usage tests/unit/keco-admin tests/unit/agent/llm-client.test.ts tests/unit/agent/llm-client-retry.test.ts tests/unit/agent/embedding-client.test.ts tests/unit/gdd-generation tests/unit/create-map
npm run typecheck
npm run typecheck:api
npm run check:mcp
npx deno check supabase/functions/pixellab-map/index.ts supabase/functions/pixellab-character/index.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Run full repository verification**

Run: `npm run validate`

Expected: lint, both TypeScript checks, MCP checks/tests, unit tests, and
production build all exit 0. If unrelated pre-existing failures occur, record
their exact command/output and keep the focused accounting suites green.

- [ ] **Step 7: Reconcile a controlled provider run**

Against a non-production account, perform one ordinary Agent message, one
Create Map plan, and one Quick GDD job. Run `npm run audit:ai-usage` and compare
events to provider request IDs and the provider dashboard for the same
post-`trackedFrom` interval. Confirm Storage bytes before and after uploading
and deleting one known test object. Do not enable quota enforcement from these
values during this release.

- [ ] **Step 8: Commit release guards and operator tooling**

```bash
git add tests/unit/ai-usage/external-ai-entrypoints.test.ts scripts/audit-ai-usage.ts scripts/README.md .env.example package.json
git commit -m "test: verify AI usage accounting coverage"
```

## Completion Checklist

- [ ] Every external provider attempt is recorded or emits a bounded recording-failure signal.
- [ ] DeepSeek streaming usage-only chunks and non-streaming usage are captured.
- [ ] DeepSeek Credits use aggregate-first `ceil(tokens / 3)` arithmetic.
- [ ] Unknown usage is visible and excluded from fabricated Credit totals.
- [ ] All GDD, map, Agent, Script, GDS, simulation, embedding, and PixelLab paths are attributed.
- [ ] Storage totals match live approved-bucket objects and expose attribution gaps.
- [ ] Keco Admin totals and per-user rows share the same aggregate sources.
- [ ] The tracking start date is visible and legacy traces are not treated as authoritative.
- [ ] Focused suites, full validation, and controlled provider reconciliation pass.
