# GDD Unused Code Cleanup Implementation Plan

> **For agentic workers:** This plan is executed inline in the current session.

**Goal:** Remove GDD v2 generation code that is unreachable from the current worker while preserving the direct Markdown path and v1 historical-job compatibility.

**Architecture:** The worker keeps `generateGddMarkdownV2` as the only v2 model path. The unused staged AST pipeline (blueprint, section batches, review, repair, quality gate, and v2 renderer) is removed together with its tests and dead AST contract helpers. The legacy `src/lib/gddGeneration.ts` path remains available for pre-v2 jobs.

**Tech Stack:** TypeScript, Jest, Next.js server worker.

---

### Task 1: Lock the production scope

**Files:**
- Create: `tests/unit/gdd-generation-v2-scope.test.ts`

- [x] Add a static scope test asserting that the v2 generator no longer exports staged-generation entry points and that the standalone v2 quality/renderer modules are absent.
- [x] Run the focused test and confirm it fails against the current staged implementation.

### Task 2: Remove unreachable v2 staged generation

**Files:**
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Delete: `src/lib/gdd-generation/v2/quality.ts`
- Delete: `src/lib/gdd-generation/v2/renderer.ts`
- Modify/Delete: staged sections of `src/lib/gdd-generation/v2/generator.test.ts` and `src/lib/gdd-generation/v2/quality.test.ts`

- [x] Keep only direct Markdown generation, source-context construction, prompt sanitization, and the v2 validation error used by the worker.
- [x] Remove Blueprint, Section, Quick AST, Review, Repair, deterministic quality, and document assembly functions and their tests.
- [x] Keep tests for one-call Markdown generation, mode prompt constraints, code-fence/provenance normalization, and source-context injection.

### Task 3: Prune dead v2 AST contracts

**Files:**
- Modify: `src/lib/gdd-generation/v2/contracts.ts`
- Modify: `src/lib/gdd-generation/v2/contracts.test.ts`

- [x] Keep only the v2 job request type, generation mode type, and `isGddGenerationRequestV2` guard used by the worker/service.
- [x] Remove AST schemas, parser helpers, and tests that only served the deleted staged pipeline.

### Task 4: Verify compatibility and tests

- [x] Run the scope test and focused GDD generator tests.
- [x] Run the GDD worker and route tests to verify v1 fallback and v2 direct generation remain intact.
- [x] Run TypeScript typecheck for the edited modules and inspect the final diff for unrelated changes.
