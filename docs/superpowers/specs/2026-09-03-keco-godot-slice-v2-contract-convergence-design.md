# Keco Godot Slice V2 Contract Convergence Design

**Date:** 2026-09-03

**Status:** Approved for implementation planning

**Scope:** The `keco-develop-godot-slice-v2` Codex and Claude Skills, Slice MCP
tools, deterministic Slice SQL functions and storage, offline validators,
runtime evidence, planning-document placement and progress, mirror
materialization, conformance tests, and Skill behavior evaluations.

## Summary

Keco Godot Slice V2 has the right trust model but does not currently have one
executable contract. Its Skill requires Slice specs and plans to live in two
different Keco child folders, while `create_slice_bundle` accepts one shared
folder and inserts every document there. Because the canonical spec and plan
also have the same bare Slice name, a conforming request cannot be represented
and will collide during creation.

The same drift appears elsewhere. Generic source discovery is followed by
validators hard-coded to one project and GDD name. The offline plan validator
accepts unsafe paths and unknown evaluation IDs that the MCP layer rejects.
New runtime evidence is named `KECO_OBSERVATION` in one contract and
`KECO_EVAL` in others. Review artifacts claim independence that the server does
not prove. Multi-file mirror writes are individually atomic but can leave a
partially updated repository. Static keyword assertions and fixture counts do
not prove that an agent follows the Skill.

This design converges those layers without creating a V3 Skill. It retains the
public `keco-develop-godot-slice-v2` entry, introduces Slice contract version 2
for new runs, defines source profiles for GDD and non-GDD work, makes document
placement explicit per document, and subjects TypeScript, Python, and SQL to a
shared conformance corpus. The Skill becomes a concise router over this
enforceable core instead of a second implementation of it.

## Goals

- Make a canonical `roadmap`, `spec/<slice-id>`, and `plan/<slice-id>` bundle
  representable and transactionally enforceable by the MCP and database.
- Support GDD, feedback, table, ordinary document, and direct user-idea sources
  without project-specific names or IDs in reusable contracts.
- Require GDD coverage only for the GDD source profile while preserving strong
  source identity and rationale for every non-GDD run.
- Give offline validators, MCP schemas, and SQL security/transaction gates the
  same observable accept/reject behavior.
- Enforce allowed-file, task/evaluation, document, review, runtime, and mirror
  boundaries before a write or success claim.
- Preserve idempotent resume, state-token conflict handling, three-repair
  limits, Keco authority, and separate implementation, runtime, acceptance,
  and release status.
- Make review strength explicit and never label a same-actor review as
  independent.
- Replace keyword-only Skill tests with measured agent behavior evaluations.
- Keep Codex and Claude plugin copies behaviorally identical and ensure the
  installed plugin contains the same released files as the repository source.

## Non-Goals

- Creating a `keco-develop-godot-slice-v3` Skill.
- Changing the V1 workflow.
- Redesigning PixelLab generation, Godot MCP capabilities, or gameplay logic.
- Automatically relocating historical planning documents.
- Treating old evidence as stronger than it was when recorded.
- Building a general workflow engine for unrelated Keco operations.
- Providing cross-filesystem atomicity that the host filesystem cannot
  guarantee.

## Considered Approaches

### Patch each drift in place

The smallest approach would add per-document folders, remove hard-coded GDD
names, and fix the most visible validators independently. It would restore the
current flow quickly but retain several hand-maintained definitions with no
mechanism preventing future drift. This approach is rejected.

### Contract core with source profiles and conformance tests

The selected approach keeps one public Skill and one lifecycle while defining
a versioned contract manifest, explicit source profiles, and a shared corpus of
valid and invalid examples. TypeScript, Python, and SQL keep responsibilities
suited to their boundaries, but their observable decisions must agree. Heavy
domain references remain conditionally loaded. This fixes the current failures
without introducing cross-Skill state transfer.

### Split orchestration, GDD, assets, and evaluation into separate Skills

Separate Skills would reduce each document's size but introduce routing,
resume, and artifact-ownership ambiguity across Skill boundaries. The current
problem is contract drift, not the public entry point. This approach is
deferred.

## Normative Contract Architecture

New runs declare `contractVersion: 2`. Artifact-local `schemaVersion` fields
continue to version the shape of individual payloads.

The normative contract has three parts:

1. A machine-readable contract manifest owns bounded enumerations, limits,
   source-profile requirements, event names, review levels, status values, and
   document-placement rules.
