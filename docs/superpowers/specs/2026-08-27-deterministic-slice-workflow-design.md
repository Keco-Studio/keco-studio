# Deterministic Keco Slice Workflow Design

**Date:** 2026-08-27

**Status:** Approved for the internal execution/evidence architecture

> User-facing Slice planning follows the newer paired-document convention:
> `docs/superpowers/specs/<slice-id>-design.md` and
> `docs/superpowers/plans/<slice-id>.md`. Any `status`, `EvalReport`, or mirror
> paths described below are machine-generated internal evidence, not additional
> planning documents that users must create or edit.

**Scope:** Keco MCP Slice lifecycle operations, the existing
`keco-develop-godot-slice-v2` Claude and Codex Skills, deterministic runtime
evidence, Slice status derivation, mirror verification, evaluation reuse, and
delivery policy enforcement.

## Summary

The current Slice workflow records strong provenance but still trusts several
agent-authored conclusions. In particular, a project can emit a `KECO_EVAL`
record whose `status` says `passed` even when `expected` and `actual` do not
prove the acceptance condition. Task completion, runtime verification,
acceptance, and release readiness are also collapsed into overlapping status
fields, while Keco documents and local mirrors can drift.

This project moves those decisions into deterministic programs. Godot reports
observations only. A locked EvalSpec owns expectations. An assertion evaluator
computes results. A server-side append-only run ledger owns durable execution
facts, and projections derive status documents, evaluation reports, roadmap
summaries, and progress views. High-level MCP tools make Slice document changes
idempotent, conflict-aware, bounded, and resumable.

The existing Skill name remains unchanged. There is no new V3 Skill. Each
structured artifact has its own `schemaVersion`, and new readers retain
read-only compatibility with existing Slice records. GDDs remain a supported
optional design source. The implementation is not required to follow TDD, but
all new behavior requires automated tests and complete delivery verification.

## Goals

- Make every objective runtime pass a computed result rather than an
  agent-authored or game-authored claim.
- Give implementation, runtime verification, acceptance, and release readiness
  separate, unambiguous meanings.
- Persist TaskResult and TaskReview evidence strongly enough to audit commands,
  changed files, output digests, RED/GREEN outcomes, and review verdicts.
- Make Keco the authoritative durable record while producing mechanically
  verified repository mirrors.
- Prevent duplicate scoring, validation, document creation, event append, and
  package rebuild work when all relevant inputs are unchanged.
- Provide bounded high-level MCP operations for Slice creation, checkpointing,
  finalization, and mirror export.
- Preserve current security, write lease, allowed-files, three-repair,
  independent-review, and `manual_required` protections.
- Present four concise outer phases: preflight, implementation, verification,
  and delivery. Keep detailed internal evidence available for audit.
- Keep Claude and Codex plugin copies behaviorally identical.

## Non-Goals

- Creating a new `keco-develop-godot-slice-v3` Skill.
- Rewriting historical Slice records or manufacturing pass results for evidence
  that cannot prove them.
- Removing GDD generation, GDD evaluation, or GDD input support.
- Treating a screenshot, clean launch, parse success, or agent narrative as
  objective runtime proof.
- Turning arbitrary `AGENTS.md` prose into executable policy with an LLM.
- Building a general event-sourcing platform for unrelated Keco workflows.
- Allowing a single opaque MCP operation to perform unbounded game development.

## Considered Approaches

### Plugin-only validation

Strengthening only the Python validators would be the smallest change, but the
server would still lack atomic checkpoints, authoritative idempotency, and
concurrent-write protection across the Slice document bundle. It would leave
the reliability boundary on the client and is rejected.

### Typed Slice lifecycle with deterministic projections

The selected approach adds a focused server-side Slice run model and four
bounded MCP operations. The plugin retains responsibility for repository and
Godot work, while the server owns durable facts, idempotency, state tokens, and
derived Keco projections. This closes the observed trust gaps without
restructuring unrelated workflows.

### General event-sourcing platform

A generic platform could eventually support every Keco workflow, but it would
expand schema, migration, UI, and operational risk beyond this problem. It is
rejected for this project.

## Trust And Ownership Boundaries

