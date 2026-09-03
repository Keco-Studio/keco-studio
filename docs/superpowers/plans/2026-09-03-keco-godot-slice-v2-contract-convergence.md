# Keco Godot Slice V2 Contract Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge every new Keco Godot Slice run on contract version 2 while preserving explicit version-1 read, resume, and completion behavior.

**Architecture:** A canonical JSON manifest and conformance corpus define bounded values, reason codes, profiles, paths, reviews, runtime evidence, and lifecycle order. Zod/MCP performs request validation and deterministic evaluation, additive `_v2` SQL functions repeat transactional and trust-boundary invariants, and Python imports the same rules for offline validation and crash-safe mirror materialization. Public MCP tool names dispatch by stored or requested contract version; Codex and Claude Skills are concise, byte-parity checked contract routers.

**Tech Stack:** TypeScript, Zod, Deno test, PostgreSQL/Supabase SQL, Python 3 standard library, Jest, Codex and Claude plugin Markdown/JSON.

## Global Constraints

- New runs declare `contractVersion: 2`; absent versions are legacy version 1 and are never silently upgraded.
- Public MCP names remain `create_slice_bundle`, `checkpoint_slice`, `export_slice_mirrors`, and `finalize_slice`; V2 dispatch uses explicit `_v2` SQL functions.
- Only `kind: gdd` requires Requirement Inventory and GDD mappings; all other profiles use `coverageMode: non_gdd` plus `nonGddRationale`.
- Canonical document mutations end at `prepare_delivery`; `export`, materialization, `MirrorVerification`, and `delivery` do not mutate roadmap/spec/plan.
- V2 runtime input accepts only `KECO_OBSERVATION`; `KECO_EVAL` is restricted to the explicit version-1 adapter and cannot self-author expected values or status.
- Review strength is `self < separate_context < independent_actor`; only trusted execution context can prove `separate_context`, and SQL proves a different authenticated actor for `independent_actor`.
- A run accepts at most three `repair_transition` events across retries, replay keys, and resume attempts.
- Mirror materialization validates the complete batch before staging, journals before replacement, restores exact prior hashes on handled failure, and recovers an existing journal before processing another export.
- Preserve all unrelated dirty work, especially `tmp/`; stage only paths named by each task.
- Do not modify the approved design spec, V1 Skill, PixelLab, Godot MCP, or unrelated workflows; do not create a PR or push.

## Acceptance Mapping

| AC | Implemented by | Primary evidence |
|---|---|---|
| 1 | Tasks 2-3 | V2 SQL/MCP creates root roadmap and same-name spec/plan in verified child folders |
| 2 | Tasks 2-3 | second-Slice roadmap `bind` case with optimistic revision checks |
| 3 | Tasks 1, 4, 7 | identity fields only; repository scan rejects hard-coded display identity |
| 4 | Tasks 1, 3-4 | all five SourceProfile cases; GDD-only inventory gate |
| 5 | Tasks 1, 3-4 | Python/Zod corpus parity for paths, scope, eval reciprocity, review values |
| 6 | Tasks 1, 4 | substantive multi-Slice validator cases, including similarity result details |
| 7 | Tasks 1, 3-4, 7 | V2 observation rejection plus explicit legacy adapter |
| 8 | Tasks 2-4 | server-derived review level and SQL actor/context proof |
| 9 | Tasks 1-3 | manual acceptance remains separate and blocks default release policy |
| 10 | Task 6 | preflight/staging/journal/restore/restart injection tests |
| 11 | Tasks 2-3 | fourth repair rejected after replay and resume |
| 12 | Tasks 1-8 | shared conformance, Deno, Jest, Python, and database suites |
| 13 | Task 8 | five fresh contexts per wording variant plus control and reviewed raw results |
| 14 | Tasks 7-9 | Codex/Claude parity plus installed digest/cachebuster verification |

---

### Task 1: Canonical Contract Manifest And Conformance Corpus

