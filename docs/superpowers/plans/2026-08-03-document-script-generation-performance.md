# Document Script Generation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse safe Story IR conversions and remove redundant document-derived upload work while preserving audit and import behavior.

**Architecture:** Wrap the existing `resolveStoryForImport` call in a small bounded cache keyed by normalized source content and conversion version. Share in-flight promises for concurrent requests, but cache only successful resolutions. For document-derived imports, use the server-verified snapshot directly and require a file only for ordinary file imports.

**Tech Stack:** TypeScript, Jest 30, Next.js route handlers, existing Story IR conversion and NDJSON progress stream.

---

### Task 1: Add failing conversion-cache tests

**Files:**
- Create: `src/lib/import-script-conversion-cache.test.ts`
- Create later: `src/lib/import-script-conversion-cache.ts`

- [ ] **Step 1: Write the failing tests**

Cover these behaviors with a deferred resolver:

```ts
it('shares a successful conversion between concurrent callers', async () => {
  const resolver = jest.fn(async () => ({ value: 'story' }));
  const first = getOrResolveStory('source', resolver);
  const second = getOrResolveStory('source', resolver);
  await expect(Promise.all([first, second])).resolves.toEqual([
    { value: 'story' },
    { value: 'story' },
  ]);
  expect(resolver).toHaveBeenCalledTimes(1);
});

it('does not cache rejected conversions', async () => {
  const resolver = jest.fn()
    .mockRejectedValueOnce(new Error('bad'))
    .mockResolvedValueOnce({ value: 'retry' });
  await expect(getOrResolveStory('source', resolver)).rejects.toThrow('bad');
  await expect(getOrResolveStory('source', resolver)).resolves.toEqual({ value: 'retry' });
  expect(resolver).toHaveBeenCalledTimes(2);
});

it('uses different keys for different source content', async () => {
  const resolver = jest.fn(async (source: string) => ({ source }));
  await getOrResolveStory('one', resolver);
  await getOrResolveStory('two', resolver);
  expect(resolver).toHaveBeenCalledTimes(2);
});
```

Export a test-only reset function so each test starts with an empty cache.

- [ ] **Step 2: Run the tests and verify the expected module failure**

Run: `npx jest src/lib/import-script-conversion-cache.test.ts --runInBand`

Expected: FAIL because `@/lib/import-script-conversion-cache` does not exist.

### Task 2: Implement bounded cache and wire the route

**Files:**
- Create: `src/lib/import-script-conversion-cache.ts`
- Modify: `src/app/api/import-script/route.ts`
- Test: `src/lib/import-script-conversion-cache.test.ts`

- [ ] **Step 1: Implement the minimal cache**

Provide:

```ts
export async function getOrResolveStory<T>(
  sourceText: string,
  resolver: (sourceText: string) => Promise<T>
): Promise<{ value: T; cacheHit: boolean }>;
export function resetStoryConversionCache(): void;
```

Hash `sourceText` with SHA-256 and prefix the key with a conversion version constant. Keep up to eight successful entries for ten minutes. Store an in-flight promise separately, return `cacheHit: true` for completed or in-flight reuse, delete rejected promises, and never cache an `AbortError` result.

- [ ] **Step 2: Wire only the conversion call**

In the route, replace the direct `resolveStoryForImport(fileContent, options)` call with `getOrResolveStory(fileContent, (content) => resolveStoryForImport(content, options))`. Use the request's `AbortSignal` for the owner conversion. Emit `{ phase: 'conversion', message: 'Reusing cached Story IR conversion' }` on a hit before awaiting the result. Keep the existing progress callback and database write path unchanged.

- [ ] **Step 3: Run cache and route conversion tests**

Run: `npx jest src/lib/import-script-conversion-cache.test.ts tests/unit/api-import-script-route.test.ts --runInBand`

Expected: PASS for the new cache tests and no regression in route tests.

### Task 3: Remove redundant document-derived file upload

**Files:**
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/lib/documents/runDocumentDerivedImport.ts`
- Modify: `tests/unit/api-import-script-route.test.ts`

- [ ] **Step 1: Add failing route coverage**

Add a document-derived request fixture with `sourceDocumentId`, valid snapshot token, `libraryName`, and no `file`. Assert it reaches conversion. Add/retain a file-import case asserting `File is required` when `sourceDocumentId` is absent.

- [ ] **Step 2: Run the focused test to verify failure**

Run: `npx jest tests/unit/api-import-script-route.test.ts --runInBand`

Expected: FAIL because the route currently rejects every request without a `File`.

- [ ] **Step 3: Implement conditional file handling**

Require and validate `File` only when `sourceDocumentId` is empty. For document-derived requests use `verifiedSource.markdown` and `${verifiedSource.documentName}.txt` as the conversion filename. Stop appending the generated file in `runDocumentDerivedImport`; continue sending project ID, source document ID, snapshot token, export type, and library name.

- [ ] **Step 4: Run route and derived-import tests**

Run: `npx jest tests/unit/api-import-script-route.test.ts tests/unit/documents/document-derived-sidebar.test.tsx --runInBand`

Expected: PASS.

### Task 4: Add cache progress and regression assertions

**Files:**
- Modify: `src/lib/import-script-conversion-cache.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `tests/unit/import-script-progress.test.ts` if present, otherwise create `tests/unit/import-script-progress.test.ts`

