# Create Map Real-Data Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the four blockers found by the retained Create Map real-data test and complete generation on `http://localhost:3000` without deleting any retained data.

**Architecture:** Keep strict MapPlan validation and repair only transport boundaries: normalize constrained numeric strings before validation, preserve invalid model output during correction, separate JWT validation from RLS clients, qualify the database transition update, and copy provider bytes into owned buffers at strict Deno APIs. Apply the corrected SQL function in place to the running local database, then resume the retained asset plans through the real Edge Function and PixelLab provider.

**Tech Stack:** Next.js 16, TypeScript 5.9, Jest 30, Zod 3, Supabase/PostgreSQL, Deno 2.9.3, PixelLab MCP, Playwright 1.57.

## Global Constraints

- Preserve Document `d86baf8a-b461-412b-950b-7c1b791d2320`, map `bba3d1dc-d37e-4735-9999-a7ec6ac78ce4`, both revisions, all asset rows, and all generated storage objects.
- Do not clamp coordinates, invent resources, or relax MapPlan domain validation.
- Keep provider secrets server-side and never print JWTs or API keys.
- Test the browser workflow only on `http://localhost:3000` and do not restart the user's current Next server unless a reload cannot pick up the changes.
- Do not stage or commit pre-existing uncommitted Create Map feature files as part of the repair.

---

### Task 1: Make Model Plan Correction Deterministic

**Files:**
- Modify: `tests/unit/create-map/create-map-planner.test.ts`
- Modify: `src/lib/server/createMapPlanner.ts`

**Interfaces:**
- Consumes: `validateMapPlan(input: unknown): MapPlanValidationResult`.
- Produces: `normalizeMapPlanCandidate(input: unknown): unknown`; `createMapPlanFromDocument()` retains the prior invalid JSON and sends full issue details on its one correction retry.

- [ ] **Step 1: Write failing planner tests**

Add tests that provide a candidate with string `schemaVersion`, `map.width`, `map.height`, and `map.tileSize`, expect safe numeric normalization, and verify the second call contains both the serialized invalid candidate and `outside_map` issue message. Also assert the tool schema declares integer types for `schemaVersion` and `tileSize`.

```ts
it('normalizes finite numeric strings at numeric MapPlan fields', async () => {
  const candidate = makeValidMapPlan() as unknown as Record<string, unknown>;
  candidate.schemaVersion = '1';
  candidate.map = { ...(candidate.map as object), width: '512', height: '384', tileSize: '32' };
  completeLlmNonStreaming.mockResolvedValue(JSON.stringify(candidate));
  await expect(createMapPlanFromDocument('# Village', source)).resolves.toEqual(makeValidMapPlan());
});

it('gives the correction call the invalid candidate and actionable issue message', async () => {
  const invalid = makeValidMapPlan();
  invalid.roads[0].points[1].x = 999;
  completeLlmNonStreaming
    .mockResolvedValueOnce(JSON.stringify(invalid))
    .mockResolvedValueOnce(JSON.stringify(makeValidMapPlan()));
  await createMapPlanFromDocument('# Village', source);
  const retry = completeLlmNonStreaming.mock.calls[1][0] as Array<{ role: string; content: string }>;
  expect(retry.at(-2)?.content).toBe(JSON.stringify(invalid));
  expect(retry.at(-1)?.content).toContain('Road point is outside the map');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/create-map/create-map-planner.test.ts`

Expected: FAIL because numeric strings are rejected and correction messages omit the invalid candidate and issue messages.

- [ ] **Step 3: Implement minimal normalization and correction context**

Add a recursive normalizer limited to schema-defined numeric paths. Parse each finite numeric string with `Number`, retain the raw invalid candidate as an assistant JSON message, include `{ code, path, message }` in the correction message, and add `type: 'integer'` to constrained integer tool fields. Do not alter strings outside those numeric paths.

- [ ] **Step 4: Verify GREEN**

Run: `npm run test:unit -- --runInBand tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/map-plan-schema.test.ts`

Expected: both suites PASS.

### Task 2: Remove Duplicate Edge JWT Headers

**Files:**
- Create: `supabase/functions/pixellab-map/auth.test.ts`
- Modify: `supabase/functions/pixellab-map/auth.ts`

**Interfaces:**
- Consumes: Supabase `createClient()`.
- Produces: `createPixelLabClients(token, factory?)` returning `{ authClient, userClient, serviceClient }`; authorization validates with `authClient.auth.getUser(token)` and performs RLS queries with `userClient`.

- [ ] **Step 1: Write the failing client-boundary test**

Use an injected fake client factory to record client options. Assert that the auth client has no global authorization header, the user client has exactly `Bearer token`, and the service client uses the service key.

```ts
Deno.test('validates a JWT with a header-free auth client and uses one bearer header for RLS', () => {
  const calls: Array<{ key: string; options: Record<string, unknown> }> = [];
  createPixelLabClients('user-token', (_url, key, options) => {
    calls.push({ key, options: options as Record<string, unknown> });
    return {} as SupabaseClient;
  }, { url: 'http://local', anon: 'anon', service: 'service' });
  assertEquals(calls.length, 3);
  assertEquals(calls[0].options.global, undefined);
  assertEquals(calls[1].options.global, { headers: { authorization: 'Bearer user-token' } });
  assertEquals(calls[2].key, 'service');
});
```