**Files:**
- Create: `contracts/keco-slice-v2/contract-manifest.json`
- Create: `contracts/keco-slice-v2/conformance-cases.json`
- Create: `supabase/functions/mcp/slice-v2-contract.ts`
- Create: `supabase/functions/mcp/slice-v2-contract.test.ts`
- Modify: `tests/fixtures/plugins/keco-slice-contract-cases.json`

**Interfaces:**
- Produces: `SLICE_CONTRACT_VERSION`, bounded reason codes, profile kinds, review levels, release order, canonical document paths, `validateSliceV2ContractCase(boundary, value): ContractDecision`, and shared cases shaped as `{ id, boundary, input, expected: { accepted, reasonCode } }`.
- Consumed by: Tasks 2-4 and 7-8.

- [x] **Step 1: Write failing manifest and conformance tests**

Add table-driven tests proving valid GDD/non-GDD profiles and the required invalid cases: parent traversal, absolute path, missing `allowedFiles`, ghost evaluation, reverse mapping omission, wrong folder, forged review level, legacy prefix, stale token, fourth repair, and manual acceptance.

```ts
for (const testCase of corpus.cases) {
  const decision = validateSliceV2ContractCase(testCase.boundary, testCase.input);
  expect(decision).toEqual(testCase.expected);
}
```

- [x] **Step 2: Run RED**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-v2-contract.test.ts`

Expected: FAIL because `slice-v2-contract.ts` and canonical manifest/corpus do not exist.

- [x] **Step 3: Implement the canonical contract loader and pure validators**

Implement strict exact-key profile validation, safe repository path validation, plan/evaluation reciprocity, ordered dependency validation, review-level restrictions, observation prefix rules, and stable `SLICE_*` reason codes. Keep detailed diagnostics separate from the public code.

```ts
export type ContractDecision =
  | { accepted: true; reasonCode: null }
  | { accepted: false; reasonCode: SliceReasonCode };
export function validateSliceV2ContractCase(boundary: ContractBoundary, input: unknown): ContractDecision;
```

- [x] **Step 4: Run GREEN**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-v2-contract.test.ts`

Expected: PASS for every canonical case with no reason-code disagreement.

- [x] **Step 5: Commit**

```bash
git add contracts/keco-slice-v2 supabase/functions/mcp/slice-v2-contract.ts supabase/functions/mcp/slice-v2-contract.test.ts tests/fixtures/plugins/keco-slice-contract-cases.json
git commit -m "feat(slice): define version 2 contract corpus"
```

### Task 2: Additive V2 Persistence And Transactional Lifecycle

**Files:**
- Create: `supabase/migrations/20260903120000_slice_v2_contract_convergence.sql`
- Modify: `tests/unit/database/deterministic-slice-runs-migration.test.ts`
- Modify: `tests/unit/database/deterministic-slice-runs.behavior.test.ts`

**Interfaces:**
- Consumes: manifest reason codes and lifecycle order from Task 1.
- Produces: additive columns `contract_version`, `planning_root_id`, `source_profile`, `source_profile_hash`, `supersedes_run_id`, trusted event context/review fields, and RPCs `mcp_create_slice_bundle_v2`, `mcp_checkpoint_slice_v2`, `mcp_prepare_slice_delivery_v2`, `mcp_export_slice_mirrors_v2`, `mcp_finalize_slice_v2`.

- [ ] **Step 1: Write failing migration shape tests**

Assert explicit `_v2` functions/grants, version-1 backfill, per-document placement identity, review actor derivation, progress normalization, `prepare_delivery`, post-prepare export, and delivery seal without document update.

```ts
expect(sql).toMatch(/mcp_prepare_slice_delivery_v2/);
expect(sql).toMatch(/contract_version[^;]+default 1/si);
expect(sql).toMatch(/created_by is distinct from v_actor[\s\S]+independent_actor/i);
```

- [ ] **Step 2: Run migration RED**

Run: `npx jest --runInBand tests/unit/database/deterministic-slice-runs-migration.test.ts`