```text
User instruction / Keco document / feedback / table / optional GDD
                              |
                              v
                  approved SlicePlan + EvalSpec
                              |
               trusted expectations and policy
                              |
Godot process -- observations only --> deterministic assertion evaluator
                              |
                              v
                 immutable Slice run events
                              |
                              v
                   deterministic projections
            status / EvalReport / roadmap / progress
                              |
                              v
                 canonical mirror export bundle
                              |
                              v
              local materialization + hash check
```

The ownership rules are:

- User instructions and accepted Keco design sources own intent.
- SlicePlan owns approved scope, tasks, dependencies, allowed files, and the
  RED/GREEN command contract.
- EvalSpec owns expected values, assertion types, evidence requirements, and
  manual requirements.
- Godot owns runtime behavior and emits actual observations only.
- The assertion evaluator owns AssertionResult.
- TaskResult owns execution facts. TaskReview owns the independent review
  verdict and findings.
- The run ledger owns immutable accepted facts and their order.
- The projection engine owns all aggregate statuses and generated views.
- Keco owns the authoritative document bundle. Repository files are verified
  mirrors and never become an independent writer of authoritative state.

No component may accept a pass or release-ready boolean from a component that
does not own that decision.

## Artifact Contracts

Every new structured artifact uses an explicit `schemaVersion`. Schema versions
are scoped to the artifact, not to the Skill.

### RuntimeObservation

Godot prints one bounded line per evaluation using a new `KECO_OBSERVATION`
prefix:

```json
{
  "schemaVersion": 1,
  "runId": "run-123",
  "sliceId": "slice-008",
  "evalId": "eval-804",
  "buildHash": "sha256:...",
  "snapshotHash": "sha256:...",
  "actual": {
    "guardianRoundtrip": true,
    "catType": "sickly"
  },
  "errors": []
}
```

The observation contract forbids `status`, `passed`, and `expected`. A runtime
record cannot judge itself. The parser rejects malformed JSON, unknown top-level
fields, missing identity or hash fields, duplicate `(runId, evalId)` records,
non-array errors, and output outside the configured size limit.

Existing `KECO_EVAL` records remain readable as legacy evidence. Their
game-authored status is ignored. A legacy record can produce a computed result
only when the locked EvalSpec, actual payload, build hash, and snapshot hash are
complete enough for the current evaluator. Otherwise it maps to `unknown` or
`manual_required`, never an inferred pass.

### EvalSpec And Assertions

Each objective evaluation contains stable identity, expected build and snapshot
bindings, preconditions, actions, evidence requirements, and one or more typed
assertions. The first assertion set is:

- `equals`: the value at `path` must deeply equal `expected`.
- `range`: a finite numeric value at `path` must respect inclusive or exclusive
  `minimum` and `maximum` bounds declared by the assertion.
- `subset`: the object or array at `path` must contain the expected members using
  deterministic deep equality; array order is ignored and duplicates are not.
- `roundtrip`: the values at explicit `beforePath` and `afterPath` must deeply
  equal, and every required transition marker must be present.

Paths use JSON Pointer, not dotted-string parsing. Missing paths, invalid types,
unsupported assertions, non-finite numbers, unexpected runtime errors, stale
hashes, and ambiguous records fail closed.

The evaluator returns one AssertionResult per assertion with `assertionId`,
`status`, bounded expected and actual values, and a stable reason code. It then
derives the evaluation status. A result is `passed` only when every required
assertion passes and identity, build, snapshot, and error gates pass.

### TaskResult

TaskResult records:

- run, Slice, task, plan revision, and attempt identity;
- command or MCP sequence identity;
- phase (`red`, `green`, `implementation`, or `verification`);
- start/end timestamps, exit code, and timeout/cancellation state;
- bounded stdout/stderr summaries and SHA-256 digests of the complete captured
  outputs;
- changed files with before and after SHA-256 digests;
- the observed RED/GREEN outcome relative to the approved command contract;
- concerns and referenced artifact IDs.

Secrets and credentials must be redacted before persistence. The ledger stores
digests and bounded summaries, not unlimited terminal output.

### TaskReview

TaskReview binds to the exact plan revision, TaskResult IDs, and changed-file
digests reviewed. It records reviewer type, independent verdict, specification
findings, quality findings, and required follow-up. A review cannot approve
different bytes from those in the TaskResult.

### Derived Slice Status

The projection engine owns four status dimensions:

- `implementationStatus`: `pending`, `in_progress`, `completed`, `failed`, or
  `blocked`. Completion requires every approved task to have an accepted
  TaskResult and required TaskReview for the current plan revision.
