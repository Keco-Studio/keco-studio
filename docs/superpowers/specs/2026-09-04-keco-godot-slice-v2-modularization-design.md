# Keco Godot Slice V2 Modularization And V1 Removal

**Date:** 2026-09-04

**Status:** Ready for implementation by a separate agent

**Owner:** Codex reviews the implementation and accepts or rejects the result.

## Goal

Remove the obsolete Godot Slice V1 workflow and split the Godot Slice V2 workflow
into focused phase modules without losing any existing V2 capability.

The public entry remains `keco-develop-godot-slice-v2`. The implementation agent
must preserve the complete V2 lifecycle from source selection through delivery.

## Scope

In scope:

- Codex and Claude Godot Slice skills and their references.
- Codex bundled validators and Claude shared validators.
- V2 contract/schema ownership and cross-validator compatibility.
- V1 routing, V1 skill files, V1-only adapters, tests, and documentation.
- MCP/SQL references required to stop routing new work through V1.
- Plugin manifests, README files, fixtures, parity tests, and CI checks.

Out of scope:

- Godot gameplay implementation.
- PixelLab generation API redesign.
- Godot MCP capability redesign.
- `keco-evaluate-game`'s separate EDD evaluation workflow.
- Rewriting historical Supabase migrations.
- Relocating unrelated user changes, including `tmp/`.
- Creating a V3 skill.

## Decisions

1. V1 is fully retired. New runs cannot select or route to V1.
2. V1 historical run records do not need to be readable.
3. The public V2 skill name is unchanged.
4. The V2 entry becomes a thin orchestrator; detailed phase guidance moves to modules.
5. Existing V2 behavior is the compatibility target. Refactoring must not weaken a gate to make a test pass.
6. Artifact schema versions must be explicit and consistent. The current `SlicePlan`/ `validate_task_evidence.py` mismatch is a required fix.
7. A shared contract manifest and conformance corpus are authoritative for cross-language decisions. Codex and Claude may have host-specific wrappers, but not divergent semantic rules.

## Target Architecture

Keep the user-facing entry:

```text
keco-develop-godot-slice-v2
```

Add these phase modules:

```text
keco-godot-slice-preflight
keco-godot-slice-assets
keco-godot-slice-implementation
keco-godot-slice-verification
keco-godot-slice-delivery
```

The entry skill owns routing, phase transitions, RunContext, blocker/resume behavior,
successor runs, and user-facing progress. It must not duplicate the full artifact
schemas.

### Preflight module

Owns SourceProfile selection, source hashes and rationale, Keco planning-root and
direct-child folder discovery, roadmap/spec/plan bindings and read-back, GDD
Requirement Inventory and reciprocal mappings, non-GDD rationale, multi-Slice
decomposition, SlicePlan/EvalSpec validation, repository/Godot identity, dirty paths,
write-lease gates, and fresh Keco snapshot export/validation.

Primary scripts:

```text
validate_run_context.py
validate_contract_case.py
validate_plan.py
validate_gdd_coverage.py
validate_slice_decomposition.py
export_keco_snapshot.py
validate_snapshot.py
```

### Assets module

Owns the PixelLab capability registry and live transport resolution, asset provenance,
provider IDs, file hashes, target paths, typed package validation, resource evolution
(reuse, compatible extension, additive migration, isolated creation), Keco upload and
read-back, character/animation outputs, SpriteFrames, tileset/TileMap assets, and all
frame/tile/PNG geometry validation.

Primary scripts:

```text
validate_generated_asset_package.py
build_spriteframes_resource.py
```

Primary references:

```text
generated-asset-contract.md
existing-resource-evolution.md
godot-animation-contract.md
godot-tileset-contract.md
keco-pixellab-contract.md
pixellab-capability-registry.md
```

### Implementation module

Owns dependency-ordered tasks, RED/GREEN commands, immutable `allowedFiles`, TaskResult,
TaskReview, effective review levels, interaction checkpoints, pause/resume,
task-transition state, partial evidence, and checkpoint persistence.

Primary scripts:

```text
validate_task_evidence.py
validate_interaction_checkpoint.py
```

### Verification module

Owns `run_project -> get_debug_output -> stop_project`, `KECO_OBSERVATION`, locked
EvalSpec assertions, current build/snapshot hash binding, runtime batches, EvalReport,
three-repair ceiling, manual-required acceptance, and separate implementation/runtime/
acceptance/release statuses.

Primary scripts:

```text
evaluate_runtime_observations.py
validate_eval_report.py
derive_slice_status.py
```

### Delivery module

Owns delivery policy, ordered release gates, final roadmap preparation, mirror export,
crash-safe staging, durable journal recovery, exact prior-byte restoration, complete
read-back, MirrorVerification, and the final delivery seal.

Primary scripts:

```text
validate_delivery_policy.py
materialize_slice_mirrors.py
```

