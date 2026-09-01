# Keco Skill Interaction Contract Design

**Date:** 2026-08-10

> This document defines the internal execution/evidence boundary. The current
> user-facing Slice progress source is the checkbox list in
> `docs/superpowers/plans/<slice-id>.md`; status and EvalReport artifacts below
> are machine-owned sidecars, not extra planning documents.

## Problem

The Keco Skills enforce strong source, write, provenance, and evidence gates, but their user-facing interaction is too close to the internal execution ledger. Current runs can expose mixed-language headings, raw MCP/tool detail, RunContext fields, write tokens, and execution-stage state before the user has a concise understanding of the intended outcome.

Two related recovery problems are also visible:

1. A safe pre-write stop such as `blocked_before_write` does not consistently explain completed work, user action, writes performed, or the resume point.
2. API key, OAuth, Godot, Keco MCP, and PixelLab interruptions can feel like a new run because the user-facing checkpoint and resume contract are not explicit, even though the V2 machine contract requires revision and identity revalidation.

The same interaction contract must be shipped in `plugins/keco-codex/` and `plugins/keco-claude/`.

## Goals

- Make user-visible natural language follow the user's current language.
- Preserve technical identifiers, tool names, field names, IDs, enum values, and raw source quotations.
- Add a concise intent summary before expensive or mutating work.
- Keep `BuildPlan` and `SlicePlan` static and reviewable.
- Keep execution progress and recovery state in RunState/RunContext/status artifacts; expose only the concise plan checkbox state to users.
- Keep command output, read-back, hashes, screenshots, and runtime evaluations in evidence artifacts.
- Standardize safe blockers with a concrete action and resumable checkpoint.
- Resume after a recovered external dependency without repeating settled questions when source, plan, identity, and workspace revisions are unchanged.
- Preserve backwards readability of existing V2 spec, plan, status, and eval-report documents.
- Keep Codex and Claude plugin contracts synchronized by tests.
- Preserve all existing Keco safety, GDD traceability, write-token, provenance, and evidence gates.

## Non-Goals

- Replacing or modifying the host CLI renderer for `Calling`, `Called`, `Explored`, or `Updated Plan` labels.
- Hiding raw tool output from a host that chooses to render it.
- Weakening explicit confirmation before Keco table writes.
- Allowing secrets in chat, prompts, Keco documents, provenance, logs, or the repository.
- Changing the Keco MCP API or remote authentication implementation.
- Automatically migrating or rewriting legacy documents.

## Architecture

The implementation keeps the existing domain artifacts and assigns each one a single source of truth:

```text
GDD / source document
        |
        v
Spec / intent summary                 why and what
        |
        v
BuildPlan or SlicePlan                approved static scope
        |
        v
RunState / RunContext / status        current stage and recovery checkpoint
        |
        v
TaskResult / Verification / EvalReport evidence and proof
```

### Static plans

`BuildPlan` and `SlicePlan` contain only:

- objective and non-goals;
- source document IDs, revisions, and requirement references;
- acceptance criteria;
- stable task IDs;
- dependencies and deterministic order;
- exact files or Keco resources in scope;
- RED/GREEN or MCP verification commands/sequences;
- review requirements;
- assumptions and unresolved decisions.

After user approval, a plan revision is immutable. A changed scope or acceptance interpretation creates a new revision and invalidates only affected run stages.

Plans do not contain API key/OAuth state, write tokens, temporary MCP connection data, run IDs, retry counters, command output, screenshots, read-back results, or runtime logs. The user-facing Slice plan may contain only its `- [ ]` / `- [x]` task markers for progress.

### Run state

The existing V2 `RunContext` and `status.json` remain the machine-owned state. The build-tables workflow adds an equivalent execution checkpoint for confirmed `BuildPlan` runs. The state records the current stage, plan/source revisions, blocked boundary, writes performed, user action, resume stage, and non-secret checkpoint IDs.

Run state is mutable and is never presented as the plan itself. A user-facing summary is rendered from it instead of dumping the raw object.

### Evidence

Task results, Keco read-back, hashes, screenshots, `KECO_EVAL`, provider responses, and runtime logs remain evidence. Evidence is append-only for a run and cannot silently change the plan or acceptance criteria.

## User Interaction Contract

### Language

- Determine the response language from the latest substantive user request.
- Use that language for headings, summaries, questions, progress, blockers, and final results.
- Preserve tool names, field labels, IDs, code, enum values, error codes, and verbatim source quotations.
- If the source uses another language, summarize it in the user's language and mark quotations as source text.
- Do not mix translated prose headings such as `Relationships` or `Execution` into a Chinese response unless they are literal source labels.

