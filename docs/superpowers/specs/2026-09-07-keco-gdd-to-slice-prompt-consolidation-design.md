# Keco GDD-to-Slice Prompt Consolidation

**Date:** 2026-09-07

**Status:** Ready for implementation by a separate agent

## Goal

Reduce the prompt and reference text loaded for the Keco GDD-to-Slice planning
workflow while preserving the complete Keco Godot Slice V2 architecture,
artifact chain, validation behavior, and delivery semantics.

The change is a contract-preserving editorial refactor. It must make each rule
have one clear owner, replace repeated normative prose with precise references,
and keep phase-local instructions focused on the decision being made in that
phase.

## Baseline And Target

The measured Codex-side GDD-to-Slice planning corpus contains 736 physical
Markdown lines, 568 non-blank lines, and 5,120 words. The baseline includes:

```text
plugins/keco-codex/skills/keco-develop-godot-slice-v2/SKILL.md
plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/ab-matrix.md
plugins/keco-codex/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md
plugins/keco-codex/skills/keco-godot-slice-preflight/SKILL.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/gdd-change-contract.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/gdd-coverage-contract.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/multi-slice-orchestration.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/plan-template.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/slice-decision.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/slice-document-contract.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/source-data-contract.md
plugins/keco-codex/skills/keco-godot-slice-preflight/references/spec-template.md
```

The target for the same Codex-side corpus is:

- 571-616 physical Markdown lines, a reduction of 120-165 lines.
- No more than 500 non-blank lines.
- No more than 4,300 words.
- Byte-equivalent semantic mirrors on the Claude side, except for established
  host-specific path or tool wording normalized by existing tests.

Line and word targets are secondary gates. Behavioral preservation takes
priority. The implementation must not minify prose, merge unrelated rules into
unreadable paragraphs, or weaken a contract to reach the target.

## Non-Negotiable Architecture

The following lifecycle remains unchanged:

```text
SourceProfile
-> Requirement Inventory
-> roadmap / spec / plan
-> SlicePlan / EvalSpec
-> TaskResult / TaskReview
-> KECO_OBSERVATION / EvalReport
-> MirrorManifest / MirrorVerification
-> delivery seal
```

This refactor must not:

- Add, remove, merge, rename, or reorder any lifecycle phase.
- Add, remove, merge, rename, or change the authority of any artifact.
- Merge `roadmap`, `spec`, `plan`, `SlicePlan`, or `EvalSpec`.
- Change `contractVersion`, any artifact `schemaVersion`, field name, enum,
  reason code, status, hash rule, identity rule, or path rule.
- Change SourceProfile selection, Requirement Inventory classification,
  reciprocal Requirement/Slice/Task/Eval coverage, or GDD amendment behavior.
- Change write-lease acquisition, immutable `allowedFiles`, successor-run,
  checkpoint/resume, review-level, repair-ceiling, runtime-evidence, mirror, or
  delivery behavior.
- Change any MCP, TypeScript, Python, SQL, database, or Godot runtime contract.
- Change the canonical Spec or Plan template content.
- Route new work to V1 or accept `KECO_EVAL` as V2 evidence.

## Scope

In scope:

- Editorial consolidation of the listed Codex and Claude Skill/reference
  Markdown files.
- Clear ownership of common, orchestration, source, coverage, decomposition,
  document, plan, review, and verification rules.
- Conditional-loading instructions that prevent unrelated references from
  entering a phase prompt.
- Existing unit tests that assert obsolete wording rather than preserved
  behavior.
- Focused tests that protect rule ownership, reference reachability, line
  budgets, Codex/Claude parity, and architecture invariants.
- A preservation matrix mapping removed or shortened normative text to its
  surviving canonical owner and behavioral evidence.

Out of scope:

- GDD content generation and its model prompts.
- Gameplay implementation, generated assets, PixelLab behavior, or Godot MCP
  capability changes.
- Schema, validator, tool, SQL, migration, or persistence changes.
- New workflow phases, new user decisions, or new Keco documents.
- Rewriting the Game Design System or GDD generation architecture.
- General cleanup of unrelated Skills or documentation.
- Modifying or deleting unrelated user files, including `tmp/`.