- `runtimeVerificationStatus`: `not_run`, `passed`, `partial`, `failed`, or
  `blocked`. It is computed from assertion results and runtime batch integrity.
- `acceptanceStatus`: `pending`, `passed`, `partial`, `failed`, or
  `manual_required`. It combines objective evaluations and declared manual
  acceptance items without converting manual work into an automated pass.
- `releaseReadiness`: `not_ready`, `ready`,
  `blocked_by_verification`, `blocked_by_manual_review`,
  `blocked_by_policy`, or `failed`. It is computed from the other dimensions and
  the locked delivery policy.

The roadmap displays implementation and acceptance separately. It never uses a
single completed checkbox as a release assertion.

## Durable Run Ledger

Add focused project-owned tables:

- `keco_slice_runs`: run identity, project/folder/Slice identity, active plan and
  policy hashes, current sequence, state token, repair count, projected status,
  document IDs, and timestamps.
- `keco_slice_run_events`: append-only sequence, event ID, idempotency key,
  event type, normalized payload, input hash, output hash, previous event hash,
  event hash, actor, and timestamp.
- `keco_slice_run_artifacts`: typed artifact identity, schema version, content
  digest, bounded payload or document reference, and source event.
- `keco_slice_run_requests`: actor-bound operation/idempotency key, normalized
  input hash, operation, result status, and replayable bounded result.

Rows are project-scoped and protected by RLS. MCP mutations also use atomic RPCs
with current project authorization checks. The event table rejects updates and
deletes through normal application roles. Every append locks the run row,
checks the expected state token, allocates the next sequence, verifies the hash
chain, inserts the event, recomputes the projection, and advances the token in
one transaction.

The state token is a server-issued opaque value bound to run ID, event sequence,
plan hash, and current projection hash. Clients echo it but do not construct it.

An operation replay with the same actor, operation, idempotency key, and input
hash returns the original result with `outcome: reused`. Reusing a key with a
different normalized input returns `IDEMPOTENCY_CONFLICT`. An expired state
token returns `SLICE_STATE_CONFLICT` with the latest bounded state and recovery
instruction; it never overwrites concurrent work.

## MCP Tool Contract

All tools support account-scoped and project-bound MCP connections using the
existing registration pattern. Write tools require current project writer
access. Inputs are strict and bounded by the existing MCP request limit.

### create_slice_bundle

Creates or reuses one run and its initial authoritative document bundle in one
transaction. Input contains project context, folder ID, stable run and Slice
IDs, an idempotency key, source references, optional existing roadmap identity,
approved spec/plan/EvalSpec payloads, and the locked delivery policy.

The operation validates folder ownership, source identities, document names,
schema versions, plan/evaluation references, allowed files, and policy before
writing. It creates the roadmap only when the caller explicitly requests a new
one; otherwise it verifies the supplied roadmap document. It creates the Slice
spec, plan, and status documents and records their IDs and canonical digests.
The EvalReport is created only during finalization.

The response contains `created` or `reused`, run identity, state token, document
identities, revisions, content digests, projected status, and next allowed
actions.

### checkpoint_slice

Appends one or more bounded typed events against an expected state token. A
batch is atomic and has one operation idempotency key; each event also has a
stable event ID. Client event types cover plan acceptance, write lease,
TaskResult, TaskReview, RuntimeObservation, mirror verification, repair
transition, manual review, and delivery checks. RuntimeObservation acceptance
causes the server to append the corresponding AssertionResult event in the same
transaction.

The server validates event ordering and cross-references, computes assertion
results for observation events, enforces allowed files and the three-repair
limit, updates affected Keco projections, and returns the next token. A client
cannot submit a derived aggregate status or AssertionResult as an authority;
such values are recomputed or rejected.

### finalize_slice

Finalization is an atomic gate, not a force-complete flag. It accepts only run
identity, expected state token, idempotency key, requested terminal intent, and
current mirror verification references. The server recomputes projections from
accepted events and the locked policy.

When implementation is complete but manual review remains, finalization may
close implementation and produce an EvalReport with partial/manual acceptance,
but release readiness remains `blocked_by_manual_review`. A fully passed result
requires accepted TaskReviews, computed assertion passes, current hashes, mirror
verification, and every policy gate. Finalization creates or updates the
EvalReport, status, and roadmap projection atomically and returns their canonical
digests. Failed gates return `blocked` with stable reason codes and do not write
a false completion.

