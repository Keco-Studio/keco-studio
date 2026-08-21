# GDD Version Folders and Independent Table Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save each new generated GDD and its generated Keco tables in an isolated project folder, with the GDD referencing independent table resources.

**Architecture:** Extend the durable GDD completion RPC as the single transactional resource boundary. Add a small TypeScript normalizer/renderer for table plans and pass the normalized plan through worker metadata; the RPC creates or reuses the folder/tables by generation-job ID before saving the document. Existing completed resources stay unchanged, while every job completed after the migration uses the isolated folder path.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL functions/migrations, Jest.

---

### Task 1: Define the table-resource contract and renderer

**Files:**
- Create: `src/lib/gdd-generation/tableResources.ts`
- Test: `src/lib/gdd-generation/tableResources.test.ts`

- [ ] **Step 1: Write failing tests** for strict table-plan normalization, duplicate-name rejection, empty plans, and `keco://tables/<id>` Markdown references.
- [ ] **Step 2: Run** `npx jest src/lib/gdd-generation/tableResources.test.ts --runInBand` and verify the new module is missing.
- [ ] **Step 3: Implement** bounded Zod schemas, deterministic name normalization, and `renderTableReferences` without embedding rows or field values.
- [ ] **Step 4: Run** the focused test and verify it passes.

### Task 2: Carry table plans through GDD generation

**Files:**
- Modify: `src/lib/gddGeneration.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/gdd-generation/worker.ts`
- Test: `src/lib/gddGeneration.test.ts`
- Test: `src/lib/gdd-generation/v2/generator.test.ts`
- Test: `src/lib/gdd-generation/worker.test.ts`

- [ ] **Step 1: Add failing tests** that v1 output exposes a normalized table plan, v1 Markdown renders only table references, and worker persistence passes the plan in metadata.
- [ ] **Step 2: Run** the focused tests and confirm failures.
- [ ] **Step 3: Implement** the shared plan type, v1 renderer integration, and v2 optional `Keco Tables` extraction marker; pass plans to the completion service while keeping no-plan jobs compatible.
- [ ] **Step 4: Run** all three focused test files and verify they pass.

### Task 3: Add transactional folder/table persistence

**Files:**
- Create: `supabase/migrations/20260819100000_gdd_version_folder_table_resources.sql`
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/lib/services/gddGenerationService.test.ts`
- Test: `tests/unit/database/gdd-version-folder-table-migration.test.ts`

- [ ] **Step 1: Write migration assertions** for job-keyed folder reuse, table creation before document insertion, folder-scoped resources, and output folder/table IDs.
- [ ] **Step 2: Run** the migration test and confirm the new migration fails the assertions.
- [ ] **Step 3: Implement** the RPC signature and service payload for `table_plans`; create/reuse folder and tables under the project lock, then create/update the GDD in that folder.
- [ ] **Step 4: Run** service and migration tests; update SQL grants and `notify pgrst` as needed.

### Task 4: Expose generated folder and table outputs

**Files:**
- Modify: `src/lib/services/gddGenerationService.ts`
- Modify: `src/app/api/game-design-systems/generation-jobs/[id]/route.ts`
- Test: `tests/unit/gdd-generation-output.test.ts`

- [ ] **Step 1: Add failing route/service tests** for public output including `output_folder_id` and independent table IDs while excluding internal input snapshots.
- [ ] **Step 2: Run** the focused test and verify failure.
- [ ] **Step 3: Implement** bounded public output fields and response serialization.
- [ ] **Step 4: Run** focused tests plus the existing GDD generation suite.

### Task 5: Verify the complete change

- [ ] **Step 1: Run** `npx jest src/lib/gdd-generation src/lib/services/gddGenerationService.test.ts tests/unit/database/gdd-generation-migration.test.ts tests/unit/database/gdd-version-folder-table-migration.test.ts --runInBand`.
- [ ] **Step 2: Run** `npm run lint` and `npx tsc --noEmit`.
- [ ] **Step 3: Review the diff for unrelated changes and confirm existing user edits remain untouched.
