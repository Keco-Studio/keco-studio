# Task 6 Report: Complete GDD Usage Attribution

## Scope

Implemented durable AI usage attribution for every GDD model stage:

- Quick/v1 generation and JSON repair.
- Quick/v2 primary stream, truncation recovery, table repair, dialogue recovery, and per-scene planning/repair.
- Professional planning, planning repair, core/systems/content stages, stage repairs, and review handoff.
- Map brief compilation and repair.
- Asynchronous map/table resource jobs and GDD dialogue-to-Script conversion.

All usage bindings retain the parent GDD job as `jobId` and `correlationId`. Resource and dialogue jobs use their own ID only as `artifactId`. Scene metadata contains only `sceneIndex` (plus bounded repair attempt), never dialogue/GDD content.

## RED Evidence

Added `tests/unit/ai-usage/gdd-attribution.test.ts` before production edits.

Command:

```bash
npx jest --runInBand tests/unit/ai-usage/gdd-attribution.test.ts
```

Observed RED after the document-codec test mock was added: all seven attribution assertions failed because GDD completions, streams, map compilation, resource workers, and Script conversion received no `usageBinding`. Representative failure: expected `quick_generate` / `quick_repair`, received no completion calls under the new dependency object contract. This confirmed the runtime contracts had not yet carried usage bindings.

## GREEN Evidence

Final verification command:

```bash
npx jest --runInBand tests/unit/ai-usage/gdd-attribution.test.ts tests/unit/gdd-generation tests/unit/gdd-generation-routes.test.ts tests/unit/gdd-generation-v2-scope.test.ts src/lib/gdd-generation/worker.test.ts src/lib/gdd-generation/resources/worker.test.ts src/lib/gdd-generation/dialogueWorker.test.ts src/lib/gdd-generation/maps/compiler.test.ts src/lib/gdd-generation/v2/generator.test.ts src/lib/gdd-generation/v2/professionalStages.test.ts src/lib/gdd-generation/v2/dialoguePlanner.test.ts
```

Result: 10 suites passed, 160 tests passed.

Also passed:

```bash
npm run typecheck
git diff --check
```

## Files

- Added `src/lib/gdd-generation/usage.ts` for operation-level binding derivation.
- Updated `src/lib/gddGeneration.ts` and `src/lib/gdd-generation/v2/generator.ts` for quick generation, recovery, table, and dialogue stages.
- Updated `src/lib/gdd-generation/v2/professionalStages.ts` and `src/lib/gdd-generation/worker.ts` for professional stages and review.
- Updated `src/lib/gdd-generation/v2/dialoguePlanner.ts` and `src/lib/gdd-generation/maps/compiler.ts` for per-call operations.
- Updated `src/lib/gdd-generation/resources/worker.ts` and `src/lib/gdd-generation/dialogueWorker.ts` for durable parent-owner service bindings.
- Added the operation matrix test and updated affected worker tests for the dependency contract.

## Self-Review

- All operation names are derived at call sites, not in the generic LLM client.
- All GDD provider calls receive explicit configured providers through the existing LLM option builders.
- No prompt, completion, resource content, image data, or raw provider body is placed in usage metadata or logs.
- Script conversion receives the existing Task 5-instrumented client binding; no second recorder is introduced for its internal model stages.
- The resource worker resolves the parent owner by parent GDD job and project before default map/table model paths run. Override tests inject this lookup explicitly so production behavior is not bypassed.

## Concerns

None identified. The target Jest command's directory argument only discovers the top-level route tests in this repository, so the final verification additionally invoked the concrete GDD worker and runtime test files listed above.