Expected: FAIL on missing V2 columns/functions and trust/order assertions.

- [ ] **Step 3: Write failing real-database lifecycle tests**

Cover three-folder bundle creation, same bare spec/plan name, second-Slice roadmap bind, all-or-nothing conflict, each non-GDD preflight, GDD inventory requirement, plan checkbox-only progress, same-actor review rejection, stale roadmap/state conflicts, manual policy block, and fourth repair rejection after replay/resume.

```ts
const fourth = await fx.editor.client.rpc('mcp_checkpoint_slice_v2', repairArgs(freshToken, 4));
expect(fourth.error?.message).toContain('SLICE_REPAIR_LIMIT');
```

- [ ] **Step 4: Run database RED when local Supabase is available**

Run: `RUN_RLS_DB_TESTS=1 npx jest --runInBand tests/unit/database/deterministic-slice-runs.behavior.test.ts`

Expected: FAIL because V2 functions are absent. If local Supabase/auth is unavailable, record the exact connection error and continue with deterministic SQL tests.

- [ ] **Step 5: Implement additive SQL**

Validate project ownership, direct-child `spec`/`plan` folders, binding disposition preconditions, canonical names/paths, source-profile hash, plan/eval reciprocity, actor/context-derived review level, exact event order, repair ceiling, checkbox-only plan progress, optimistic roadmap completion, and mirror/seal freshness in transactions. Leave all V1 functions and legacy columns intact.

```sql
create or replace function public.mcp_prepare_slice_delivery_v2(
  p_project_id uuid, p_run_id uuid, p_expected_state_token uuid,
  p_roadmap_progress jsonb, p_idempotency_key text, p_input_hash text
) returns jsonb language plpgsql security definer set search_path = '';
```

- [ ] **Step 6: Run GREEN**

Run: `npx jest --runInBand tests/unit/database/deterministic-slice-runs-migration.test.ts`

Run when available: `RUN_RLS_DB_TESTS=1 npx jest --runInBand tests/unit/database/deterministic-slice-runs.behavior.test.ts`

Expected: deterministic suite PASS; database suite PASS or a recorded environment-only skip/failure.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260903120000_slice_v2_contract_convergence.sql tests/unit/database/deterministic-slice-runs-migration.test.ts tests/unit/database/deterministic-slice-runs.behavior.test.ts
git commit -m "feat(db): add Slice contract version 2 lifecycle"
```

### Task 3: MCP V2 Schemas, Dispatch, Progress, And Legacy Routing

**Files:**
- Modify: `supabase/functions/mcp/database.ts`
- Modify: `supabase/functions/mcp/slice-contracts.ts`
- Modify: `supabase/functions/mcp/slice-contracts.test.ts`
- Modify: `supabase/functions/mcp/slice-tools.ts`
- Modify: `supabase/functions/mcp/slice-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`

**Interfaces:**
- Consumes: Task 1 validation and Task 2 RPC names.
- Produces: stable public tool schemas with `contractVersion: 2`, `SourceProfile`, three `documentBindings`, `documentProgress`, `prepare_delivery`, verified review output, and stored-version dispatch for resume/read/export/finalize.

- [ ] **Step 1: Write failing Zod/handler tests**

Test all canonical cases through tool invocation, assert public tool names remain stable, V2 calls only `_v2` RPCs, absent-version create is rejected after cutover, legacy stored runs call V1 checkpoint/export/finalize, and V1 output has `legacyLayout: true` without V2 guarantees.

```ts
expect(rpcCalls.at(-1)?.name).toBe('mcp_create_slice_bundle_v2');
expect(legacyRead.structuredContent).toMatchObject({ contractVersion: 1, legacyLayout: true });
```

- [ ] **Step 2: Run RED**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-contracts.test.ts supabase/functions/mcp/slice-tools.test.ts supabase/functions/mcp/server.test.ts`

Expected: FAIL on V2 schemas, `_v2` dispatch, `prepare_delivery`, and legacy metadata.

