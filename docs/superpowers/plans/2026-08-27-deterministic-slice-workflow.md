# Deterministic Keco Slice Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Keco Slice evidence, status, document synchronization, and repeated execution deterministic, then expose the lifecycle through four reliable MCP operations.

**Architecture:** Godot emits observations without pass claims. Shared contract code evaluates locked assertions and derives status, while an actor-bound server ledger persists accepted facts with compare-and-swap tokens and idempotency. The existing Claude and Codex Slice Skill uses high-level MCP lifecycle tools and mechanically verifies canonical Keco mirrors.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Deno TypeScript MCP tools, Python 3 standard-library plugin validators, Jest and Deno tests, Codex/Claude plugin manifests and Skills.

## Global Constraints

- Keep the existing `keco-develop-godot-slice-v2` Skill name and invocation; do not create a V3 Skill.
- Preserve GDD as an optional source alongside user instructions, Keco documents, feedback, tables, and existing Slice artifacts.
- Do not use TDD for this implementation. Implement each bounded component, then add and run its automated tests before committing.
- Never accept `status`, `passed`, or `expected` as authoritative fields from Godot runtime output.
- Keep legacy Slice records read-only compatible; insufficient evidence maps to `unknown` or `manual_required`, never an inferred pass.
- Keep objective Slice verification separate from the 50-point Art Style plus 50-point Player Fun milestone evaluation and from human review.
- Require actor-bound authorization, strict schemas, bounded payloads, opaque state tokens, idempotency conflicts, and fail-closed errors.
- Keep Claude and Codex copies byte-identical where the repository currently packages shared contracts or scripts in both plugins.
- Keep every tracked text file ASCII-only because CI rejects Chinese characters and plugin tests reject non-ASCII plugin text.
- Do not hand-edit installed plugin caches or marketplace metadata during development; use the supported plugin-creator cachebuster and reinstall flow after merge.

---

## File Responsibility Map

