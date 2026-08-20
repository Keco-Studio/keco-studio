# GDD Dialogue Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

Goal: Extend GDD generation to create chapter-level dialogue Documents and durable Script-tree jobs, reference both resources from the GDD, and retry failed Script derivations without losing the GDD or source Document.

Architecture: Add one shared dialogue-plan contract for v1 structured output and v2 Markdown marker output. Materialize stable Document/job IDs before encoding the GDD Yjs snapshot, then pass those resources to the existing transactional GDD completion RPC. A separate lease-based dialogue worker reads the current source Document, invokes the existing Story IR compiler and importStoryDocument, and records Script completion. The existing cron/internal worker route schedules both GDD and dialogue jobs.

Tech Stack: Next.js App Router, TypeScript, Zod, Supabase PostgreSQL/RPC/RLS, MDX/Yjs document codec, Story IR/plot-plan importer, Jest, Playwright.

---

### Task 1: Add the shared dialogue-plan contract and renderer

Files:
- Create: src/lib/gdd-generation/dialogueResources.ts
- Test: src/lib/gdd-generation/dialogueResources.test.ts

- [ ] Step 1: Write failing tests for marker parsing, strict unknown-key rejection, duplicate chapterKey rejection, no-marker compatibility, stable UUID materialization, and status-aware reference Markdown.
- [ ] Step 2: Run npx jest src/lib/gdd-generation/dialogueResources.test.ts --runInBand. Expected: FAIL because dialogueResources.ts is missing.
- [ ] Step 3: Implement strict Zod types with chapterKey max 120, title max 160, content max 120000, and branchSummary max 50 entries. Implement extractDialoguePlanMarker returning markdown, plans, and warning; reject duplicate keys and unknown fields; treat malformed whole-marker JSON as a bounded warning with no plans. Implement materializeDialogueResources(gddJobId, plans) with deterministic "<title> dialogue" names and generated Document/job UUIDs. Implement renderDialogueReferences(projectId, resources, statuses) with source Document links, stable job IDs, Generating/Running/Failed - Retry/Completed labels, and Script links only when scriptLibraryId exists.
- [ ] Step 4: Run the focused test and verify it passes.
- [ ] Step 5: Commit with git add src/lib/gdd-generation/dialogueResources.ts src/lib/gdd-generation/dialogueResources.test.ts and git commit -m "feat: add GDD dialogue resource contract".

### Task 2: Parse dialogue plans from both GDD generation contracts

Files:
- Modify: src/lib/gdd-generation/v2/generator.ts
- Modify: src/lib/gdd-generation/v2/contracts.ts
- Modify: src/lib/gddGeneration.ts
- Test: src/lib/gdd-generation/v2/generator.test.ts
- Test: src/lib/gddGeneration.test.ts

- [ ] Step 1: Add failing v2 tests for a KECO_DIALOGUE_PLAN marker, marker removal, prompt instructions to create complete dialogue only for chapters with interaction/choices/spoken lines, and returned dialoguePlans. Add a v1 JSON-response test containing dialogueChapters and assert the parsed GeneratedGdd exposes it.
- [ ] Step 2: Run npx jest src/lib/gdd-generation/v2/generator.test.ts src/lib/gddGeneration.test.ts --runInBand. Expected: FAIL because result types and extractors do not expose dialogue plans.
- [ ] Step 3: Extend GeneratedGdd with dialogueChapters defaulting to an empty array and normalize it through the shared schema. Extend generateGddMarkdownV2 to return dialoguePlans. Extract and strip the v2 marker beside table-plan extraction, and include the dialogue instructions in normal and compact recovery prompts. Keep malformed whole v2 markers non-fatal with a bounded warning and no plans.
- [ ] Step 4: Run the focused tests and verify all existing v1/v2 table tests remain green.
- [ ] Step 5: Commit with git add on the listed files and git commit -m "feat: parse dialogue plans from GDD output".

### Task 3: Pass dialogue resources through GDD completion

Files:
- Modify: src/lib/gdd-generation/worker.ts
- Modify: src/lib/services/gddGenerationService.ts
- Test: src/lib/gdd-generation/worker.test.ts
- Test: src/lib/services/gddGenerationService.test.ts