## Approaches Considered

### Ad Hoc Sentence Trimming

Delete repeated sentences wherever they appear and adjust failing keyword
tests. This is the smallest edit, but it leaves ownership ambiguous and makes
later duplication likely. It also encourages deleting text based on line count
rather than proving that another authoritative owner remains.

This approach is rejected.

### Ownership-Driven Consolidation

Assign every normative rule to one existing contract owner. Other files retain
only a short phase-specific pointer when the rule affects their entry or exit
gate. Keep schemas, examples, and exact shapes in the manifest, canonical
templates, fixtures, or the one reference that owns them.

This is the selected approach. It reduces repeated prompt context without
changing the workflow or introducing a new runtime artifact.

### Generated Prompt Documentation

Generate all human-readable Skill text from the contract manifest and schema
definitions. This could reduce future drift, but it would add a documentation
generator, generated-file policy, and new build dependencies. Prose ordering and
decision rationale do not map cleanly to the existing machine contract.

This approach is deferred because it expands the architecture beyond an
editorial refactor.

## Rule Ownership

Every normative rule must have exactly one canonical prose owner unless the
same invariant is deliberately enforced at a separate machine boundary.
Machine enforcement is defense in depth and is not removed by this refactor.

| Concern | Canonical owner | Other files may contain |
| --- | --- | --- |
| User language, intent summary, progress, blockers, resume | Shared interaction contract | One link only |
| Public routing and phase order | Main V2 `SKILL.md` | Phase names and direct links |
| RunContext, phase transitions, write lease, artifact ledger | `orchestration-contract.md` | Entry/exit condition pointer |
| Source discovery and source identity | `source-data-contract.md` | Selected SourceProfile kind |
| Source and Slice ambiguity decisions | `slice-decision.md` | One stop/continue pointer |
| GDD Requirement Inventory and reciprocal coverage | `gdd-coverage-contract.md` | Requirement IDs consumed locally |
| GDD proposal and accepted-patch behavior | `gdd-change-contract.md` | One amendment-gate pointer |
| Multi-Slice ordering, independence, and resume | `multi-slice-orchestration.md` | Current Slice dependency state |
| Keco document placement and revision behavior | `slice-document-contract.md` | Required document bindings |
| Human-readable Spec shape | Canonical `spec-template.md` | Link to template |
| Human-readable Plan shape | Canonical `plan-template.md` | Link to template |
| Enums, limits, reason codes, canonical paths | Contract manifest | Link plus load instruction |
| Shape validity and cross-artifact consistency | Existing validators and conformance corpus | Validator command and stop condition |

A short local reminder is allowed only when omitting it would make the phase's
immediate stop/continue decision ambiguous. Such a reminder must not restate a
field list, full sequence, payload example, or rationale already owned by the
canonical source.

## Prompt Responsibility Boundaries

The following names describe responsibilities inside the existing Preflight
phase. They do not create new skills, model calls, phases, artifacts, or tools.

### Requirement Extractor

Inputs:

- The selected, revision-bound GDD SourceProfile.
- The complete authoritative GDD read-back required by the existing contract.
- The GDD coverage and change contracts.

Output:

- The existing versioned Requirement Inventory.

Rules:

- Extract atomic requirements: one independently implementable or deferrable
  obligation per requirement ID.
- Preserve exact source location and quote.
- Classify each item as `normative`, `descriptive`, or `tentative` using the
  existing meanings.
- Do not propose files, tasks, evaluations, or implementation details.
- Do not convert descriptive context into a normative requirement.
- Keep unsupported features as proposals governed by the existing GDD change
  contract.

### Slice Decomposer

Inputs:

- The accepted Requirement Inventory.
- Existing roadmap state and dependency evidence.
- Repository and capability discovery already required by Preflight.

Output:

- The existing roadmap and candidate Slice decision.

Use this precedence when more than one valid decomposition exists:

```text
independently demonstrable outcome
> independently verifiable behavior
> fewer cross-system dependencies
> smaller implementation size
```