- [ ] **Step 1: Add a progress test**

Assert that a cache hit emits a conversion progress message containing `cached` or `Reusing cached Story IR conversion`, and that a cache miss still forwards the resolver's normal `conversion`, `deterministic_validation`, and `semantic_audit` events.

- [ ] **Step 2: Implement the progress event without leaking data**

Emit only the phase and fixed message. Do not include the source hash, document content, prompt, token, or request headers.

- [ ] **Step 3: Run focused progress tests**

Run: `npx jest tests/unit/import-script-progress.test.ts --runInBand`

Expected: PASS.

### Task 5: Full verification and latency probe

**Files:**
- Verify: all files above and existing user changes remain untouched.

- [ ] **Step 1: Run focused conversion and route suites**

Run: `npx jest src/lib/story-plan/conversion.test.ts src/lib/import-script-conversion-cache.test.ts tests/unit/api-import-script-route.test.ts --runInBand`

- [ ] **Step 2: Run static checks**

Run: `npm run typecheck && npm run typecheck:api && npm run lint && git diff --check`

- [ ] **Step 3: Run the real cold and warm probes**

Run the existing rainy-manor probe once for a cold conversion, then exercise the same route twice in a route-level harness or add a deterministic cache hit probe. Record conversion stage telemetry and compare the second run's absence of LLM stages.

- [ ] **Step 4: Review the diff and report residual risk**

Confirm that cache hits still call `importStoryDocument`, ordinary file imports still require and validate files, and no test or generated artifact changes are unrelated.

### Task 6: Remove cold Auditor latency for document-derived generation

**Files:**
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `src/lib/story-plan/conversion.test.ts`
- Modify: `tests/unit/import-script-minimal-plan.integration.test.ts`
- Modify: `src/lib/import-script-conversion-cache.ts`
- Modify: `src/lib/import-script-conversion-cache.test.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `tests/unit/api-import-script-route.test.ts`

- [ ] **Step 1: Add failing validation-fast-path tests**

Require `skipSemanticAuditAfterValidation: true` to return `approval: 'validation_pass'`, `auditSkipped: true`, and make zero Auditor calls for deterministic sources. Require arbitrary sources to stop after Extractor and Graph Planner once deterministic materialization and projection pass. Assert default behavior still calls Auditor.

- [ ] **Step 2: Verify RED**

Run: `npx jest src/lib/story-plan/conversion.test.ts tests/unit/import-script-minimal-plan.integration.test.ts --runInBand`

Expected: FAIL because the option and approval state do not exist.

- [ ] **Step 3: Implement explicit validation acceptance**

Add `skipSemanticAuditAfterValidation?: boolean` to `ResolveStoryPlanOptions`. After successful projection, return the validated StoryDocument without constructing an audit request when enabled. Preserve the effective `audit` pass object for compatibility, make `primaryAudit` optional, and add `approval: 'validation_pass'` plus `auditSkipped: true`.

- [ ] **Step 4: Isolate cache policies**

Add an optional cache variant string to `getOrResolveStory` and include it in the SHA-256 key. The route uses `document-validation-v1` for document-derived requests and `mandatory-audit-v1` for ordinary imports.

- [ ] **Step 5: Enable only document-derived requests**

Pass `skipSemanticAuditAfterValidation: Boolean(sourceDocumentId)` from the route. Add route assertions proving document-derived requests enable it and ordinary file imports do not.

- [ ] **Step 6: Verify GREEN and benchmark deterministic latency**

Run focused conversion, route, and cache tests, then run the rainy-manor fixture with the fast-path option and assert zero LLM calls. Record elapsed time without database writes.

### Task 7: Parse escaped Chinese Markdown screenplays locally

**Files:**
- Modify: `src/lib/documents/scriptImportPlainText.ts`
- Modify: `src/lib/story-plan/explicitParser.ts`
- Modify: `src/lib/story-plan/conversion.ts`
- Modify: `tests/unit/documents/script-import-plain-text.test.ts`
- Modify: `tests/unit/import-script-minimal-plan.integration.test.ts`

- [ ] **Step 1: Reproduce the escaped Markdown failure**

Add a fixture containing escaped headings, bold speakers, action cues, dialogue, and scene headings. Require successful conversion while the LLM mock rejects every request.

- [ ] **Step 2: Normalize import Markdown**

Unescape common Markdown punctuation and remove heading, list, quote, bold, and underline markers while preserving visible text.

- [ ] **Step 3: Add a narrow linear screenplay parser**

Build a sequential relationship plan only when the source has at least one scene heading, at least two dialogue segments, and no real choice segments. Keep ordinary prose and branching documents on existing paths.

- [ ] **Step 4: Verify the real reported document**

Read the reported document without logging its content, disable the LLM key before conversion, and record only source character count, node count, elapsed milliseconds, and approval state.