- [ ] **Step 3: Implement minimal schema and handler changes**

Export reusable schemas from `slice-v2-contract.ts`; encode Markdown only for `create`/`update`; bind all content hashes and revisions; validate plan/eval in both directions; derive effective review claims from trusted request context; reject `KECO_EVAL` for V2; dispatch continuations from stored `contractVersion`; add `prepare_delivery` to server write allowlists.

```ts
const rpcName = run.contractVersion === 2
  ? 'mcp_checkpoint_slice_v2'
  : 'mcp_checkpoint_slice';
```

- [ ] **Step 4: Run GREEN**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-contracts.test.ts supabase/functions/mcp/slice-tools.test.ts supabase/functions/mcp/server.test.ts`

Expected: PASS with V1 and V2 dispatch cases.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/database.ts supabase/functions/mcp/slice-contracts.ts supabase/functions/mcp/slice-contracts.test.ts supabase/functions/mcp/slice-tools.ts supabase/functions/mcp/slice-tools.test.ts supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts
git commit -m "feat(mcp): dispatch stable Slice tools by contract version"
```

### Task 4: Python Validators And Cross-Layer Differential Tests

**Files:**
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/contract-manifest.json`
- Create: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/contract-manifest.json`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_contract_case.py`
- Create: `plugins/keco-claude/scripts/validate_contract_case.py`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/slice_contract.py`
- Modify: `plugins/keco-claude/scripts/slice_contract.py`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_plan.py`
- Modify: `plugins/keco-claude/scripts/validate_plan.py`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_eval_report.py`
- Modify: `plugins/keco-claude/scripts/validate_eval_report.py`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_slice_decomposition.py`
- Modify: `plugins/keco-claude/scripts/validate_slice_decomposition.py`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/evaluate_runtime_observations.py`
- Modify: `plugins/keco-claude/scripts/evaluate_runtime_observations.py`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: canonical manifest/corpus and TS decision shape from Task 1.
- Produces: Python `validate_contract_case(boundary, input) -> {accepted, reasonCode}`, complete V2 plan/Eval validation, generic SourceProfile validation, explicit `--legacy` runtime adapter, and substantive two-or-more Slice validation.

- [ ] **Step 1: Extend Jest/Python RED cases**

Execute the canonical corpus through both Deno and Python, asserting the exact same decision. Add decomposition fixtures for one Slice, missing either RED or GREEN, ID mismatch, generic tasks, and semantically similar siblings with reported IDs/sections.

```ts
expect(JSON.parse(probe.stdout)).toEqual(testCase.expected);
```

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL on missing Python contract runner and the existing hard-coded/incomplete decomposition behavior.

- [ ] **Step 3: Implement Python parity**

Load manifest constants, reject unsafe paths and missing/extra fields, enforce file ownership and bidirectional Eval mappings, condition GDD coverage by SourceProfile, require at least two substantive Slice pairs, compare normalized section token sets using a deterministic similarity threshold, and keep `KECO_EVAL` parsing behind explicit `--legacy` only.

```python
def validate_contract_case(boundary: str, value: object) -> dict[str, object]:
    try:
        VALIDATORS[boundary](value)
        return {"accepted": True, "reasonCode": None}
    except ContractError as error:
        return {"accepted": False, "reasonCode": error.reason_code}
```

- [ ] **Step 4: Run GREEN and parity scan**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Run: `rg -n 'test8-24|game-gdd' plugins/keco-{codex,claude}/skills/keco-develop-godot-slice-v2 tests/fixtures/plugins/keco-*slice* supabase/functions/mcp --glob '!**/__pycache__/**'`