### Intent summary

Before an expensive operation, confirmation prompt, or first development write, show:

```text
Goal: one sentence describing the requested outcome
Source: selected project/document and revision
Scope: Slice or tables/files that will change
Success: the acceptance checks that define completion
Next: the next safe action
```

If the source, dependency, acceptance, or allowed-file choice is ambiguous, ask one focused question with evidence, consequences, and at most three candidates. If it is mechanically unambiguous, do not ask a redundant confirmation before read-only discovery.

### Progress

User-facing progress contains at most:

- completed outcome;
- current outcome or stage in plain language;
- next action;
- blocker, when present.

Internal IDs, hashes, and full tool arguments are available on request or in evidence, but are not the default progress message.

## Blocker And Resume Contract

Every blocked response must include these fields in the user's language:

```text
Status: execution paused
Blocked at: <capability or stage>
Completed: <safe work already finished>
Writes performed: <none or exact partial scope>
Why: <specific cause>
User action: <one concrete action; never paste a secret>
Resume from: <exact stage or failed boundary>
Checkpoint: <non-secret run/plan/source identifiers>
Revalidation: <what will be checked before continuing>
```

`blocked_before_write` means no development write has started. Planning-document writes may already exist if their read-back gates passed; the message must say this explicitly. A run with any development mutation before the blocker is `partial`, not `blocked_before_write`.

### Resume behavior

After the user reports that the dependency is available:

1. Re-check the failed capability boundary.
2. Re-read project identity, selected source revision, plan revision, dirty paths, and affected schemas/rows.
3. If all non-secret checkpoint inputs match, resume at the recorded stage without repeating settled questions or regenerating assets.
4. If an input changed, invalidate the affected stages and ask only the decision made unsafe by that change.
5. Keep the original acceptance criteria and allowed files fixed unless a new approved plan revision is created.

The normal transition is:

```text
running -> paused_with_checkpoint -> user_action -> revalidate -> resume
```

It must not silently become:

```text
running -> error -> new run -> repeat all questions
```

## Plan Display Contract

The default Plan preview contains:

- outcome;
- source and revision;
- tables/files/resources in scope;
- task IDs, dependencies, and order;
- acceptance proof;
- assumptions, warnings, and the next action.

The default preview does not contain raw MCP payloads, full row values, UUID maps, hashes, write tokens, or execution logs. A detail view may expose those values without changing the Plan's ownership.

The UI may render task checkboxes, but task completion is read from RunState/status and evidence. The authoritative Plan remains static.

## Compatibility

- Existing V1 and V2 documents remain readable.
- Existing plan checkboxes and front matter are interpreted as legacy projected state, not as permission to add new runtime fields.
- Existing status and eval reports remain valid under current validators.
- New runs emit the separated interaction, plan, run-state, and evidence fields.
- Codex and Claude copies of the shared interaction contract must be byte-equivalent; a focused test fails on drift.
- Existing safety and contract tests remain required before reporting completion.

## Verification Strategy

Add focused fixtures and tests for:

1. Chinese and English user requests with unchanged technical identifiers.
2. A build-table preview that contains no run-state or evidence fields.
3. A Godot Plan that contains no write token, API status, command output, or runtime evidence.
4. Missing API key, expired OAuth, unavailable Godot, and unavailable PixelLab blockers.
5. A pre-write blocker with a non-empty planning checkpoint.
6. A partial-write failure that is not mislabeled as `blocked_before_write`.
7. Resume with unchanged revisions and no repeated confirmation.
8. Resume after a source revision change with one targeted re-planning question.
9. Identical interaction contract content in Codex and Claude plugins.
10. Existing V2 validator fixtures and read-back contracts.

The implementation must not claim improved visual or gameplay quality from prompt tests alone. Live generation quality remains a separate evaluation track.

## Risks And Mitigations

| Risk                                           | Mitigation                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Runtime state is duplicated in Plan and status | Make status/run state the only mutable source and add forbidden-field tests for plans |
| Legacy documents fail to load                  | Keep legacy readers and add migration-free compatibility fixtures                     |
| Chinese output still mixes raw headings        | Test rendered contract examples while preserving literal tool/source labels           |
| Resume repeats work after auth recovery        | Persist checkpoint and compare source/plan/identity revisions before resuming         |
| Codex and Claude implementations drift         | Keep shared contract text synchronized and test exact equality                        |
| Host CLI still displays raw tool calls         | Document the boundary; do not promise plugin-level suppression                        |