- [ ] **Step 2: Verify RED**

Run: `node_modules/.bin/deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map/auth.test.ts`

Expected: FAIL because the client factory is not exported and only one user client exists.

- [ ] **Step 3: Implement separate clients**

Create the three clients without changing authorization rules. Replace both `userClient.auth.getUser(token)` calls with `authClient.auth.getUser(token)` and continue returning only the data and service clients to callers.

- [ ] **Step 4: Verify GREEN and local JWT behavior**

Run the Deno auth test, then invoke `operation: capabilities` on the local function with a freshly signed-in seed user. Expected: test PASS and HTTP 200 without `Bad request`.

### Task 3: Repair Atomic Asset Transitions

**Files:**
- Modify: `tests/unit/database/create-map-workbench-migration.test.ts`
- Modify: `supabase/migrations/20260808010000_create_map_workbench.sql`

**Interfaces:**
- Consumes: `transition_map_asset(...)` RPC contract.
- Produces: the same RPC contract without ambiguous column references.

- [ ] **Step 1: Write the failing SQL regression assertion**

```ts
it('qualifies the revision status in asset transition settlement', () => {
  const transition = sql.slice(sql.indexOf('create function public.transition_map_asset'));
  expect(transition).toMatch(/update public\.map_revisions as revision[\s\S]+where revision\.id = v_revision_id[\s\S]+revision\.status <> 'draft'/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test:unit -- --runInBand tests/unit/database/create-map-workbench-migration.test.ts`

Expected: FAIL because the migration uses unqualified `id` and `status`.

- [ ] **Step 3: Qualify the update**

Change the statement to:

```sql
update public.map_revisions as revision
set status = case ... end
where revision.id = v_revision_id and revision.status <> 'draft';
```

- [ ] **Step 4: Verify GREEN and patch the running database**

Run the Jest migration test, then execute the corrected `CREATE OR REPLACE FUNCTION public.transition_map_asset(...)` definition against `supabase_db_keco-studio` in one transaction. Call `planned -> queued` on one retained asset and verify the RPC returns `attempt_count = 1` without `42702`; move that probe asset from `queued -> blocked` so the final status-aware workflow can resume it through the normal `retry` operation without inventing a provider job.

### Task 4: Make PNG Bytes Deno 2.9 Type-Safe

**Files:**
- Modify: `supabase/functions/pixellab-map/png.ts`
- Modify: `supabase/functions/pixellab-map/storage.test.ts`

**Interfaces:**
- Consumes: provider `Uint8Array` bytes.
- Produces: identical PNG hashes and Blob bytes through owned `ArrayBuffer`-backed copies.

- [ ] **Step 1: Confirm the strict type-check failure**

Run: `node_modules/.bin/deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map`

Expected: FAIL at `crypto.subtle.digest` and `new Blob([bytes])` with `Uint8Array<ArrayBufferLike>` incompatibility.

- [ ] **Step 2: Implement owned byte copies**

Create a fresh `Uint8Array` and copy source bytes before the Web Crypto call. Make the test bucket's downloaded Blob from a copied owned buffer as well.

```ts
const digestBytes = new Uint8Array(bytes.byteLength);
digestBytes.set(bytes);
const digest = await crypto.subtle.digest('SHA-256', digestBytes);
```

- [ ] **Step 3: Verify GREEN**

Run the strict Deno test command again. Expected: type checking succeeds and all PixelLab tests PASS without `--no-check`.

### Task 5: Run the Retained Real-Data Workflow on Port 3000

**Files:**
- No source changes unless a newly reproduced defect requires another explicit red-green cycle.

**Interfaces:**
- Consumes: retained project, Document, map, revisions, and four asset plans.
- Produces: valid plan response, authorized PixelLab jobs, ready assets, private storage objects, and browser evidence on `localhost:3000`.

- [ ] **Step 1: Run focused automated verification**

Run:

```bash
npm run test:unit -- --runInBand tests/unit/create-map tests/unit/database/create-map-workbench-migration.test.ts
node_modules/.bin/deno test --config supabase/functions/pixellab-map/deno.json --allow-env --allow-net supabase/functions/pixellab-map
```

Expected: all suites PASS with no type-check errors.

- [ ] **Step 2: Verify the real planner through the browser**

Use Playwright against `http://localhost:3000`: sign in with the retained seeded account, select `Livestock Management Project` and `Create Map 真实数据实测 - 青禾牧场 GDD`, click `Create map plan`, and require HTTP 200 plus `All changes saved`.

- [ ] **Step 3: Resume retained asset generation through the Edge Function**

Serve `pixellab-map` locally with repository env values. Submit or resume the four retained assets through the function, poll by condition until each reaches a terminal state, and require all four to reach `ready`. Do not reset or delete failed attempts.

- [ ] **Step 4: Verify retained database and storage evidence**

Query the retained IDs and require:

- published revision status `ready`;
- four assets with status `ready`, non-null provider job id, SHA-256, dimensions, and storage path;
- four matching private `map-assets` objects;
- source Document, map, and next draft still present.

- [ ] **Step 5: Capture browser evidence and report**

Take a full-page screenshot on `http://localhost:3000/create-map`, inspect console/network errors, and report exact test counts, retained IDs, generated asset dimensions, and any residual risk.