Expected: tests PASS; scan returns only explicit negative regression assertions or no reusable-contract hits.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/contract-manifest.json plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/contract-manifest.json plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts plugins/keco-claude/scripts tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "feat(slice): converge offline contract validation"
```

### Task 5: Document Progress And Delivery Preparation

**Files:**
- Modify: `supabase/functions/mcp/slice-tools.ts`
- Modify: `supabase/functions/mcp/slice-tools.test.ts`
- Modify: `supabase/migrations/20260903120000_slice_v2_contract_convergence.sql`
- Modify: `tests/unit/database/deterministic-slice-runs-migration.test.ts`
- Modify: `tests/unit/database/deterministic-slice-runs.behavior.test.ts`

**Interfaces:**
- Consumes: accepted TaskResult/TaskReview state and V2 document identities.
- Produces: `checkpoint_slice.documentProgress` with checkbox-only updates and `prepare_delivery` as the final roadmap checkbox mutation before export.

- [ ] **Step 1: Add failing progress/order tests**

Test unchecked-body normalization, dependency-gated checkbox transitions, immutable non-checkbox bytes, concurrent roadmap revision conflicts, export-before-prepare rejection, post-prepare document mutation rejection, and the exact sequence `implementation_complete -> prepare_delivery -> export`.

- [ ] **Step 2: Run RED**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-tools.test.ts && npx jest --runInBand tests/unit/database/deterministic-slice-runs-migration.test.ts`

Expected: FAIL on missing progress/preparation contract.

- [ ] **Step 3: Implement progress and preparation gates**

Compare accepted normalized plan bytes, permit only eligible `- [ ]` to `- [x]`, bind revisions and hashes, update roadmap once with optimistic concurrency in `prepare_delivery`, and make export read-only and delivery seal mutation-free.

- [ ] **Step 4: Run GREEN**

Run: `deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-tools.test.ts && npx jest --runInBand tests/unit/database/deterministic-slice-runs-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/slice-tools.ts supabase/functions/mcp/slice-tools.test.ts supabase/migrations/20260903120000_slice_v2_contract_convergence.sql tests/unit/database/deterministic-slice-runs-migration.test.ts tests/unit/database/deterministic-slice-runs.behavior.test.ts
git commit -m "feat(slice): gate progress and delivery preparation"
```

### Task 6: Crash-Safe Mirror Materialization

**Files:**
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/materialize_slice_mirrors.py`
- Modify: `plugins/keco-claude/scripts/materialize_slice_mirrors.py`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: post-`prepare_delivery` V2 export with exactly roadmap/spec/plan and verified hashes.
- Produces: journaled all-or-restore materialization and `MirrorVerification` only after complete read-back; exit result includes `partial` and journal path only when restoration itself cannot complete.

- [ ] **Step 1: Add failing fault-injection tests**

Use temporary repository roots and injected failures before staging, after journal fsync, after first replacement, and during read-back. Assert original hashes are restored, partial batches emit no verification, symlinked parents are rejected, and a later invocation recovers the journal before validating a new manifest.

```ts
expect(readFileSync(firstTarget)).toBe(originalFirst);
expect(existsSync(verificationPath)).toBe(false);
```

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL because current per-file atomic writes can leave a partial batch and have no recovery journal.

- [ ] **Step 3: Implement preflight, staging, journal, restore, and recovery**

Preflight every entry and target first; stage and fsync bytes on the target filesystem; persist a bounded journal with target/prior/staged/backup identities; rename with retained backups; read back the whole batch; emit verification and clean up only after success. On handled failure restore and verify all prior states; on startup recover any existing journal before accepting the supplied manifest.

- [ ] **Step 4: Run GREEN**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: PASS for success, rollback, crash-resume, containment, and partial-output cases.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/materialize_slice_mirrors.py plugins/keco-claude/scripts/materialize_slice_mirrors.py tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "feat(slice): make mirror batches crash recoverable"
```

### Task 7: Codex And Claude Skill Contract Convergence