- [ ] Step 1: Add failing tests that provide one dialogue plan and assert persistence receives materialized chapterKey, Document ID, dialogue job ID, and content; assert the GDD Markdown contains a Dialogue Resources section before markdownToYjsState; assert the RPC payload contains p_dialogue_resources and defaults to an empty array.
- [ ] Step 2: Run npx jest src/lib/gdd-generation/worker.test.ts src/lib/services/gddGenerationService.test.ts --runInBand. Expected: FAIL because the worker and RPC wrapper have no dialogue payload.
- [ ] Step 3: In both v1 and v2 persistence functions, materialize plans, append the Dialogue Resources section before sanctioned MDX validation/Yjs encoding, include bounded dialogue metadata, and pass sanitized resources to persistCompletedGddGenerationJob. Extend the service input and named RPC payload while preserving an empty default for old jobs.
- [ ] Step 4: Run npx jest src/lib/gdd-generation/worker.test.ts src/lib/services/gddGenerationService.test.ts src/lib/gdd-generation src/lib/gddGeneration.test.ts --runInBand.
- [ ] Step 5: Commit with git add on the listed files and git commit -m "feat: pass dialogue resources through GDD completion".

### Task 4: Add the transactional dialogue-job schema and completion RPC

Files:
- Create: supabase/migrations/20260819160000_gdd_dialogue_generation_jobs.sql
- Create: tests/unit/database/gdd-dialogue-generation-migration.test.ts

- [ ] Step 1: Write a migration test asserting dialogue_generation_jobs exists, chapter uniqueness is constrained per GDD job, status includes queued/running/completed/failed, the completion RPC accepts p_dialogue_resources jsonb, rows contain document_id and script_library_id, and claim/retry RPCs exist. Assert the dialogue-job insert includes project_id and gdd_generation_job_id, while its source-Document insert includes project_id, folder_id, and source content.
- [ ] Step 2: Run npx jest tests/unit/database/gdd-dialogue-generation-migration.test.ts --runInBand. Expected: FAIL because the migration is missing.
- [ ] Step 3: Create dialogue_generation_jobs with parent GDD/project/source Document/optional Script foreign keys, strict status and attempt constraints, unique gdd_generation_job_id plus chapter_key, claim indexes, and service-role-only grants. Add a ten-argument completion function with p_dialogue_resources and keep the existing nine-argument function as a compatibility wrapper. Insert/reuse chapter Documents and queued jobs under the generated version folder without creating Script libraries. Do not set documents.gdd_generation_job_id on chapter Documents because that column has a one-GDD-document unique index; associate them through dialogue_generation_jobs instead. Add service-role RPCs claim_dialogue_generation_job, heartbeat_dialogue_generation_job, complete_dialogue_generation_job, fail_dialogue_generation_job, and retry_dialogue_generation_job. Enforce project ownership and stale-lease rejection.
- [ ] Step 4: Run npx jest tests/unit/database/gdd-dialogue-generation-migration.test.ts tests/unit/database/gdd-version-folder-table-migration.test.ts --runInBand and git diff --check.
- [ ] Step 5: Commit with git add supabase/migrations/20260819160000_gdd_dialogue_generation_jobs.sql tests/unit/database/gdd-dialogue-generation-migration.test.ts and git commit -m "feat: add durable GDD dialogue jobs".

### Task 5: Implement dialogue service and Story IR worker

Files:
- Create: src/lib/services/dialogueGenerationService.ts
- Create: src/lib/gdd-generation/dialogueWorker.ts
- Test: src/lib/services/dialogueGenerationService.test.ts
- Test: src/lib/gdd-generation/dialogueWorker.test.ts
- Modify: src/lib/services/scriptImportService.ts
- Test: src/lib/services/scriptImportService.test.ts

- [ ] Step 1: Add failing service tests for exact claim/heartbeat/complete/fail/list/retry RPC arguments and project ownership. Add an import-service regression test proving normal imports still generate their own UUID while a dialogue job may reuse only an explicitly job-owned Script library. Add an injected-worker test asserting current Document content is passed through resolveStoryForImport with skipSemanticAuditAfterValidation true and enableAiPlotPlanning false, then importStoryDocument uses documentSource exportType script and completion records the Script ID. Add failure tests for source preservation, bounded retry errors, and stale leases.
- [ ] Step 2: Run npx jest src/lib/services/dialogueGenerationService.test.ts src/lib/gdd-generation/dialogueWorker.test.ts src/lib/services/scriptImportService.test.ts --runInBand. Expected: FAIL because the service, worker, and provenance support do not exist.
- [ ] Step 3: Implement typed service RPC wrappers and project-scoped public DTOs. Implement the worker to claim, read the current Document with documentStateGateway, reject empty/deleted content, resolve Story IR, call importStoryDocument, complete with the returned library ID, and requeue transient failures with bounded exponential delay. Extend ImportStoryParams with optional job-owned provenance/reuse and preserve ordinary import behavior.
- [ ] Step 4: Run the focused tests and verify worker retry, stale lease, and manual import regression coverage.
- [ ] Step 5: Commit the listed service/worker/import files with git commit -m "feat: derive Script trees from GDD dialogue jobs".

### Task 6: Make completed Script references durable and add job APIs