Snapshot scripts may be shared by Preflight and Delivery, but only one semantic
implementation may remain.

## Contract Requirements

- `contractVersion: 2` remains the V2 lifecycle identifier.
- Every artifact has one documented `schemaVersion`, and every consumer accepts that version.
- `SlicePlan`, `EvalSpec`, `TaskResult`, `TaskReview`, `EvalReport`, `MirrorManifest`, and `MirrorVerification` form one compatible chain.
- `planRevision` is required and is a valid canonical SHA-256 digest.
- Plan/evaluation mappings are bidirectional.
- Runtime pass/fail is computed from observations and EvalSpec, never from agent self-report.
- A `manual_required` evaluation cannot produce release readiness.
- `KECO_EVAL` is not accepted as V2 runtime evidence.
- The canonical manifest owns enumerations, limits, reason codes, release order, runtime prefixes, and mirror paths.
- A conformance corpus runs through MCP/TypeScript and both Python implementations with matching decisions and reason codes.

## V1 Deletion Inventory

Delete:

```text
plugins/keco-codex/skills/keco-develop-godot-slice/
plugins/keco-claude/skills/keco-develop-godot-slice/
```

Remove from active code:

- V1 `agents/openai.yaml` and default prompts.
- V1-only asset/data/eval/Godot policy/recovery/slice-plan/source-priority references.
- V1 skill tests and V1-only fixtures.
- `validate_slice_documents.py` if no non-V1 consumer remains.
- V2 `KECO_EVAL --legacy` parsing and the V1 runtime adapter.
- Legacy runtime prefix entries and legacy mirror branches used only by V1.
- V1/V2 A/B matrix content that assumes V1 remains operational.
- README and active routing text that advertises V1.

Do not delete or rewrite historical migrations. Do not remove `KECO_EVAL` logic belonging
to `keco-evaluate-game`; it is outside this task.

## Capability Preservation Matrix

Before editing, create a machine-readable matrix mapping every existing V2 file and
behavior to exactly one target module. Each row must contain:

```text
source path
source responsibility
target module/path
kept/changed/deleted decision
existing test coverage
new acceptance test
```

No V2 script, reference, or behavior may be deleted without a matrix row and reason.
The matrix is itself an acceptance artifact.

## Required Test Coverage

Add or update tests for:

- All five SourceProfile kinds.
- GDD and non-GDD plan/evaluation paths.
- Planning-root and direct-child folder placement.
- Same-named Slice documents in distinct folders.
- Multi-Slice substantive decomposition and duplicate rejection.
- Snapshot export/validation and source hash binding.
- Typed asset package, animation, SpriteFrames, tileset, and resource evolution.
- RED/GREEN task evidence and V2 schema compatibility.
- Review-level and interaction-checkpoint behavior.
- Pause/resume and successor runs.
- `KECO_OBSERVATION` evaluation and runtime batch coverage.
- Repair ceiling and manual-required release blocking.
- Delivery policy, mirror materialization, journal recovery, and read-back.
- Codex/Claude conformance parity.
- Absence of active V1 routing after deletion.

Minimum end-to-end fixture:

```text
SourceProfile
-> SlicePlan
-> EvalSpec
-> TaskResult
-> TaskReview
-> KECO_OBSERVATION
-> EvalReport
-> MirrorManifest
-> MirrorVerification
-> finalized delivery
```

## Acceptance Criteria

1. Both V1 skill directories are gone.
2. No active skill, prompt, manifest, or test routes new work to V1.
3. The V2 entry remains discoverable as `keco-develop-godot-slice-v2`.
4. The V2 entry is a thin orchestrator and phase responsibilities are explicit.
5. The capability matrix accounts for every V2 script and reference.
6. All listed V2 capabilities remain reachable through the new modules.
7. Codex and Claude behavior matches for the canonical conformance corpus.
8. V2 SlicePlan can be consumed by TaskResult/TaskReview validation.
9. V2 runtime observations can produce a valid EvalReport.
10. Manual-required evidence cannot produce `ready` release status.
11. Mirror materialization and recovery preserve exact repository state.
12. The complete end-to-end fixture passes.
13. Focused plugin tests remain green after removing V1-specific cases.
14. API/typecheck/MCP tests pass when their existing environment is available.
15. `git diff --check` passes and unrelated dirty paths are unchanged.

## Required Final Evidence

The implementation agent must report:

- Capability preservation matrix.
- V1 deletion inventory.
- File move/rename/delete list.
- Contract/schema version map.
- Test commands and actual results.
- End-to-end fixture output.
- Codex/Claude parity result.
- Active V1 reference scan result.
- Unavailable environment-dependent tests and exact reasons.
- Final `git status --short`.

Codex will review the diff and evidence against this spec. A green unit-test subset is
insufficient if the capability matrix, end-to-end chain, or deletion inventory is missing.