**Files:**
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/source-data-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/source-data-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/eval-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/eval-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/godot-mcp-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/godot-mcp-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/godot-animation-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/godot-animation-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/godot-tileset-contract.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/godot-tileset-contract.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/review-workflow.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/review-workflow.md`
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/default-delivery-policy.json`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/default-delivery-policy.json`
- Modify: user-owned decomposition reference files already listed in `git status --short`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: all executable V2 interfaces from Tasks 1-6.
- Produces: concise main Skill containing routing, SourceProfile selection, four phases, stop conditions, conditional references, and completion commands; platform differences are limited to script-root/call syntax.

- [ ] **Step 1: Record documentation RED assertions**

Test main-file size/section budget, conditional GDD and asset loading, V2 lifecycle sequence, no hard-coded identity, no new-run `KECO_EVAL`, no independent self-review claim, exactly three canonical mirrors, and normalized Codex/Claude parity.

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL on stale event name, delivery order, duplicated schema prose, and remaining runtime prefixes.

- [ ] **Step 3: Rewrite the main Skills and conditional references**

Keep main files as routers; move enforceable detail to the manifest and focused references. Replace all V2 examples with `KECO_OBSERVATION`, describe explicit legacy adapter, effective review levels, SourceProfile selection, V2 document bindings, preparation/export/seal order, and recovery journal handling. Preserve the useful substantive-decomposition additions without their hard-coded source assumption.

- [ ] **Step 4: Run GREEN and source scans**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Run: `rg -n 'KECO_EVAL|test8-24|game-gdd|independent TaskReview' plugins/keco-{codex,claude}/skills/keco-develop-godot-slice-v2 --glob '!**/__pycache__/**'`

Expected: tests PASS; any `KECO_EVAL` hit is explicitly labeled legacy-only and no hard-coded identity/false independence remains.

- [ ] **Step 5: Commit**

```bash
git add plugins/keco-codex/skills/keco-develop-godot-slice-v2 plugins/keco-claude/skills/keco-develop-godot-slice-v2 plugins/keco-claude/scripts tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "docs(slice): converge version 2 skill behavior"
```

### Task 8: Real Skill Pressure Evaluation Harness And Evidence

**Files:**
- Create: `scripts/evaluate-keco-slice-v2-skill.mjs`
- Replace: `tests/fixtures/plugins/keco-godot-skill-v2-evals.json`
- Create: `tests/fixtures/plugins/keco-godot-skill-v2-eval-rubric.json`
- Create: `tests/fixtures/plugins/keco-godot-skill-v2-eval-results/.gitkeep`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: converged Skill and corpus.
- Produces: CLI harness that runs at least five fresh contexts per wording variant plus no-new-guidance control, stores raw output/runtime/model/scoring, and reports per-scenario variance without treating fixture counts as success.

- [ ] **Step 1: Add failing harness contract tests**

Assert evaluation definitions contain the 12 required scenario classes, explicit behavioral rubric assertions, fresh-context count, control prompt, raw-output path, model/runtime identity, and manual-review state. Assert a static array length alone cannot return `passed`.

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL because the existing file is a static keyword fixture without execution evidence.

- [ ] **Step 3: Implement the evaluator**

Support `--provider codex|claude`, `--samples 5`, `--output`, and `--dry-run`; start a fresh process/context per sample, retain raw response and exit metadata, score only evidence-backed rubric checks, and require manual disposition for every flagged sample.

```js
if (samples < 5) throw new Error('at least five fresh contexts are required');
if (flagged.some((sample) => sample.manualReview !== 'reviewed')) process.exitCode = 1;
```

- [ ] **Step 4: Run GREEN and real evaluations when providers are available**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Run: `node scripts/evaluate-keco-slice-v2-skill.mjs --provider codex --samples 5 --output tests/fixtures/plugins/keco-godot-skill-v2-eval-results/codex.json`

Run: `node scripts/evaluate-keco-slice-v2-skill.mjs --provider claude --samples 5 --output tests/fixtures/plugins/keco-godot-skill-v2-eval-results/claude.json`

Expected: Jest PASS; provider runs produce reviewed raw evidence. If authentication/model access is unavailable, retain dry-run validation and record the exact external dependency error without claiming AC 13 passed.

- [ ] **Step 5: Commit**

```bash
git add scripts/evaluate-keco-slice-v2-skill.mjs tests/fixtures/plugins/keco-godot-skill-v2-evals.json tests/fixtures/plugins/keco-godot-skill-v2-eval-rubric.json tests/fixtures/plugins/keco-godot-skill-v2-eval-results tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "test(slice): add real skill pressure evaluations"
```

### Task 9: Release Metadata, Installed Parity, And Full Verification

**Files:**
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `plugins/keco-claude/.claude-plugin/plugin.json`
- Modify: marketplace/version metadata discovered by the repository release script
- Modify: `plugins/keco-claude/README.md`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: completed Tasks 1-8.
- Produces: bumped release/cachebuster metadata, installed-cache reinstall parity, final test evidence, commit range, AC matrix, and residual-risk record.

- [ ] **Step 1: Add failing repository/installed digest checks**

Hash the released Slice V2 Skill tree deterministically, compare Codex/Claude normalized content, and compare repository Codex files with the installed plugin tree selected by plugin version/cachebuster.

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Expected: FAIL because release metadata and installed cache still point at the previous content.

- [ ] **Step 3: Bump metadata and run the repository-supported reinstall/cachebuster flow**

Use the existing plugin release script discovered from repository documentation. Do not hand-edit installed cache files; the source manifest and marketplace entry remain authoritative.

- [ ] **Step 4: Run focused and global verification**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts`