2. A versioned conformance corpus owns observable valid and invalid examples,
   including the expected stable reason code for every invalid case.
3. A concise prose reference owns ordering, authority, and recovery rules that
   cannot be expressed as field validation.

The implementation boundaries remain deliberate:

- Zod validates MCP request and response shapes and computes deterministic
  assertion results before sending trusted values to SQL.
- SQL repeats authorization, project ownership, concurrency, idempotency,
  document-placement, event-ordering, and transaction invariants. Client-side
  success never substitutes for these checks.
- Python validates repository artifacts offline. It imports shared manifest
  constants and must match the MCP conformance results.
- The Skill explains when to invoke the flow, which phase is current, and when
  to stop. It does not restate every schema.

The contract corpus, not prose keyword presence, is the behavioral parity
gate. A contract case is passing only when every applicable TypeScript, Python,
and database boundary returns the same accept/reject class and reason code.

## Source Profiles

`SourceProfile` is a discriminated union. No reusable validator may require a
display name such as `test8-24` or `game-gdd`.

All profiles contain:

```yaml
contractVersion: 2
kind: gdd|feedback|table|document|user_idea
kecoProjectId: uuid
capturedAt: RFC-3339 timestamp
sourceHash: sha256:...
selectionEvidence: []
```

Document-backed `gdd`, `feedback`, and `document` profiles additionally contain
`documentId`, `epoch`, `revision`, and `contentHash`. A title is optional display
metadata and never identity.

A `table` profile contains `tableId`, a schema revision/hash, the selected row
IDs and row hashes, and a deterministic aggregate `contentHash`. Empty row
selection is valid only when the requested work concerns the table schema
itself.

A `user_idea` profile contains the captured request hash and a bounded verbatim
request excerpt. It does not manufacture a Keco document ID. Before planning
writes commit, the accepted idea is included as source evidence in the same
atomic Slice bundle. It exists in the ledger before any development write.

Only `kind: gdd` requires:

- a versioned Requirement Inventory;
- reciprocal requirement-to-Slice, Task, and Eval mappings;
- `coverageMode: gdd` on the plan and EvalReport;
- a `gddSource` binding to project ID, document ID, epoch, revision, content
  hash, and inventory hash.

Other profiles use `coverageMode: non_gdd` and a non-empty `nonGddRationale`.
They must not include GDD-only fields. An accepted GDD patch remains GDD
evidence and must be referenced by the selected GDD; a standalone patch does
not create a new source profile.

The current user instruction has conflict priority, but it does not silently
rewrite an authoritative GDD. When a GDD-driven request adds uncited normative
behavior, the flow records a proposal and pauses for a GDD amendment or an
accepted patch. For a non-GDD profile, the same user instruction may directly
authorize the Slice within the recorded rationale.

## Planning Hierarchy And Document Bindings

The canonical Keco layout remains:

```text
<planning-root>/
|-- roadmap
|-- spec/
|   `-- <slice-id>
`-- plan/
    `-- <slice-id>
```

`create_slice_bundle` version 2 replaces the shared `folderId` with
`planningRootId` and exactly three typed document bindings:

```yaml
documentBindings:
  - kind: roadmap
    disposition: create|bind|update
    folderId: <planning-root-id>
    name: roadmap
  - kind: spec
    disposition: create|bind|update
    folderId: <spec-folder-id>
    name: <slice-id>
  - kind: plan
    disposition: create|bind|update
    folderId: <plan-folder-id>
    name: <slice-id>
