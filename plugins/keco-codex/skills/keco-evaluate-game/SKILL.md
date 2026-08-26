---
name: keco-evaluate-game
description: Use when a user asks to score or evaluate a Keco-driven Godot game, gameplay Slice, Alpha, Beta, Release Candidate, or Release with EDD, playtest evidence, quality dimensions, risks, or a 100-point report; not for implementing gameplay, analysis-only EDD questions, or standalone Godot debugging.
---

# Evaluate Keco Game

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for that summary and for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

## Boundary

Use this Skill for a full milestone evaluation or a gameplay Slice quick evaluation. A full evaluation scores exactly `artStyle` (50 points) and `playerFun` (50 points), with four fixed sub-items in each dimension. A Slice evaluation covers only affected items, adjacent regressions, and relevant P0/P1 risks; it does not issue a new full score.

Do not implement or repair gameplay in this Skill. Route Keco-driven Godot implementation to `keco-develop-godot-slice-v2`. Do not trigger for analysis-only questions about EDD or for Godot debugging without Keco design sources.

## Stages

Support Slice, Alpha, Beta, Release Candidate, and Release evaluation. Lock the stage, GDD revision, build or snapshot hash, metric profile, thresholds, and required evidence before scoring. Never lower a gate after seeing results.

## Evidence Boundary

Reuse current Keco `EvalSpec`, `KECO_EVAL`, and Slice `EvalReport` evidence for deterministic state, flow, regression, resources, performance, and persistence. This repository does not provide a Claude MCP; `claudeReview` accepts only externally generated, validated JSON. Without a real Claude capability, leave the review pending rather than claiming a provider call. Claude may make evidence-bounded appeal judgments, but must state limitations and must not claim that players found the game fun without player records. Never invent evidence.

Use three to five target players plus one developer or designer observer for a standard milestone evaluation when human evidence is available. Keep observer records outside Claude scores. Missing evidence is `not_evaluated` and cannot contribute to a total.

## Workflow

Follow this order:

```text
INTAKE -> PROFILE -> EVIDENCE_PLAN -> RUNTIME_EVIDENCE
  -> PLAYTEST_EVIDENCE -> SCORE -> VALIDATE -> REPORT -> RETEST
```

1. Identify the Keco project, Godot build, stage, primary genre, GDD revision, and evaluation scope.
2. Create and lock the fixed two-dimension profile before collecting scored evidence. Genre is identity metadata only and never changes weights.
3. Define required evidence for all eight fixed items.
4. Collect fresh structured runtime evidence from the current build. Preserve raw `KECO_EVAL` records.
5. Obtain a validated external `claudeReview` JSON. Each item needs a status, score when evaluated, reason, evidence references, limitations, and next iteration. Use `not_evaluated` when evidence is insufficient.
6. Score only the eight Claude items. Stability, coverage, mandatory evaluations, P0-P3 findings, and stage gates are non-scoring acceptance data.
7. Validate the report before claiming a score or stage decision.
8. Create improvement records with fixed retest criteria for every failed evaluation or material low-scoring finding.

## Invocation And Artifacts

Explicit invocation:

```text
Use $keco-evaluate-game to run a Beta EDD evaluation for my Keco project.
```

Natural-language requests for a full EDD game score or a gameplay Slice quick evaluation also trigger this Skill. Use the user's language in all questions and results.

Create one directory per run:

```text
docs/keco-game-evaluations/<evaluationId>/
  profile.json
  evidence.json
  report.json
  progress.jsonl
  progress.md
```

The existing Slice `EvalReport` owns direct Godot runtime results and raw `KECO_EVAL` evidence. `GameEvaluationReport` is the higher-level score, player evidence, coverage, risks, and stage decision. Reference the Slice report; never rewrite its runtime facts.

Run the deterministic chain from this Skill directory. Each script appends one event to `progress.jsonl` and a Chinese readable mirror to `progress.md`; events are append-only and include actual parsed results.

```bash
python3 scripts/create_evaluation_profile.py \
  --game-id <game-id> --stage <stage> --genre <genre> \
  --gdd-revision <gdd-revision> --build-hash <build-hash> \
  --locked-at <iso-timestamp> --output <run-dir>/profile.json

python3 scripts/score_game_evaluation.py \
  --profile <run-dir>/profile.json \
  --evidence <run-dir>/evidence.json \
  --output <run-dir>/report.json

python3 scripts/validate_game_evaluation_report.py <run-dir>/report.json
```

Run `validate_game_evaluation_report.py` before claiming a score or stage decision. When the report fails or identifies material risks, preserve the original acceptance rule and create improvement and retest records; do not silently change the locked profile.

## Bundled Resources

Read `references/rubric.md` before creating a profile or questionnaire. Read `references/report-contract.md` before writing evidence or report JSON.

Use these scripts when present:

- `scripts/create_evaluation_profile.py` creates a deterministic locked profile.
- `scripts/score_game_evaluation.py` converts validated evidence into a report.
- `scripts/validate_game_evaluation_report.py` rejects incomplete or contradictory reports.

Do not claim the engine is runnable when a required bundled script is absent. During development of this Skill, report the missing component rather than improvising an incompatible format.

## Completion

Report the 100-point Claude score only when all eight items are evaluated and validation passes. Keep `humanReview` in the same report with null `artStyle`, `playerFun`, and `total` slots until a human fills both dimensions. Never merge Claude and human scores automatically. Always show coverage, P0-P3 counts, stage decision, primary blockers, source references, and retest scope beside the score. A high score never overrides a forbidden P0/P1 state.
