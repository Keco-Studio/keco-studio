# Keco GDD-to-Slice Prompt Consolidation

## Objective

Consolidate only the approved Keco Godot Slice V2 planning prompts and references while preserving every lifecycle phase, artifact, schema, validator, and runtime contract.

## Implementation Plan

1. [x] Freeze the approved spec, enumerate the exact 12-file Codex corpus and Claude mirrors, and create the preservation matrix before edits.
2. [x] Keep the shared interaction contract as the sole owner of interaction rules; reduce the entry Skill to routing, applicability, phase order, ownership links, and completion chain.
3. [x] Keep orchestration lifecycle, write lease, state transitions, repair ceiling, and delivery ordering in `orchestration-contract.md`; replace redundant payload restatements with manifest/validator references.
4. [x] Consolidate Preflight and its source, decision, coverage/change, multi-Slice, and document references by their assigned ownership, with explicit conditional loading and no new phase, skill, model call, or artifact.
5. [x] Leave `spec-template.md` and `plan-template.md` byte-identical and apply the same semantic edits to Codex and Claude mirrors.
6. [x] Update the preservation matrix with each removed or shortened normative statement and its unique owner/evidence, then run focused plugin suites, contract conformance, parity, template-byte, cache parity, and static measurements.
7. [x] Run the available static/contract checks and report provider-backed behavior evaluation as unavailable because the repository eval harness and configured model provider credentials are absent.

## Verification Gates

- `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- `tests/unit/plugins/keco-godot-slice-v2-modules.test.ts`
- `tests/unit/plugins/keco-godot-slice-v2-e2e.test.ts`
- Shared contract validators and conformance corpus
- Codex/Claude semantic and byte-parity checks
- Canonical Spec/Plan template byte equality
- Installed cache parity through the supported cachebuster/reinstall flow
- Exact 12-file line, non-blank-line, and word counts

## Result

The exact Codex corpus is 616 physical lines, 498 non-blank lines, and 3,820 words. Focused plugin suites, 30-case shared conformance across both Python runtimes, Codex/Claude repository parity, installed Codex and Claude cache parity, and canonical template byte checks passed. Provider-backed Skill behavior evaluation remains unrun for the missing harness/provider credentials.