- `supabase/functions/mcp/slice-contracts.ts`: canonical JSON, runtime observation validation, typed assertion evaluation, status derivation, and execution keys used by the trusted MCP server.
- `supabase/functions/mcp/slice-tools.ts`: strict schemas and handlers for create, checkpoint, finalize, and export operations.
- `supabase/migrations/20260827090000_deterministic_slice_runs.sql`: Slice run, event, artifact, request, authorization, idempotency, CAS, hash-chain, projection, repair, and document-bundle persistence.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/slice_contract.py`: standard-library implementation of the same portable assertion and projection contract for local verification.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/evaluate_runtime_observations.py`: parse `KECO_OBSERVATION` and legacy `KECO_EVAL`, then emit computed results.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_task_evidence.py`: validate TaskResult and TaskReview binding.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/derive_slice_status.py`: generate the four status dimensions from validated facts.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/materialize_slice_mirrors.py`: atomically write, read back, and verify a canonical export manifest.
- `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_delivery_policy.py`: validate project policy or emit the built-in conservative policy digest.
- Matching `plugins/keco-claude/scripts/*` files: Claude packaging copies of the local deterministic tools.
- `plugins/keco-*/skills/keco-develop-godot-slice-v2/references/*`: current workflow contracts and built-in policy.
- `plugins/keco-codex/skills/keco-evaluate-game/scripts/progress_log.py`: idempotent evaluation event/projection writer.
- `plugins/keco-codex/skills/keco-evaluate-game/scripts/execution_cache.py`: normalized score/validation reuse keys and artifact verification.
- `tests/fixtures/plugins/keco-slice-contract-cases.json`: language-neutral assertion, status, and legacy compatibility cases used by Deno and Python tests.

### Task 1: Deterministic Evidence And Status Contracts

**Files:**
- Create: `supabase/functions/mcp/slice-contracts.ts`
- Create: `supabase/functions/mcp/slice-contracts.test.ts`
- Create: `tests/fixtures/plugins/keco-slice-contract-cases.json`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/slice_contract.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/evaluate_runtime_observations.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/derive_slice_status.py`
- Create: `plugins/keco-claude/scripts/slice_contract.py`
- Create: `plugins/keco-claude/scripts/evaluate_runtime_observations.py`
- Create: `plugins/keco-claude/scripts/derive_slice_status.py`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`

**Interfaces:**
- Consumes: EvalSpec JSON, `KECO_OBSERVATION` lines, legacy `KECO_EVAL` lines, TaskResult/TaskReview summaries, manual requirements, and delivery policy gates.
- Produces: `canonicalJson(value): string`, `sha256Canonical(value): Promise<string>`, `parseRuntimeObservation(value): RuntimeObservation`, `evaluateObservation(spec, observation): EvaluationResult`, and `deriveSliceStatus(input): DerivedSliceStatus` in TypeScript.
- Produces: equivalent `canonical_json`, `sha256_canonical`, `parse_observation`, `evaluate_observation`, and `derive_slice_status` Python functions and two CLIs.

- [ ] **Step 1: Implement the trusted TypeScript contract**

Create strict types and functions with these public shapes:

```ts
export type Assertion =
  | { assertionId: string; kind: "equals"; path: string; expected: unknown }
  | { assertionId: string; kind: "range"; path: string; minimum?: number; maximum?: number; minimumInclusive: boolean; maximumInclusive: boolean }
  | { assertionId: string; kind: "subset"; path: string; expected: unknown[] | Record<string, unknown> }
  | { assertionId: string; kind: "roundtrip"; beforePath: string; afterPath: string; markerPaths: string[] };

export type RuntimeObservation = {
  schemaVersion: 1;
  runId: string;
  sliceId: string;
  evalId: string;
  buildHash: `sha256:${string}`;
  snapshotHash: `sha256:${string}`;
  actual: Record<string, unknown>;
  errors: string[];
};

export function evaluateObservation(
  spec: EvaluationSpec,
  observation: RuntimeObservation,
): EvaluationResult;

export function deriveSliceStatus(input: StatusInputs): {
  implementationStatus: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  runtimeVerificationStatus: "not_run" | "passed" | "partial" | "failed" | "blocked";
  acceptanceStatus: "pending" | "passed" | "partial" | "failed" | "manual_required";
  releaseReadiness: "not_ready" | "ready" | "blocked_by_verification" | "blocked_by_manual_review" | "blocked_by_policy" | "failed";
};
```

Use RFC 6901 JSON Pointer. Reject unknown observation keys, missing paths,
non-finite range operands, unsupported assertion kinds, non-empty runtime
errors, wrong identity, stale build/snapshot hashes, and duplicate eval IDs.
Ignore a legacy record's self-reported status and expected fields.

- [ ] **Step 2: Implement the standard-library Python contract and CLIs**

`evaluate_runtime_observations.py` accepts:

```bash
python3 evaluate_runtime_observations.py \
  --eval-spec eval-spec.json \
  --debug-output debug-output.txt \
  --output assertion-results.json
```

It extracts bounded `KECO_OBSERVATION` and legacy `KECO_EVAL` lines, computes
results, and exits nonzero when the evidence contract is invalid. It must never
copy a runtime-provided pass into output. `derive_slice_status.py` accepts
validated task, evaluation, manual, mirror, and policy JSON and writes only
computed status dimensions.

- [ ] **Step 3: Add shared cross-language contract fixtures**

Include positive and negative cases for:

```json
{
  "cases": [
    { "id": "equals-pass", "expectedStatus": "passed" },
    { "id": "range-missing-field", "expectedStatus": "failed", "reasonCode": "ACTUAL_PATH_MISSING" },
    { "id": "subset-array-order-independent", "expectedStatus": "passed" },
    { "id": "roundtrip-missing-marker", "expectedStatus": "failed", "reasonCode": "ROUNDTRIP_MARKER_MISSING" },
    { "id": "runtime-self-pass-mismatch", "legacy": true, "expectedStatus": "failed" },
    { "id": "stale-build", "expectedStatus": "failed", "reasonCode": "BUILD_HASH_MISMATCH" }
  ]
}
```

Both Deno and Jest/Python tests must consume the same fixture and assert equal
statuses and reason codes.

- [ ] **Step 4: Add status and legacy compatibility tests**

Test implementation complete with manual acceptance, objective failure,
policy-blocked release, all-passed release, and legacy insufficient evidence.
Extend the Claude packaging test to require byte-identical Python files.

- [ ] **Step 5: Run focused verification**

Run:

```bash
deno test --config supabase/functions/mcp/deno.json supabase/functions/mcp/slice-contracts.test.ts
npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
```

Expected: all focused tests pass and neither implementation accepts a
self-reported runtime pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/slice-contracts.ts \
  supabase/functions/mcp/slice-contracts.test.ts \
  tests/fixtures/plugins/keco-slice-contract-cases.json \
  tests/unit/plugins/keco-godot-slice-v2.test.ts \
  tests/unit/plugins/keco-claude-plugin.test.ts \
  plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts \
  plugins/keco-claude/scripts
git commit -m "feat(keco): compute slice evidence and status"
```

### Task 2: Durable Slice Ledger And Atomic Database Operations

**Files:**
- Create: `supabase/migrations/20260827090000_deterministic_slice_runs.sql`
- Create: `tests/unit/database/deterministic-slice-runs-migration.test.ts`
- Create: `tests/unit/database/deterministic-slice-runs.behavior.test.ts`

**Interfaces:**
- Consumes: authenticated project actor, normalized input digests, encoded document snapshots, expected state tokens, typed event batches, and canonical projections.
- Produces: `mcp_create_slice_bundle`, `mcp_read_slice_run`, `mcp_checkpoint_slice`, `mcp_finalize_slice`, and `mcp_export_slice_mirrors` RPCs with bounded JSON results.

- [ ] **Step 1: Add project-owned ledger tables and RLS**

Create:

```sql
public.keco_slice_runs(
  id uuid primary key,
  project_id uuid not null,
  folder_id uuid not null,
  slice_id text not null,
  plan_hash text not null,
  eval_spec jsonb not null,
  eval_spec_hash text not null,
  delivery_policy jsonb not null,
  delivery_policy_hash text not null,
  current_sequence bigint not null default 0,
  state_token uuid not null,
  repair_count integer not null default 0 check (repair_count between 0 and 3),
  projection jsonb not null,
  document_ids jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, slice_id, id)
);

public.keco_slice_run_events(
  run_id uuid not null references public.keco_slice_runs(id),
  sequence bigint not null,
  event_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  input_hash text not null,
  output_hash text not null,
  previous_event_hash text,
  event_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key(run_id, sequence),
  unique(run_id, event_id)
);
```

Add the artifact and request replay tables from the design. Enable RLS; visible
project members may read, current writers may call RPCs, and direct event
updates/deletes are denied. Add strict payload, hash, and event type checks.

- [ ] **Step 2: Implement actor-bound request replay and state tokens**

Add private helpers that lock by `(actor, operation, idempotency_key)`, compare
normalized input hashes, replay exact results, and raise stable SQLSTATE-backed
conflicts for different input. State tokens are generated by the server and
replaced after each successful mutation.

- [ ] **Step 3: Implement atomic bundle creation**

`mcp_create_slice_bundle` must:

```sql
-- one transaction supplied by the RPC invocation
perform public.mcp_require_writer(p_project_id);
-- validate folder, run identity, document snapshots, policy, and request key
-- insert or verify roadmap, then insert spec/plan/status collaborative docs
-- insert the run and initial hash-chained event
-- store the replayable bounded result and return it
```

It receives Markdown plus server-encoded Yjs snapshots from the Edge handler so
all documents and run state commit or roll back together.

- [ ] **Step 4: Implement checkpoint, finalize, and export RPCs**

`mcp_checkpoint_slice` locks the run, checks state token, validates event order,
rejects a fourth repair, inserts the complete batch and artifacts, persists the
trusted projection, updates affected collaborative documents, and advances the
token atomically.

`mcp_finalize_slice` accepts only computed projection and canonical encoded
documents from the trusted Edge handler. It rejects inconsistent projection,
missing current MirrorVerification, failed policy gates, or a stale token. It
may persist completed implementation with manual acceptance but cannot set
release readiness to ready.

`mcp_export_slice_mirrors` returns canonical document bytes, repository paths,
document revisions, canonicalization version, byte counts, and SHA-256 digests.

- [ ] **Step 5: Add migration and behavior coverage**

Static tests assert table constraints, RLS policies, grants, SECURITY DEFINER
search paths, append-only protection, function signatures, and stable conflicts.
DB-backed behavior tests cover owner/admin/editor/viewer access, rollback after
the second document fails, exact replay, different-input conflict, stale token,
hash-chain sequence, concurrent append, fourth repair rejection, manual finalize,
fully passed finalize, and bounded export.

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm run test:unit -- --runInBand \
  tests/unit/database/deterministic-slice-runs-migration.test.ts \
  tests/unit/database/deterministic-slice-runs.behavior.test.ts
```

Expected: static tests pass; DB behavior tests pass when local Supabase is
available and report an explicit skip otherwise.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260827090000_deterministic_slice_runs.sql \
  tests/unit/database/deterministic-slice-runs-migration.test.ts \
  tests/unit/database/deterministic-slice-runs.behavior.test.ts
git commit -m "feat(mcp): add deterministic slice ledger"
```

### Task 3: High-Level MCP Slice Lifecycle Tools

**Files:**
- Create: `supabase/functions/mcp/slice-tools.ts`
- Create: `supabase/functions/mcp/slice-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/errors.ts`

**Interfaces:**
- Consumes: Task 1 contract functions and Task 2 RPCs.
- Produces: `registerSliceTools(server, context, options?)` and MCP tools `create_slice_bundle`, `checkpoint_slice`, `finalize_slice`, and `export_slice_mirrors`.

- [ ] **Step 1: Implement strict public schemas**

Use account/project registration shapes matching existing GDS and map tools.
All input objects are `.strict()`. Enforce UUIDs, lower-case Slice IDs, SHA-256
formats, maximum event counts, maximum artifact/log sizes, safe relative mirror
paths, and closed enums. Mark export read-only/idempotent; mark lifecycle writes
non-destructive and idempotent.

- [ ] **Step 2: Implement create and export handlers**

Create encodes every Markdown document with `encodeDocumentMarkdown`, computes
canonical hashes, and makes one `mcp_create_slice_bundle` RPC. Export calls the
read RPC and returns only bounded canonical content and metadata. Reindex
created/updated document IDs after the primary transaction succeeds.

- [ ] **Step 3: Implement checkpoint and finalize handlers**

Checkpoint parses observations, loads the immutable EvalSpec through
`mcp_read_slice_run`, calls `evaluateObservation`, derives status, and passes
client plus server-generated events to one atomic checkpoint RPC. It rejects
client AssertionResult or aggregate status authority.

Finalize reloads current facts, calls `deriveSliceStatus`, verifies the supplied
mirror artifact references, renders canonical status/EvalReport/roadmap
projections, encodes document states, and makes one finalize RPC.

- [ ] **Step 4: Map stable public errors and telemetry**

Add public codes for idempotency conflict, Slice state conflict, contract
failure, repair limit, mirror mismatch, and finalization blocked. Never leak SQL,
document content, bearer tokens, or raw command output. Register create,
checkpoint, and finalize as write telemetry; export as read telemetry.

- [ ] **Step 5: Add MCP tests**

Test exact tool registration in account/project modes, schema rejection,
writer authorization, encoded document snapshots, one primary RPC per
operation, replay output, stale-token recovery, observation recomputation,
fourth repair, partial/manual finalization, mirror export bounds, safe errors,
and operation classes.

- [ ] **Step 6: Run focused verification**

```bash
deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net \
  supabase/functions/mcp/slice-contracts.test.ts \
  supabase/functions/mcp/slice-tools.test.ts \
  supabase/functions/mcp/account-tools.test.ts \
  supabase/functions/mcp/server.test.ts
npm run check:mcp
```

Expected: all tests and Deno type checking pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/mcp/slice-tools.ts \
  supabase/functions/mcp/slice-tools.test.ts \
  supabase/functions/mcp/server.ts \
  supabase/functions/mcp/account-tools.test.ts \
  supabase/functions/mcp/server.test.ts \
  supabase/functions/mcp/errors.ts
git commit -m "feat(mcp): expose slice lifecycle tools"
```

### Task 4: Plugin Workflow, Task Evidence, Mirrors, And Delivery Policy

**Files:**
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_task_evidence.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/materialize_slice_mirrors.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_delivery_policy.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/default-delivery-policy.json`
- Create matching files under `plugins/keco-claude/scripts/` and `plugins/keco-claude/skills/keco-develop-godot-slice-v2/references/`
- Modify: both `keco-develop-godot-slice-v2/SKILL.md` files
- Modify: both copies of `references/orchestration-contract.md`
- Modify: both copies of `references/eval-contract.md`
- Modify: both copies of `references/godot-mcp-contract.md`
- Modify: both copies of `references/slice-document-contract.md`
- Modify: both copies of `references/review-workflow.md`
- Modify: both copies of `scripts/validate_eval_report.py`
- Modify: both copies of `scripts/validate_slice_documents.py`
- Modify: both copies of `scripts/validate_run_context.py`
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`
- Modify: `tests/fixtures/plugins/keco-godot-skill-v2-evals.json`

**Interfaces:**
- Consumes: the four MCP lifecycle operations, TaskResult/TaskReview JSON, canonical export manifests, optional project `delivery-policy.json`, and current/legacy Slice artifacts.
- Produces: validated current artifacts, verified local mirrors, compact four-phase user progress, and legacy read adapters.

- [ ] **Step 1: Implement TaskResult and TaskReview validation**

Validate exact run/task/plan binding, phase, command/MCP identity, exit code,
timeouts, output summaries and SHA-256 digests, changed file before/after hashes,
RED/GREEN expected versus observed outcome, reviewer verdict, and reviewed byte
digests. Reject secrets, oversized summaries, missing reviews, unsupported keys,
and review of different bytes.

- [ ] **Step 2: Implement delivery policy validation**

Ship a conservative schema-versioned default with:

```json
{
  "schemaVersion": 1,
  "requiredArtifacts": ["TaskResult", "TaskReview", "EvalReport", "MirrorVerification"],
  "runtimeEvidenceFreshness": "current_build_and_snapshot",
  "maximumRepairs": 3,
  "releaseOrder": ["implementation", "runtime_verification", "acceptance", "mirrors", "package"],
  "manualReviewBlocksRelease": true
}
```

Allow a project policy only when its schema is recognized and at least as
strict as mandatory workflow safety gates. Record the chosen canonical digest.
Do not parse or compile `AGENTS.md`.

- [ ] **Step 3: Implement mirror materialization**

Accept only the `export_slice_mirrors` manifest. Resolve every path beneath an
explicit repository root, require it in allowedFiles, reject symlinks and parent
traversal, write through same-directory temporary files and atomic replace,
read bytes back, verify size/SHA-256, and emit a MirrorVerification JSON artifact
bound to the manifest digest. A mismatch exits nonzero and leaves no false
verification artifact.

- [ ] **Step 4: Update current validators and legacy adapters**

Current EvalReport validation recomputes status from assertion results and
rejects any report whose aggregate status disagrees. Slice document validation
requires all four derived status dimensions and current mirror provenance.
RunContext accepts current schema additions while retaining version 2 input
compatibility. Legacy EvalReports ignore self-reported passes unless semantic
evidence is sufficient.

- [ ] **Step 5: Rewrite the Skill around four outer phases**

Use `create_slice_bundle` during preflight, `checkpoint_slice` at durable task
and verification boundaries, `export_slice_mirrors` plus local verification
before delivery, and `finalize_slice` as the final gate. Keep allowed files,
write lease, fresh `run_project -> get_debug_output -> stop_project`, maximum
three repairs, TaskReview independence, and `manual_required` behavior.

The Godot contract must specify `KECO_OBSERVATION` and forbid runtime-owned
expected/status fields. GDD remains a valid optional source.

- [ ] **Step 6: Add plugin contract and pressure tests**

Cover fake runtime pass, missing assertion fields, implementation complete with
manual acceptance, stale mirror, stale state token, repeated checkpoint, fourth
repair, policy ordering, legacy evidence, and concise four-phase presentation.
Require Claude/Codex byte parity for shared scripts and contracts.

- [ ] **Step 7: Run focused verification**

```bash
npm run test:unit -- --runInBand \
  tests/unit/plugins/keco-godot-slice-v2.test.ts \
  tests/unit/plugins/keco-claude-plugin.test.ts
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-develop-godot-slice-v2
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  plugins/keco-codex
```

Expected: plugin contracts, Skill validation, and plugin validation pass.

- [ ] **Step 8: Commit**

```bash
git add plugins/keco-codex plugins/keco-claude \
  tests/unit/plugins/keco-godot-slice-v2.test.ts \
  tests/unit/plugins/keco-claude-plugin.test.ts \
  tests/fixtures/plugins/keco-godot-skill-v2-evals.json
git commit -m "feat(keco): enforce deterministic slice delivery"
```

### Task 5: Idempotent Game Evaluation And Contract Consistency

**Files:**
- Create: `plugins/keco-codex/skills/keco-evaluate-game/scripts/execution_cache.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/progress_log.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/references/report-contract.md`
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Consumes: profile, evidence, reviewer raw input, evaluator version, schema versions, build hash, snapshot hash, and policy digest.
- Produces: deterministic execution keys, `created` or `reused` CLI outcomes, one JSONL fact per unique execution, and a generated Markdown projection.

- [ ] **Step 1: Implement normalized execution reuse**

Build execution keys from canonical input hashes and evaluator/contract versions.
Before profile, score, or validate work, inspect prior JSONL events and the
current output digest. Return `reused` without appending or rewriting when both
match. Reusing a key with changed input fails. Any changed dependency computes a
new result and records a new event.

- [ ] **Step 2: Make progress Markdown a projection**

Keep JSONL append-only as the single local fact ledger. Regenerate `progress.md`
from parsed unique JSONL events after a new event. Do not independently append
the same fact to both files. Include operation key, input hash, output hash,
outcome, and actual parsed result in each event.

- [ ] **Step 3: Lock the 50+50 contract everywhere**

Change the default prompt to `Art Style 50 + Player Fun 50`, remove obsolete
`80+20` and removed review field references, and add a test scanning manifests,
Skill, rubric, profile, scorer, and validator for one consistent contract.

- [ ] **Step 4: Add idempotency and invalidation tests**

Run profile, score, and validate twice with unchanged inputs and assert one event
per operation plus `reused` outcomes. Then mutate evidence, reviewer input,
build hash, evaluator version fixture, and policy digest independently and assert
recomputation. Preserve independent Claude and human scores.

- [ ] **Step 5: Run focused verification**

```bash
npm run test:unit -- --runInBand \
  tests/unit/plugins/keco-game-evaluation.test.ts \
  tests/unit/plugins/keco-plugin.test.ts
```

Expected: repeated inputs reuse exact artifacts, changed dependencies invalidate,
and all contract surfaces use 50+50.

- [ ] **Step 6: Commit**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game \
  plugins/keco-codex/.codex-plugin/plugin.json \
  tests/unit/plugins/keco-game-evaluation.test.ts \
  tests/unit/plugins/keco-plugin.test.ts
git commit -m "fix(keco): reuse unchanged game evaluations"
```

### Task 6: Integration, Review, Pull Request, Merge, And Reinstall

**Files:**
- Modify if validation requires it: files already owned by Tasks 1-5
- Update: `docs/superpowers/plans/2026-08-27-deterministic-slice-workflow.md` checkbox states

**Interfaces:**
- Consumes: all prior commits and repository CI configuration.
- Produces: reviewed feature branch, green pull request, green merged main, and verified installed plugin.

- [ ] **Step 1: Run focused integrated contracts**

```bash
npm run check:mcp
npm run test:mcp
npm run test:unit -- --runInBand \
  tests/unit/database/deterministic-slice-runs-migration.test.ts \
  tests/unit/database/deterministic-slice-runs.behavior.test.ts \
  tests/unit/plugins/keco-plugin.test.ts \
  tests/unit/plugins/keco-claude-plugin.test.ts \
  tests/unit/plugins/keco-godot-slice-v2.test.ts \
  tests/unit/plugins/keco-game-evaluation.test.ts
```

Expected: all focused checks pass.

- [ ] **Step 2: Run complete local validation**

```bash
npm run validate
git diff --check origin/main...HEAD
git status --short
```

Expected: lint, TypeScript, API types, Deno check/tests, Jest, build, whitespace,
and worktree cleanliness all pass.

- [ ] **Step 3: Perform completion review**

Review the full `origin/main...HEAD` diff against every design acceptance
criterion. Check SQL authorization, transaction rollback, SECURITY DEFINER
search paths, idempotency binding, strict schemas, error redaction, contract
parity, legacy behavior, and tests. Fix every P0/P1 finding and rerun affected
checks before continuing.

- [ ] **Step 4: Push and open the pull request**

```bash
git push -u origin feat/deterministic-slice-workflow
gh pr create --base main --head feat/deterministic-slice-workflow \
  --title "feat: make Keco Slice delivery deterministic" \
  --body-file /tmp/keco-deterministic-slice-pr.md
```

The PR body summarizes trust boundaries, migrations, compatibility, tests, and
reinstall timing. It states that runtime pass is computed and that existing
Skill invocation remains unchanged.

- [ ] **Step 5: Wait for and repair PR checks**

```bash
gh pr checks --watch --interval 30
```

Inspect failing job logs, fix root causes, rerun local affected checks, commit,
push, and wait again. Do not merge with a pending, skipped-required, cancelled,
or failed required check.

- [ ] **Step 6: Merge and verify main checks**

```bash
gh pr merge --squash --delete-branch
gh run list --branch main --limit 5
gh run watch <main-run-id> --interval 30 --exit-status
```

Merge only after PR checks are green. Then wait for the merge commit's main CI
run and require every check to pass.

- [ ] **Step 7: Update local main and reinstall Codex plugin**

From the primary checkout after merge:

```bash
git pull --ff-only origin main
codex plugin marketplace list
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py \
  --marketplace-path /home/hetu/project/keco-studio/.agents/plugins/marketplace.json
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  plugins/keco-codex
codex plugin add keco@keco-studio
codex plugin list
```

The configured marketplace must resolve to
`/home/hetu/project/keco-studio/.agents/plugins/marketplace.json`; do not add or
rewrite it. After installation, restore the source manifest's pre-cachebuster
version with `apply_patch` so merged `main` remains clean. Verify the installed
manifest, Skill, reference, and script SHA-256 values against the cachebusted
source content and verify every non-manifest plugin file against merged `main`.

- [ ] **Step 8: Refresh Claude plugin where supported**

Inspect the installed Claude plugin marketplace command and refresh
`keco@keco-studio` from merged main. Verify its shared Skill, reference, and
script hashes match the repository. If the CLI is unavailable in this
environment, record that exact limitation without claiming refresh success.

- [ ] **Step 9: Final report**

Report the merge commit and PR URL, PR and main CI status, key verification
counts, installed Codex version/cachebuster and hashes, Claude refresh status,
and any non-blocking residual manual requirement. Do not claim completion until
all required checks and the Codex reinstall verification pass.
