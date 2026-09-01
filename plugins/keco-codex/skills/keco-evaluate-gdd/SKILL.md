---
name: keco-evaluate-gdd
description: Use when a user asks to score or evaluate a Keco GDD document or an explicitly supplied local GDD with EDD, collect human ratings, create an AI score baseline, or compare current GDD scores with a baseline; not for runtime game evaluation, playtests, GDD rewriting, implementation planning, or document summaries.
---

# Evaluate Keco GDD

Read and follow the [shared interaction contract](../../references/interaction-contract.md). Evaluate the current GDD as immutable design evidence. Return exactly one EDD score report as the evaluation result; do not append a separate critique, recommendations, plan, backlog, PASS/FAIL verdict, or offer to rewrite.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

## Boundary

- Resolve exactly one GDD source for this run and read its complete current content. For a Keco source, resolve one project/document and verify the supplied document ID; for a local source, require an explicit repository-relative snapshot path. Never default to a historical or project-specific GDD.
- You must not modify, update, rewrite, or annotate the source GDD.
- Treat the GDD as design intent only: no Godot, no runtime, no playtest, and no implementation claims.
- Route evaluation of a build, gameplay Slice, milestone, or runtime behavior to `keco-evaluate-game`.
- Keep local engine documents and JSON as temporary machine artifacts. Do not present Progression or Problem as additional results.
- Create or update exactly one independent Keco report document only when the user asks to persist or write back the report. Read it back after every write. Never store a report inside the GDD.

## Run Output Repository

Every run has a unique `evaluation-id` and publishes its artifacts to the independent `edd-repo` Git repository, not to the source project:

```text
git@github.com:Keco-Studio/edd-repo.git
  docs/gdd-edd/runs/<evaluation-id>/
```

The Runner creates a clean checkout, copies the manifest, progress, result, evidence, problem, and baseline artifacts, commits them, and pushes to `version4` by default (the current default branch of `edd-repo`). It rejects an existing run, dirty or locally-ahead checkouts, path traversal, and non-fast-forward updates; it never force-pushes. Use `--no-push` only for an explicitly requested dry run. `--output-repo`, `--output-branch`, `--output-runs-path`, and `--output-checkout` provide explicit overrides. Git credentials must come from the existing SSH agent, credential helper, or GitHub CLI and must never be written into artifacts.

## Select Mode

Read [references/workflow-contract.md](references/workflow-contract.md), then select from the user's request:

| Mode | Use | Result |
| --- | --- | --- |
| `score` | Single document assessment | One AI-only EDD score report; no player or human rating Web and no document write unless explicitly requested |
| `evaluate` | Complete AI and human evaluation | One provisional report plus a player/human rating URL, then the same report with AI 70% + human 30% combined scores |
| `baseline` | Repeated AI-only reference sampling | One baseline EDD score report with 2-20 sequential samples, default 3 |
| `compare` | Compare current sampling to an existing baseline | One comparison EDD score report using current mean minus baseline mean |

If a request asks to score and also rewrite, modify, recommend changes, or create a backlog, use `score` and perform only the score. Do not write any document for those extra requests.

## Resolve And Read

1. Resolve exactly one Keco project and one existing Keco GDD document. Verify a supplied document ID belongs to the project. Ask one focused question only when multiple current documents remain equally plausible.
2. Call `read_document` for the current GDD. If full read falls back to an outline, continue with mode `heading` and then mode `lines` until every section and the complete document have been read.
3. Retain the project ID, document ID, title, `token.epoch`, and `token.revision`. Both state values may be `0`. Do not score an excerpt, summary, stale state, or partial read.
4. Read [references/rubric.md](references/rubric.md). Apply `experience goal -> design response -> GDD evidence` to `experienceValue`, `gameplaySystems`, and `contentPresentation` without double-counting evidence.

## Execute

### Score

Build the version 1 AI-only candidate from [references/report-contract.md](references/report-contract.md). Validate it in memory:

```bash
python3 scripts/validate_gdd_evaluation_report.py -
```

Pass the candidate JSON on standard input. Correct validation failures before rendering the report. Do not persist candidate JSON in the user's project.

### Evaluate, Baseline, Or Compare

Use the bundled reference engine at `assets/gdd-edd/` and its Keco adapter `assets/gdd-edd/src/keco-cli.mjs`.

1. Create a temporary workspace. Stage the complete selected GDD plus the bundled prompt, rubric, and result template as files inside that workspace.
2. Create a manifest matching [references/workflow-contract.md](references/workflow-contract.md). Copy the exact Keco IDs and state token; never invent or increment them.
3. Run the selected command from `assets/gdd-edd/`:

```bash
npm run eval -- --manifest <manifest> --workspace-root <workspace> --run-root <run-root>
npm run eval:baseline -- --manifest <manifest> --workspace-root <workspace> --run-root <run-root> --runs 3
npm run eval:compare -- --manifest <manifest> --workspace-root <workspace> --run-root <run-root> --runs 3
```

For `evaluate`, keep the returned local Web server running while human ratings are collected. With zero valid human ratings, label the report provisional and do not emit a combined total. After ratings arrive, read the updated Result and render the same report as human-combined. Stop the server when collection is finished or the user stops the task.

For `baseline` and `compare`, sampling must remain sequential. Do not launch the Web, create a human session, or turn differences into a quality gate.
After artifacts are written and read back, publish the run with the default EDD repository publisher. Record destination, branch, evaluation-id, commit, and push result in Progress. A clone, commit, or push failure preserves the local run and is a blocker; never silently write results into `keco-studio`.

## Report And Write Back

Read [references/report-contract.md](references/report-contract.md). The final user-visible response must contain only the applicable EDD score report. Preserve source quotations verbatim.

When Keco persistence was explicitly requested:

1. Discover a compatible destination folder in the same project.
2. Create one independent report document, or update the report document already created for this evaluation.
3. Include source project/document IDs and state `epoch/revision` in the report.
4. Read the report back and verify its title, source state, scores, and mode. The report document's own state token is separate and may also contain `0`.

Never write Progression, Problem, baseline JSON, raw AI output, player comments, or temporary manifests to Keco.

## Failure Handling

Do not issue a score when project identity, document identity, current state, or complete content cannot be verified. A missing design statement is an evidence gap; unreadable or unattributable source evidence is a blocker. In `compare`, require the same GDD ID, `epoch`, `revision`, and content hash as the baseline. Report a blocker rather than comparing incompatible GDD states.