### export_slice_mirrors

This read-only operation returns a canonical export manifest and bounded file
contents for the roadmap and Slice spec, plan, status, and EvalReport when
present. Every entry includes a repository-relative path, document ID,
revision/state token, canonicalization version, byte count, and SHA-256 digest.

The server cannot inspect the user's filesystem and therefore does not claim to
verify a local mirror. The plugin's `materialize_and_verify_mirrors` helper:

1. validates every path against the declared mirror root and `allowedFiles`;
2. writes each file atomically;
3. reads each file back as bytes;
4. verifies size and SHA-256 against the export manifest; and
5. checkpoints a MirrorVerification artifact bound to the manifest digest.

Finalization rejects a missing or stale verification artifact.

## Projection And Progress Model

Spec, Plan, EvalSpec, and delivery policy are approved inputs, not projections.
The append-only ledger contains execution facts. The following outputs are
generated from those two sources:

- Keco status document;
- Keco EvalReport;
- roadmap implementation and acceptance summaries;
- local `status.json` and `eval-report.json` mirrors;
- `progress.jsonl` event export;
- `progress.md` human-readable projection;
- dashboard data and delivery manifest.

Generated projections contain their generator version, last event sequence,
input digest, and output digest. They are replaced from canonical generation,
never manually appended independently. This removes the present dual write to
`progress.jsonl` and `progress.md`.

## Idempotent Evaluation And Delivery

Pure scoring and validation steps use a normalized execution key containing:

- operation and evaluator version;
- schema and contract versions;
- locked profile or EvalSpec digest;
- build/source digest;
- snapshot digest;
- normalized evidence digest;
- reviewer raw-input digest when applicable; and
- delivery policy digest.

An exact match returns `reused` and references the original artifact. Any
changed dependency invalidates reuse. Runtime evidence reuse is separately
controlled by delivery policy and defaults to requiring evidence from the
current build and snapshot.

Package and mirror generation use an explicit dependency graph. A package is
built only after its dependencies are final for the current token. A later
source or layout change invalidates the package artifact and forces one rebuild;
the workflow cannot package first, repair layout, and retain the stale package.

## Delivery Policy

The repository may provide a schema-validated `delivery-policy.json`. It defines
required directory entries, artifact types, evaluation contract versions,
runtime freshness, review gates, package dependencies, and release ordering.
Unknown schema versions or unknown required gates fail closed.

`AGENTS.md` may explain project conventions and point to the policy, but free
text is not compiled into machine policy. When no explicit policy exists, the
plugin uses a versioned built-in conservative policy and records its digest.

## Four-Phase User Experience

The Skill presents only these outer phases:

1. **Preflight:** resolve source, project, bundle, policy, plan, and write lease.
2. **Implementation:** execute approved tasks and reviews within allowed files.
3. **Verification:** collect observations, compute assertions, repair at most
   three times, and retain manual requirements.
4. **Delivery:** verify mirrors, build current deliverables, finalize, and report
   implementation, acceptance, and readiness separately.

Internal events remain queryable but are not narrated as twenty user-facing
stages.

## Failure And Recovery

- Missing actual values, identity, hashes, or errors fail objective evaluation.
- Unsupported assertions fail closed with a stable contract error.
- Duplicate observations for one evaluation are rejected unless a new attempt
  explicitly supersedes the prior attempt.
- A stale document revision, run state token, policy digest, plan digest, source
  revision, build hash, or snapshot hash blocks the consuming operation.
- A Keco/local mirror mismatch blocks finalization.
- Manual visual or experience checks remain `manual_required`; implementation
  may complete, but release readiness remains blocked.
- The server rejects a fourth repair transition. A revised plan starts a new
  bounded repair cycle only when the policy explicitly permits it and preserves
  the prior audit history.
- Partial MCP failures return accepted event sequence, current token, document
  identities, and the exact safe resume action. Retrying the same operation key
  cannot duplicate work.
- Legacy records with insufficient semantic evidence expose `unknown` or
  `manual_required`, never a synthetic pass.

## Security And Bounds

- All server operations use current actor-bound project authorization and RLS.
- Idempotency keys are actor- and operation-bound.
- State tokens and document revisions provide compare-and-swap protection.
- Tool schemas are strict and reject unknown fields.
- Document, event batch, artifact, log summary, and export sizes have explicit
  limits below the MCP request and response limits.