This precedence refines prompt clarity only. Existing ambiguity, user
confirmation, multi-Slice distinctness, ordering, and coverage rules remain
authoritative.

### Slice Contract Planner

Inputs:

- One selected Slice and its mapped Requirement IDs.
- Current repository identity and relevant implementation boundaries.
- Canonical Spec and Plan templates.
- Existing SlicePlan and EvalSpec schemas and validators.

Outputs:

- The existing `spec`, `plan`, `SlicePlan`, and `EvalSpec` artifacts.

Rules:

- Every technical statement must be grounded in a mapped requirement,
  repository fact, or explicit existing contract.
- Do not copy the complete GDD or complete Requirement Inventory into the task
  prompt; include only mapped items plus their source evidence.
- Keep reciprocal Requirement/Slice/Task/Eval mappings unchanged.
- Keep EvalSpec locked before development writes.
- Keep exact files, dependency order, RED/GREEN commands, review requirements,
  and `allowedFiles` unchanged in meaning.

The implementation must not add an `applicability` field or any other schema
extension as part of this work. If an existing required technical category
cannot be populated without invention, the planner follows the current blocker
or clarification behavior.

## File-Level Consolidation

### Main V2 Skill

Keep only:

- Routing and applicability.
- SourceProfile-to-reference routing.
- The five phase order.
- High-level ownership boundaries.
- Links to the orchestration and phase contracts.
- The end-to-end completion chain.

Remove detailed restatements of artifact schemas, review semantics, delivery
rules, and stop conditions when their canonical owner is linked and loaded.

### Orchestration Contract

Keep lifecycle ordering, authoritative state ownership, write-lease timing,
phase transitions, task ordering exceptions, repair ceiling, and immutable
delivery sequence.

Replace large payload examples and repeated field descriptions with references
to the contract manifest, canonical fixtures, and owning phase contract. Retain
only fields needed to explain a lifecycle decision that cannot be inferred from
the machine contract.

### Preflight Skill

Keep its owned capabilities, required validators, and conditional reference
routing. Replace interaction, V2, authority, and legacy boilerplate with links
to their existing canonical owners.

### Preflight References

- `source-data-contract.md` owns source discovery and identity once.
- `slice-decision.md` owns source/Slice ambiguity state once.
- `gdd-coverage-contract.md` owns inventory and reciprocal mapping once.
- `gdd-change-contract.md` owns proposal authorization once.
- `multi-slice-orchestration.md` owns decomposition, ordering, and multi-run
  resume once.
- `slice-document-contract.md` owns planning hierarchy, optimistic concurrency,
  and document mutation once.
- `spec-template.md` and `plan-template.md` remain canonical and unchanged.

Cross-references must be explicit and relative paths must resolve from the file
that contains them.

## Conditional Loading

The main Skill loads only the orchestration contract and the current phase
module. Preflight loads references according to the current decision:

```text
always: source-data-contract + slice-decision
GDD source: gdd-coverage-contract + gdd-change-contract
multiple Slices: multi-slice-orchestration
planning document mutation: slice-document-contract
Spec authoring: spec-template
Plan authoring: plan-template
```

Conditional loading changes prompt composition only. It does not make a
contract optional when its condition applies, and it does not allow an agent to
skip a validator or artifact.

## Preservation Matrix

Before editing a normative Skill/reference sentence, create:

```text
docs/superpowers/artifacts/2026-09-07-keco-gdd-to-slice-prompt-preservation-matrix.json
```

Each entry must contain:

```json
{
  "sourcePath": "existing file",
  "sourceHeading": "existing heading",
  "concern": "stable concern key",
  "decision": "keep|shorten|move_to_owner|remove_duplicate",
  "canonicalOwnerPath": "surviving file",
  "survivingTextOrHeading": "where the behavior remains documented",
  "machineEnforcement": ["validator, schema, conformance case, or test"],
  "reason": "why behavior is unchanged"
}
```

Every removed normative statement requires an entry. Editorial headings,
blank lines, and purely descriptive transitions do not require individual
entries. A statement cannot be removed as duplicate unless the matrix points to
the surviving owner.