Run: `deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/slice-contracts.test.ts supabase/functions/mcp/slice-v2-contract.test.ts supabase/functions/mcp/slice-tools.test.ts supabase/functions/mcp/server.test.ts`

Run: `npx jest --runInBand tests/unit/database/deterministic-slice-runs-migration.test.ts`

Run when available: `RUN_RLS_DB_TESTS=1 npx jest --runInBand tests/unit/database/deterministic-slice-runs.behavior.test.ts`

Run: `npm run typecheck:api`

Run: `npm run check:mcp`

Run: `git diff --check HEAD^..HEAD`

Expected: all environment-independent suites PASS; external-environment failures are itemized with exact command and error.

- [ ] **Step 5: Review all 14 acceptance criteria and commit release metadata**

For each AC, record concrete file/test/command evidence. Review changed files for scope, legacy compatibility, contract naming, document mutation order, and user-owned diff preservation.

```bash
git add plugins/keco-codex/.codex-plugin/plugin.json plugins/keco-claude/.claude-plugin/plugin.json plugins/keco-claude/README.md tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "chore(plugin): release Slice V2 contract convergence"
```

### Task 10: Final Audit And Handoff

**Files:**
- Modify only the plan checkbox states in this file after each task's GREEN verification and commit.

**Interfaces:**
- Consumes: all prior task commits and verification logs.
- Produces: exact implementation commit list/range, AC 1-14 evidence matrix, command pass/fail totals, environment-blocked items, legacy compatibility statement, final status, and residual risks.

- [ ] **Step 1: Verify commit and worktree boundaries**

Run: `git log --oneline 3be56da4..HEAD`

Run: `git status --short`

Run: `git diff 3be56da4..HEAD --name-only | rg '^(tmp/|docs/superpowers/specs/2026-09-03-keco-godot-slice-v2-contract-convergence-design.md)$'`

Expected: only task commits are listed; `tmp/` and the authoritative spec are absent from implementation diffs; unrelated user changes remain present and uncommitted unless explicitly integrated by a named task.

- [ ] **Step 2: Re-run the final focused matrix**

Run all Task 9 commands once more against the final HEAD and count suites/tests/skips/failures from actual output.

- [ ] **Step 3: Apply verification-before-completion review**

Confirm no completion claim relies on stale output, skipped database/provider checks are named, no pending required task remains, and every AC cites fresh evidence.

- [ ] **Step 4: Deliver the requested report**

Report commit range/list, numbered AC matrix, commands and counts, unrun items with environment reasons, legacy behavior, exact `git status --short`, and known residual risks.
