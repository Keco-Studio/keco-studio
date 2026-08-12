---
name: keco-evaluate-game
description: Use when a user asks to score or evaluate a Keco-driven Godot game, gameplay Slice, Alpha, Beta, Release Candidate, or Release with EDD, playtest evidence, quality dimensions, risks, or a 100-point report; not for implementing gameplay, analysis-only EDD questions, or standalone Godot debugging.
---

# Evaluate Keco Game

Read and follow the [shared interaction contract](../../references/interaction-contract.md) for every user-visible exchange, checkpoint, and resume.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next. Use the user's language for that summary and for progress limited to Completed, Current, Next, and Blocker. Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts or an on-request detail view.

## Boundary

Use this Skill for a full milestone evaluation or a gameplay Slice quick evaluation. A full evaluation scores the fixed 80-point general rubric plus a locked 20-point genre/GDD profile and produces a 100-point `GameEvaluationReport`. A Slice evaluation covers only affected metrics, adjacent regressions, and relevant P0/P1 risks; it does not issue a new full score.

Do not implement or repair gameplay in this Skill. Route Keco-driven Godot implementation to `keco-develop-godot-slice-v2`. Do not trigger for analysis-only questions about EDD or for Godot debugging without Keco design sources.

## Stages

Support Slice, Alpha, Beta, Release Candidate, and Release evaluation. Lock the stage, GDD revision, build or snapshot hash, metric profile, thresholds, and required evidence before scoring. Never lower a gate after seeing results.

## Evidence Boundary

Reuse current Keco `EvalSpec`, `KECO_EVAL`, and Slice `EvalReport` evidence for deterministic state, flow, regression, resources, performance, and persistence. Keep `manual_required` status for visual and experience evaluations until target-player evidence exists. Never infer fun, feel, pacing, readability, or aesthetics from screenshots, file parsing, AI judgment, or a clean launch.

Use three to five target players plus one developer or designer observer for a standard milestone evaluation. Keep observer records outside player subjective averages. Missing evidence is `not_evaluated`; content a player did not encounter is `not_applicable`.

## Workflow

Follow this order:

```text
INTAKE -> PROFILE -> EVIDENCE_PLAN -> RUNTIME_EVIDENCE
  -> PLAYTEST_EVIDENCE -> SCORE -> VALIDATE -> REPORT -> RETEST
```

1. Identify the Keco project, Godot build, stage, primary genre, GDD revision, and evaluation scope.
2. Create and lock the 80+20 profile before collecting scored evidence.
3. Define required automatic, observer, questionnaire, and manual evidence for every applicable metric.
4. Collect fresh structured runtime evidence from the current build. Preserve raw `KECO_EVAL` records.
5. Collect behavior-anchored responses, group subjective ratings, concrete player events, and observer events without inventing missing data.
6. Score the applicable profile, calculate coverage and confidence, classify P0-P3 findings, and apply stage gates.
7. Validate the report before claiming a score or stage decision.
8. Create improvement records with fixed retest criteria for every failed evaluation or material low-scoring finding.

## Bundled Resources

Read `references/rubric.md` before creating a profile or questionnaire. Read `references/report-contract.md` before writing evidence or report JSON.

Use these scripts when present:

- `scripts/create_evaluation_profile.py` creates a deterministic locked profile.
- `scripts/score_game_evaluation.py` converts validated evidence into a report.
- `scripts/validate_game_evaluation_report.py` rejects incomplete or contradictory reports.

Do not claim the engine is runnable when a required bundled script is absent. During development of this Skill, report the missing component rather than improvising an incompatible format.

## Completion

Report the 100-point score only for milestone evaluations with sufficient coverage. Always show player sentiment, coverage, P0-P3 counts, stage decision, primary blockers, and the retest scope beside the score. A high score never overrides a forbidden P0/P1 state.