## Error Handling

- If two files appear to own conflicting versions of a rule, stop compression
  for that rule, identify the machine-enforced behavior, and reconcile the prose
  without changing the behavior.
- If a keyword-based test conflicts with canonical behavior, replace it with an
  ownership or behavior assertion. Do not merely delete the assertion.
- If meeting the line target would remove a necessary example or make a
  standalone phase ambiguous, keep the text and report the measured shortfall.
- If Codex and Claude paths require host-specific wording, preserve the existing
  normalization boundary and prove parity with the existing test.
- If installed plugin cache parity fails after repository edits, use the
  repository's supported cachebuster and reinstall flow; do not hand-edit the
  installed cache.

## Verification

### Static Measurements

Record before and after counts for the exact 12-file baseline list using:

```bash
wc -l <files>
for file in <files>; do sed '/^[[:space:]]*$/d' "$file"; done | wc -l
wc -w <files>
```

Store the paths, counts, and reduction percentages in the preservation matrix
or an adjacent verification report. Do not count JSON manifests, scripts,
fixtures, generated caches, or unrelated phase references in the 736-line
baseline.

### Required Tests

Run the focused plugin suites that cover:

- Main Skill routing and conditional references.
- Codex/Claude Skill and reference parity.
- Canonical Spec/Plan template byte equality.
- SourceProfile and GDD/non-GDD behavior.
- Requirement coverage and reciprocal plan/evaluation mappings.
- Multi-Slice decomposition and resume.
- V2 contract conformance and end-to-end artifact compatibility.
- Installed plugin cache parity when the local cache is present.

At minimum, execute the repository commands covering:

```text
tests/unit/plugins/keco-godot-slice-v2.test.ts
tests/unit/plugins/keco-godot-slice-v2-modules.test.ts
tests/unit/plugins/keco-godot-slice-v2-e2e.test.ts
```

Run the shared contract conformance validators and the current Skill behavior
evaluation suite when its configured providers are available. Provider failures
must be reported separately from behavioral failures and cannot be counted as a
passing sample.

### Review

Review the final diff in both directions:

1. For every deleted normative statement, confirm its preservation-matrix owner
   still states the same behavior.
2. For every architecture invariant in this spec, confirm no edited file,
   schema, test, or reference changes it.

## Acceptance Criteria

1. The complete Slice V2 lifecycle and all artifact ownership remain unchanged.
2. No schema, validator, MCP, TypeScript, Python, SQL, migration, or runtime
   contract changes are present.
3. Canonical `spec-template.md` and `plan-template.md` bytes are unchanged.
4. The exact Codex planning corpus is 571-616 physical Markdown lines, no more
   than 500 non-blank lines, and no more than 4,300 words, unless preservation
   evidence demonstrates why a higher count is required.
5. The preservation matrix accounts for every removed normative statement.
6. Every rule has one clear prose owner and all cross-references resolve.
7. Requirement extraction remains atomic, source-cited, classified, and
   authorization-aware.
8. Slice decomposition preserves coverage and uses demonstrability,
   verifiability, dependency isolation, and size in the documented precedence.
9. Spec, Plan, SlicePlan, and EvalSpec remain separate, compatible artifacts.
10. Requirement/Slice/Task/Eval mappings remain reciprocal.
11. Write lease, immutable `allowedFiles`, successor runs, RED/GREEN evidence,
    review levels, runtime observations, repair ceiling, mirrors, and delivery
    gates retain their current behavior.
12. Codex and Claude copies pass existing semantic and byte-parity boundaries.
13. Focused plugin, contract, and end-to-end tests pass with no weakened
    assertions.
14. Behavior-evaluation results contain no regression when configured providers
    are available; missing provider evidence is reported, not invented.

## Expected Outcome

The workflow remains architecturally identical, but an agent receives less
repeated policy text and a clearer current responsibility. The expected
repository reduction is 120-165 lines per platform mirror. The expected
single-phase prompt-context reduction is approximately 25-35 percent because
only the current phase's owning references are loaded.
