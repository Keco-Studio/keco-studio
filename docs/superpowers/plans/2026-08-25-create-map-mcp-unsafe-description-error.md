# Create Map MCP Unsafe Description Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return a non-retryable, actionable `FIELD_VALIDATION_FAILED` MCP tool error when `create_map_draft` rejects an unsafe description.

**Architecture:** Preserve the existing planner validation and stable MCP error code set. Map the internal `map_description_unsafe` planner code to a dedicated safe MCP message in the Create Map MCP service, then allowlist only that canonical guidance at the App route boundary; the App bridge and tool-result layers already preserve safe 400 errors as non-retryable tool failures.

**Tech Stack:** TypeScript, Next.js App Router, Jest, Deno, MCP SDK, Zod.

## Global Constraints

- Do not change the unsafe-description pattern list.
- Do not add a new public MCP error code.
- Never echo the submitted description, matched token, credential, URL, provider response, or internal exception.
- Unsafe descriptions must not call the planning LLM or PixelLab and must not create a map project, revision, asset, or paid generation.
- Other validation and internal errors must keep their existing generic public messages.

---

### Task 1: Map Unsafe Planner Input to an Allowlisted Public Validation Error

**Files:**
- Modify: `tests/unit/create-map/create-map-mcp-service.test.ts`
- Modify: `tests/unit/create-map/create-map-mcp-route.test.ts`
- Modify: `src/lib/server/createMapMcpService.ts`
- Modify: `src/app/api/mcp/create-map/route.ts`

**Interfaces:**
- Consumes: `CreateMapPlannerInputError.code = "map_description_unsafe"`.
- Produces: `CreateMapMcpError("FIELD_VALIDATION_FAILED", CREATE_MAP_MCP_UNSAFE_DESCRIPTION_MESSAGE)` and `createMapMcpPublicMessage(code, candidateMessage?)` with strict allowlisting.

- [x] **Step 1: Write the failing service test**

Add a test that makes `backend.createDraft` reject with `{ code: "map_description_unsafe" }`, invokes `service.createDraft`, and asserts:

```ts
await expect(service.createDraft(input)).rejects.toMatchObject({
  code: 'FIELD_VALIDATION_FAILED',
  message: DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
});
expect(domain.releaseDraft).toHaveBeenCalledWith({
  idempotencyKey: IDS.requestId,
  claimToken: IDS.requestId,
});
expect(domain.invokeProvider).not.toHaveBeenCalled();
```

- [x] **Step 2: Write the failing route tests**

Add one test proving the exact canonical unsafe-description message is returned for `FIELD_VALIDATION_FAILED`, and extend the sanitization test to prove a different custom field-validation message is replaced by `Public FIELD_VALIDATION_FAILED`.

```ts
service.createDraft.mockRejectedValueOnce(new CreateMapMcpError(
  'FIELD_VALIDATION_FAILED',
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
));
expect(await response.json()).toEqual({
  code: 'FIELD_VALIDATION_FAILED',
  error: DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
});
```

- [x] **Step 3: Run the Jest tests and verify RED**

Run:

```bash
npm run test:unit -- --runTestsByPath tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts
```

Expected: the service test receives `UPSTREAM_UNAVAILABLE`, and the route test receives the generic field-validation message.

- [x] **Step 4: Implement the minimal service mapping**

Import the canonical message and add the missing branch before the default fallback:

```ts
if (code === 'map_description_unsafe') {
  throw new CreateMapMcpError(
    'FIELD_VALIDATION_FAILED',
    DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
  );
}
```

- [x] **Step 5: Implement strict public-message allowlisting**

Extend `createMapMcpPublicMessage` with an optional candidate message. Return the candidate only when the code is `FIELD_VALIDATION_FAILED` and the candidate exactly equals `DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE`; otherwise return the existing `PUBLIC_MESSAGES[code]`. Pass `error.message` as the candidate from the App route catch block.

- [x] **Step 6: Run the Jest tests and verify GREEN**

Run the command from Step 3. Expected: both suites pass with no failures.

### Task 2: Verify the Final MCP Tool Error Contract

**Files:**
- Modify: `supabase/functions/mcp/map-tools.test.ts`

**Interfaces:**
- Consumes: a 400 `FIELD_VALIDATION_FAILED` response through the App bridge boundary.
- Produces: a `CallToolResult` with `isError: true`, validation code/message, and `retryable: false`.

- [x] **Step 1: Write the MCP result regression test**

Register Map tools with a `callApp` stub that rejects with the safe validation domain error, invoke `create_map_draft`, and assert:

```ts
assertEquals(result.isError, true);
assertEquals(result.structuredContent, {
  ok: false,
  error: {
    code: 'FIELD_VALIDATION_FAILED',
    message: SAFE_MESSAGE,
    retryable: false,
  },
});
```

- [x] **Step 2: Run the Deno test and verify behavior**

Run:

```bash
npm exec -- deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/map-tools.test.ts
```

Expected: all Map tool tests pass. This test may already pass because the tool-result layer correctly preserves stable domain errors; its purpose is to lock the final contract while Task 1 changes the upstream mapping.

- [x] **Step 3: Run related sanitization and planner tests**

Run:

```bash
npm run test:unit -- --runTestsByPath tests/unit/create-map/create-map-planner.test.ts tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts
npm exec -- deno test --config supabase/functions/mcp/deno.json --allow-env supabase/functions/mcp/results.test.ts supabase/functions/mcp/app-bridge.test.ts supabase/functions/mcp/map-tools.test.ts
```

Expected: Jest and Deno suites pass with zero failures.

- [x] **Step 4: Run static verification**

```bash
npm run typecheck
npm run typecheck:api
npx eslint src/lib/server/createMapMcpService.ts src/app/api/mcp/create-map/route.ts tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts
git diff --check
```

Expected: type checks and ESLint exit successfully; `git diff --check` emits no output.

- [x] **Step 5: Commit the implementation**

```bash
git add src/lib/server/createMapMcpService.ts src/app/api/mcp/create-map/route.ts tests/unit/create-map/create-map-mcp-service.test.ts tests/unit/create-map/create-map-mcp-route.test.ts supabase/functions/mcp/map-tools.test.ts docs/superpowers/plans/2026-08-25-create-map-mcp-unsafe-description-error.md
git commit -m "fix: expose unsafe map description guidance"
```