Files:
- Create: src/lib/documents/serverDocumentReplacement.ts
- Create: src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/dialogue-jobs/route.ts
- Create: src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/dialogue-jobs/[dialogueJobId]/retry/route.ts
- Test: tests/unit/dialogue-generation-routes.test.ts
- Test: src/lib/documents/serverDocumentReplacement.test.ts
- Modify: src/lib/gdd-generation/dialogueWorker.ts

- [ ] Step 1: Write failing replacement tests for reading current Yjs state, replacing only the matching generated status/link fragment, calling replace_document_with_markdown with current epoch/revision/update IDs, and rejecting revision conflicts. Write route tests for authorized list/retry, viewer 403, cross-project 404, and completed-job 409.
- [ ] Step 2: Run npx jest src/lib/documents/serverDocumentReplacement.test.ts tests/unit/dialogue-generation-routes.test.ts --runInBand. Expected: FAIL because helper and routes are missing.
- [ ] Step 3: Implement a server-only replacement helper using documentStateGateway.read and documentContentCodec.markdownToYjsState, with explicit expected snapshots and conflict handling. Replace only the matching dialogue job fragment; never overwrite unrelated user edits. Add bounded parent GET and nested retry POST routes with withAuth, editor/admin checks, parent/job ownership checks, and no source content or lease internals in public responses. On Script completion, call the helper; if it conflicts, keep the Script/job completed and let the job API remain authoritative.
- [ ] Step 4: Run the focused replacement and route tests.
- [ ] Step 5: Commit the API/helper files with git commit -m "feat: expose dialogue job status and retry".

### Task 7: Schedule dialogue workers and expose status in the GDD surface

Files:
- Modify: src/app/api/internal/game-design-system-worker/route.ts
- Modify: src/app/api/projects/[projectId]/gdd-generation-jobs/route.ts
- Modify: src/app/api/projects/[projectId]/gdd-generation-jobs/[id]/route.ts
- Modify: src/lib/services/gameDesignSystemClient.ts
- Modify: src/components/game-design-system/GameDesignSystemWorkspace.tsx
- Test: tests/unit/game-design-system-worker-route.test.ts
- Test: tests/unit/gdd-generation-routes.test.ts
- Test: tests/e2e/specs/gdd-dialogue-resources.spec.ts

- [ ] Step 1: Add failing tests that mock processNextDialogueJob and assert an authorized cron invocation can claim dialogue work while retaining constant-time auth and existing system/GDD dispatch. Add route tests for bounded dialogue summaries and polling of queued/due dialogue jobs. Add a Playwright fixture with two chapters and assertions for shared version folder, source Documents, Script Flow chart link, and one retryable failed chapter.
- [ ] Step 2: Run npx jest tests/unit/game-design-system-worker-route.test.ts tests/unit/gdd-generation-routes.test.ts --runInBand. Expected: FAIL because scheduler, DTOs, and UI do not know dialogue jobs.
- [ ] Step 3: Add processNextDialogueJob to the internal cron loop with bounded attempts, typed client methods for list/retry, and GDD workspace rendering of per-chapter Document link, Script link, status, bounded error, and icon-labeled retry button. Invalidate job queries after retry. Do not create a new editor or duplicate the existing Script Flow chart.
- [ ] Step 4: Run the route tests and npx playwright test tests/e2e/specs/gdd-dialogue-resources.spec.ts.
- [ ] Step 5: Commit the scheduler/client/UI files with git commit -m "feat: schedule and display GDD dialogue jobs".

### Task 8: Verify the complete feature and compatibility

Files:
- Modify only files required by Tasks 1-7; preserve unrelated existing worktree changes.

- [ ] Step 1: Run npx jest src/lib/gdd-generation src/lib/services/gddGenerationService.test.ts src/lib/services/dialogueGenerationService.test.ts src/lib/gdd-generation/dialogueWorker.test.ts tests/unit/database/gdd-dialogue-generation-migration.test.ts tests/unit/gdd-generation-routes.test.ts --runInBand.
- [ ] Step 2: Run npx jest src/lib/services/scriptImportService.test.ts src/lib/story-plan src/lib/story-graph tests/unit/documents --runInBand to verify ordinary Document -> Script imports and Story graph editing.
- [ ] Step 3: Run npm run lint and npx tsc --noEmit. Expected: both exit 0.
- [ ] Step 4: Run npx playwright test tests/e2e/specs/gdd-dialogue-resources.spec.ts tests/e2e/specs/keco-script-workspace.spec.ts tests/e2e/specs/document-derived-libraries.spec.ts.
- [ ] Step 5: Run git diff --check, git status --short, and git diff --stat. Confirm only dialogue feature files, tests, migration, and approved documentation are included; preserve all unrelated user edits.