- Persisted command output is redacted and bounded; complete outputs are
  represented by digests and approved local artifact references.
- Mirror paths must be repository-relative, normalized, inside the configured
  root, and present in `allowedFiles`.
- High-level tools do not edit Godot files or invoke arbitrary commands. They
  coordinate only Keco lifecycle state.

## Compatibility And Migration

The existing `keco-develop-godot-slice-v2` Skill and invocation behavior remain.
New runs write the new per-artifact schema versions. Current validators gain
read-only adapters for existing RunContext, status, EvalReport, and `KECO_EVAL`
records.

Historical files and Keco documents are not rewritten automatically. A legacy
run remains inspectable. If it is resumed for mutation, the workflow creates an
explicit migration checkpoint that references the old artifacts, locks current
source/build hashes, and starts a new ledger-backed run without altering the
old evidence.

Claude and Codex plugins receive equivalent contracts, scripts, prompts, and
tests. The default evaluation prompt is updated from the obsolete `80+20`
wording to the current `artStyle 50 + playerFun 50` contract. Removed review
fields are rejected rather than silently carried forward.

## Verification Strategy

Automated coverage must include:

- `equals`, `range`, `subset`, and `roundtrip` assertion behavior;
- missing paths, wrong types, unsupported assertions, duplicate observations,
  runtime errors, stale build hashes, and stale snapshot hashes;
- all four derived status dimensions and manual-review blocking;
- TaskResult/TaskReview identity, digest, RED/GREEN, and changed-file checks;
- idempotent create/checkpoint/finalize replay and different-input conflicts;
- state-token concurrency conflicts, event sequence/hash-chain integrity,
  crash recovery, and the three-repair limit;
- database RLS, writer authorization, transaction rollback, and append-only
  enforcement;
- MCP schemas, account/project registration, telemetry classification, bounded
  results, and safe errors;
- canonical export, path safety, byte-for-byte read-back, and mirror mismatch;
- legacy record read compatibility without inferred passes;
- evaluation input reuse and invalidation on every declared dependency;
- package invalidation when an upstream file changes;
- Codex/Claude parity and evaluation prompt consistency;
- plugin, Skill, Python, Deno, TypeScript, migration, unit, and build checks.

The branch must pass focused checks and `npm run validate`, then pass every
required GitHub pull-request check. After merge, the main-branch checks must
also complete successfully. Only then may the Codex plugin use the supported
cachebuster and marketplace reinstall flow. Installed manifest and Skill hashes
must match merged `main`; Claude plugin refresh is also performed where its
local tooling is available.

## Delivery Sequence

1. Add deterministic assertion, artifact, projection, and policy helpers with
   focused tests.
2. Add the ledger schema, atomic RPCs, RLS, append-only enforcement, and database
   behavior tests.
3. Register and test the four MCP Slice lifecycle tools.
4. Update shared Claude/Codex Skill contracts, scripts, legacy adapters, mirror
   materialization, idempotent evaluation, and prompt consistency.
5. Run focused and complete local validation.
6. Review the full diff for contract, security, and compatibility defects.
7. Push the feature branch, open a pull request, resolve review and CI failures,
   and merge only when every required check is green.
8. Verify the merge commit checks on `main`, apply the supported cachebuster,
   reinstall the plugin from the repository marketplace, and verify installed
   hashes against merged source.

## Acceptance Criteria

- A mismatched or incomplete expected/actual pair cannot produce a pass.
- Godot observations cannot provide authoritative expected values or status.
- A completed implementation can coexist with partial/manual acceptance without
  presenting the Slice or release as fully accepted.
- Every completed task has validated TaskResult and required TaskReview evidence.
- Replaying unchanged create, checkpoint, evaluation, validation, mirror, and
  packaging inputs does not duplicate work.
- Keco document revisions and local mirror bytes are mechanically linked by
  canonical SHA-256 digests.
- Concurrent or stale writers receive conflicts and recovery state rather than
  overwriting newer work.
- The three-repair limit is enforced by server state.
- Existing Slice records remain readable and are never upgraded to a pass
  without sufficient current semantic evidence.
- The current 50+50 evaluation contract is consistent across plugin prompts,
  Skills, scripts, schemas, and tests.
- Pull-request and post-merge checks are green before the merged plugin is
  reinstalled and verified.