```

Every binding includes `repositoryPath`. `bind` requires `documentId`, expected
epoch/revision, and content hash but no replacement Markdown. `create` requires
Markdown and rejects an existing same-name document in the target folder.
`update` requires document identity, expected epoch/revision, prior hash, and
replacement Markdown.

The database validates in one transaction that:

- all folders belong to the selected project;
- the planning root is unambiguous;
- `spec` and `plan` are distinct exact-name direct children of the root;
- each binding uses its required folder and name;
- bound or updated documents already occupy that location;
- names are unique within a folder, not across the project;
- repository paths match the canonical mirror layout;
- create, bind, and update preconditions still hold at commit time.

The run stores the planning root and each document's ID, folder ID, epoch,
revision, content hash, and repository path. A response omitting placement
identity is invalid.

### Multi-Slice Roadmaps

Decomposition creates the complete roadmap content before the first Slice
bundle. The first Slice may create the roadmap; later Slice runs bind that same
roadmap while creating their own spec/plan pair. A later source revision may
update the roadmap with optimistic epoch/revision checks.

The substantive decomposition gate requires at least two Slices. Each Slice
must have its own objective, scope, acceptance behavior, requirement or source
mapping, concrete tasks, allowed files, and both RED and GREEN commands. Bundle
IDs must equal the IDs parsed from the spec, plan, and EvalSpec. Duplicate
detection compares normalized structure and semantic token similarity, not only
exact normalized hashes. Similarity rejection returns the compared Slice IDs
and the non-distinct sections.

### Stable Documents And Revision History

Each Slice keeps stable spec and plan document identities. A scope or acceptance
change creates a new plan revision and updates those stable documents with
optimistic concurrency; existing document-version history preserves the prior
content. The workflow does not create an unrepresentable "dated pair" with the
same canonical name.

Once a run receives its write lease, its source profile, plan revision,
EvalSpec, and allowed files are immutable. A material source, scope, acceptance,
or allowed-file change pauses that run and creates a successor run with
`supersedesRunId`, a new plan revision, and fresh document update preconditions.
Old evidence remains attached to the superseded run and cannot satisfy the new
one.

Ordinary task progress does not change the plan revision. A
`checkpoint_slice` progress update may only change task checkbox state and
progress metadata. The server normalizes all checkboxes to unchecked and
requires the remaining plan bytes to match the accepted plan body. The plan
revision hashes that normalized body, while the document content hash includes
current checkbox state. A checkbox may move from unchecked to checked only
after the matching TaskResult and required TaskReview are accepted and all
dependencies are checked.

All canonical document mutations finish before mirror export. A
`prepare_delivery` transition validates implementation, runtime, acceptance,
manual-review policy, and package readiness, then checks the current Slice in
the roadmap using its expected epoch/revision. A concurrent roadmap update
returns a conflict; the client rereads, reapplies the one permitted checkbox
transition, and retries with a new idempotency key. Mirror export then sees the
final roadmap bytes. Final delivery validates the resulting mirror and performs
no document mutation.

`status`, `EvalReport`, `TaskResult`, `TaskReview`, state tokens, and hashes are
ledger/artifact data. They are not Keco planning documents. Mirror export for a
new run contains only roadmap, spec, and plan.

### MCP And Persistence Versioning

Public MCP tool names remain stable. For a version-2 request, the MCP server
dispatches to explicit additive SQL functions such as
`mcp_create_slice_bundle_v2`, `mcp_checkpoint_slice_v2`,
`mcp_prepare_slice_delivery_v2`, `mcp_finalize_slice_v2`, and
`mcp_export_slice_mirrors_v2`. Existing functions remain available only for
legacy stored runs during the compatibility window. Using distinct SQL
functions keeps rollback and database grants unambiguous.

`keco_slice_runs` gains additive `contract_version`, `planning_root_id`,
`source_profile`, `source_profile_hash`, and `supersedes_run_id` fields. Legacy
`folder_id` remains readable. Version-2 document identity JSON stores folder ID
and content hash in addition to document ID, repository path, epoch, and
revision. The migration backfills `contract_version: 1` semantics without
guessing new planning roots or source profiles.

Review events store the effective server-derived review level and, when the
host supplies it through trusted request context, an execution-context
identity. User-controlled review payloads do not write trusted context or actor
fields. Existing append-only event and artifact ownership, RLS, request
idempotency, and project-writer checks remain in force.

## Plan And Evaluation Integrity

`SlicePlan.allowedFiles` is required, non-empty, unique, repository-relative,
and free of parent traversal or symlink aliases. Every task file must be in
`allowedFiles`, and every allowed file must be owned by at least one task.

Every task has a stable ID, dependency list, file list, RED command and expected
failure, GREEN command and expected pass, review requirement, source mapping,
and non-empty `servesEvaluations`. The contract rejects cycles, self
dependencies, unknown dependencies, and dependencies appearing after their
dependent task.

Plan and EvalSpec validation is reciprocal:

- every `servesEvaluation` names an EvalSpec evaluation;
- every evaluation, including manual acceptance, is served by at least one
  task;
- every implementation file is owned by at least one task and serves at least
  one evaluation through that task;
- GDD requirement IDs exist in the selected inventory and map in both
  directions;
- non-GDD plans and evaluations carry the selected source profile hash;
- build and snapshot hashes are locked before runtime evidence is accepted.

The Python plan validator validates the complete MCP plan shape, including
`schemaVersion`, plan revision, allowed files, task field types, path safety,
evaluation bindings, review values, and source profile. It must not report
success for a plan that the MCP schema will reject.

The write lease governs Keco, PixelLab, asset, and Godot MCP mutations. Local
repository writes cannot carry a remote token, so they are constrained by
`allowedFiles` and become durable only when a TaskResult records their exact
before/after hashes under the active run, Slice, task, and plan revision.

## Review Trust Levels

`TaskReview` remains required by the default delivery policy, but its strength
is explicit:

```text
self < separate_context < independent_actor
```

- `self` means the execution and review may share an agent context.
- `separate_context` requires distinct execution-context identities supplied by
  a trusted host boundary, not arbitrary IDs in the event payload. It proves a
  separate pass but not a different authenticated person. A host that does not
  expose trusted context identity can record only `self` or
  `independent_actor`.
- `independent_actor` requires the review event's authenticated database actor
  to differ from the actor that submitted the reviewed TaskResult. SQL verifies
  this relationship before accepting the level.

The server derives the effective level from trusted request context and stored
event actors; callers cannot submit an authoritative `independent: true`
boolean or elevate themselves with a caller-chosen context ID. Existing
reviewer type and ID fields remain audit metadata, not proof.

The default policy requires a TaskReview but does not claim actor independence.
A project policy may set a minimum review level globally or for high-risk
tasks. When the host cannot provide that level, implementation may complete but
release is `blocked_by_policy`. User urgency cannot downgrade the locked policy.

## Runtime Evidence

New contract-version-2 runs accept only:

```text
KECO_OBSERVATION { ...actual observations only... }
```

Runtime observations may contain identity, current build and snapshot hashes,
actual values, and bounded errors. They may not contain expected values,
assertion results, status, pass booleans, or aggregate conclusions. All new
Skill text, examples, animation/tileset contracts, fixtures, and generated test
scenes use this name.

`KECO_EVAL` remains readable only through an explicit legacy adapter for
historical runs. A new checkpoint rejects it. The adapter discards
self-reported expectations and status and never upgrades incomplete evidence to
a pass.

An automated assertion pass and manual acceptance are separate facts. An
evaluation with `manualRequired: true` can have `objectiveStatus: passed` while
its acceptance remains `manual_required`. Aggregate release readiness remains
blocked when the locked policy requires manual approval.

Runtime batches continue to use one bounded
`run_project -> get_debug_output -> stop_project` sequence when evaluations can
share a process. Missing observations, duplicates, stale hashes, unsupported
input automation, or runtime errors fail closed with stable reason codes.

## Checkpoints, Repair, And Finalization

`checkpoint_slice` version 2 accepts typed events, typed artifacts, and optional
document progress updates under one current state token. The database validates
event ordering and document preconditions before appending anything.

Repair count increments only for an accepted `repair_transition` event. The
count is stored on the run and cannot be reset by changing an idempotency key,
replaying an earlier state token, or starting another attempt inside the same
run. After three failed repair transitions, the run pauses and rejects another
automatic repair. A materially revised scope starts a new plan revision rather
than disguising additional repair as the old plan.

Completion and delivery perform three explicit transitions:

1. `implementation_complete` confirms accepted TaskResults and TaskReviews and
   persists the internal EvalReport projection.
2. `prepare_delivery` requires current runtime/acceptance status, manual-review
   policy, and package readiness, then performs the permitted roadmap checkbox
   update. It is the final canonical document mutation.
3. `delivery` requires a mirror export created after `prepare_delivery`, the
   matching current MirrorVerification, and unchanged canonical document
   revisions. It seals the run without changing a document.

No transition creates a Keco status or eval-report document. Each transition is
idempotent for identical inputs and conflicts on stale state or document
revisions. The version-2 release order is `implementation`,
`runtime_verification`, `acceptance`, `manual_review`, `package`,
`roadmap_completion`, `mirrors`, then `seal`; mirror verification is always
after the last canonical document mutation.

## Mirror Materialization And Recovery

Mirror export binds the run ID, state token, document identities, revisions,
repository paths, byte counts, per-file hashes, and manifest hash. The export
contains only the current canonical roadmap, spec, and plan.

The materializer uses an all-or-restore protocol:

1. Validate the complete manifest, every allowed path, repository containment,
   parent symlink state, target type, and all content hashes before changing a
   target.
2. Stage every new file on the target filesystem and verify staged bytes.
3. Write and fsync a bounded recovery journal containing target, prior hash,
   staged hash, and backup identity.
4. Replace targets one at a time using same-filesystem renames, retaining prior
   bytes until the full batch verifies.
5. Read back every target, write `MirrorVerification`, fsync relevant
   directories, and remove the journal and backups.
6. On a handled failure, restore every changed target and verify the original
   hashes. On the next invocation after a crash, recover the unfinished journal
   before processing a new manifest.

No output artifact is emitted for a partial batch. An unrecoverable restore
error returns `partial` with the journal location and affected repository paths;
it never claims atomic success. Unrelated files are not modified or removed.

## Stable Error Model

Contract failures use bounded public reason codes while retaining detailed
diagnostics in internal evidence. The initial code families are:

- `SLICE_SOURCE_PROFILE_INVALID`
- `SLICE_DOCUMENT_PLACEMENT_INVALID`
- `SLICE_DOCUMENT_CONFLICT`
- `SLICE_PLAN_SCOPE_INVALID`
- `SLICE_EVAL_BINDING_INVALID`
- `SLICE_REVIEW_LEVEL_INVALID`
- `SLICE_RUNTIME_EVIDENCE_INVALID`
- `SLICE_STATE_CONFLICT`
- `SLICE_REPAIR_LIMIT`
- `SLICE_MIRROR_INVALID`
- `SLICE_MIRROR_RECOVERY_REQUIRED`

Errors distinguish validation failure, stale conflict, unavailable capability,
policy block, and partial write. `blocked_before_write` means no development
mutation occurred; already verified planning writes are reported separately.
Any development mutation before failure makes the result `partial`.

Retry rules are operation-specific:

- validation failures require corrected inputs and a new input hash;
- state/document conflicts require fresh read-back and rebase;
- exact idempotent replays return the saved result;
- an idempotency key reused with different input returns a conflict;
- partial remote writes are read back and resumed by stable ID, never deleted
  or regenerated automatically;
- mirror recovery completes before another mirror export is materialized.

## Skill Structure

The public Skill retains four user-visible phases: Preflight, Implementation,
Verification, and Delivery. Its main file contains only:

- trigger and routing rules;
- the compact user interaction contract;
- source-profile selection;
- the four-phase flow and non-bypassable stop conditions;
- pointers to conditional GDD, asset, animation, tileset, and runtime
  references;
- completion commands and concise rationalization counters.

The main Skill must not embed project-specific names, duplicate complete
schemas, or require asset references for a Slice with no asset work. Base
orchestration references load for every run; GDD coverage loads only for
`kind: gdd`; PixelLab and typed asset contracts load only when the accepted plan
contains those assets.

Codex and Claude copies share the same contract content. Platform-specific
differences are limited to invocation syntax and script-root resolution and are
covered by parity tests. A plugin version/cachebuster update and reinstall
verification are part of delivery so the installed Skill cannot silently lag
behind repository source.

## Compatibility And Rollout

Existing runs with no `contractVersion` remain legacy version 1. Readers,
legacy runtime adapters, checkpoint handling, and finalization continue to
support those stored runs under their original document layout and evidence
strength. They are marked `legacyLayout: true` and never reported as satisfying
new placement or review guarantees.

Legacy runs are not silently upgraded. A user may finish one under its original
contract or start a version-2 run after explicitly selecting or creating the
canonical planning root. Historical documents are not moved automatically.

Rollout order is:

1. Add database columns/functions and dual-version reads without disabling the
   old writer.
2. Deploy MCP contract-version-2 schemas and dual-version checkpoint/finalize
   handling.
3. Ship shared manifest data, Python validators, and cross-layer conformance
   tests.
4. Ship matching Codex and Claude Skill text and conditional references.
5. Verify repository-versus-installed plugin parity.
6. Make version 2 the only contract accepted for new runs while retaining
   legacy read/resume/finalize support.

Each step is additive until the final new-run cutover. Rollback before cutover
restores the prior writer. After cutover, rollback may disable new version-2
runs but must retain reads for any version-2 run already created.

## Verification Strategy

### Contract conformance

A shared corpus covers valid and invalid source profiles, document bindings,
plans, EvalSpecs, events, reviews, runtime observations, policies, and mirror
manifests. Each case declares its expected acceptance and stable reason code.

Tests execute each applicable case through:

- the Zod schema and MCP handler boundary;
- the Python offline validator;
- database behavior tests for invariants owned by SQL.

Parity tests fail when one layer accepts a case another rejects. Required
adversarial cases include parent traversal, absolute paths, symlinked parents,
missing allowed files, ghost evaluation IDs, missing reverse mappings, wrong
document folders, duplicate bare names in one folder, stale epochs/revisions,
forged review levels, legacy runtime prefixes on new runs, stale state tokens,
and a fourth repair transition.

### Lifecycle integration

Database and MCP integration tests prove:

- a roadmap in the root and same-named spec/plan in different child folders can
  be created in one Slice bundle;
- a second Slice binds the existing roadmap and creates a distinct pair;
- bundle failure creates or updates no document and appends no run event;
- plan progress changes only eligible checkbox markers;
- concurrent roadmap completion conflicts and rebases safely;
- GDD and each non-GDD profile can complete their appropriate preflight;
- GDD coverage cannot leak into or become mandatory for a non-GDD run;
- computed runtime and manual acceptance remain separate;
- legacy runs remain readable and cannot claim version-2 guarantees.

### Mirror recovery

Tests inject failure before staging, during replacement, during read-back, and
after journal persistence. Every handled failure restores exact prior hashes.
A simulated process restart consumes the journal before accepting another
manifest. No test writes outside a temporary explicit repository root.

### Skill behavior evaluation

Skill changes follow documentation TDD. Before changing the Skill, record the
current-version baseline behavior for pressure scenarios and the exact
rationalizations or malformed outputs. After the change, run the same prompts
with the new Skill.

Each wording variant uses at least five fresh-context samples plus a
no-new-guidance control. Every flagged result is read manually; raw outputs,
model/runtime identity, scoring criteria, and variance are retained as review
evidence. Static fixture existence or array length is not an evaluation.

The scenario set includes:

- a simple non-GDD document Slice;
- a GDD Slice with complete coverage;
- a two-Slice roadmap and second-Slice resume;
- ambiguous sources and mutually exclusive decompositions;
- unavailable Godot or typed asset capability under urgency;
- an out-of-scope file request;
- a clean launch without observations;
- a self-reported legacy runtime pass;
- a forged independent review;
- stale state and document revisions;
- a third failed repair followed by pressure to continue;
- mirror failure after one target replacement.

## Acceptance Criteria

The convergence is complete only when all of the following are true:

1. `create_slice_bundle` creates or binds roadmap/spec/plan using distinct
   verified folder identities, and same-named spec/plan documents coexist in
   their respective folders.
2. A second Slice binds the existing roadmap without recreating it or weakening
   optimistic concurrency.
3. No reusable Skill, validator, fixture, or server contract requires
   `test8-24`, `game-gdd`, or another display name as identity.
4. GDD runs require a valid Requirement Inventory; non-GDD runs complete
   preflight without GDD fields and with a bound source rationale.
5. Unsafe paths, absent allowed files, ghost evaluations, non-reciprocal
   mappings, and malformed review requirements fail in both Python and MCP
   validation before development writes.
6. The multi-Slice validator rejects a one-Slice bundle, either missing RED or
   GREEN, mismatched IDs, generic checklists, and materially duplicate Slice
   pairs.
7. New runs accept `KECO_OBSERVATION` and reject `KECO_EVAL`; legacy evidence is
   accepted only through the legacy adapter and cannot self-author a pass.
8. Review artifacts report their effective verified level, and a same-actor
   review cannot be stored as `independent_actor`.
9. Manual-required acceptance remains blocking under the default policy even
   when every automated assertion passes.
10. A mirror failure leaves all targets at their verified pre-run hashes, or
    reports a recoverable `partial` state with a durable journal; it never emits
    `MirrorVerification` for a partial batch.
11. A fourth repair transition is rejected across replays, new idempotency keys,
    and resume attempts for the same run.
12. Shared conformance, focused Jest, Deno MCP, Python, and database behavior
    suites pass with no cross-layer acceptance disagreement.
13. Pressure evaluations demonstrate the required behavior across at least five
    fresh contexts per wording variant, with reviewed raw evidence rather than
    fixture-count assertions.
14. Codex and Claude Skill copies pass parity checks, and the installed plugin
    digest matches the released repository files.

## Implementation Boundary

The implementation plan may modify the Slice MCP schemas and handlers, add an
additive migration, revise Slice Python validators and helpers, revise the V2
Skill and its references in both plugin copies, add contract fixtures and
behavior tests, and update plugin version/cache metadata. It must preserve
unrelated dirty files and unrelated Keco workflows.

The current in-progress substantive-decomposition work is not discarded. Its
intent is folded into contract version 2, but its hard-coded source identity,
single-Slice acceptance, partial RED/GREEN check, and exact-hash-only duplicate
test must be replaced by the requirements above.
