# Bundled Review Workflow

This file is self-contained. It gives the skill deterministic plan, task, and completion review rules without requiring another plugin.

## Plan validation

Before implementation, write a plan with exact files, task dependencies, evaluation IDs, RED command, GREEN command, and review points. Run `scripts/validate_plan.py`. Reject placeholders, unknown dependencies, missing evaluations, or tasks without commands. Review scope and allowed files once before issuing the write token.

For a GDD-driven plan, also run `scripts/validate_gdd_coverage.py`. Review in the reverse direction: every normative GDD requirement has a cited source, an authorized status, and a reciprocal Slice/Task/Eval mapping or a real deferred, blocked, or user-confirmation state. An AI proposal without an accepted GDD amendment or patch reference is a pre-write blocker.

## Task RED/GREEN

For each task:

1. Run the named RED command and confirm it fails for the intended missing behavior.
2. Make the smallest change serving the named evaluation.
3. Run the named GREEN command and record output and changed files.

Persist strict TaskResult facts and run `scripts/validate_task_evidence.py` with the current RunContext and SlicePlan. TaskReview is an independent accepted/rejected verdict bound to the same plan revision and exact changed-file after-byte digests. Never persist credentials or unlimited command output.

Do not turn a clean parse, a generated asset, or a startup log into a behavioral pass. If RED cannot be observed because a service is unavailable, mark the task blocked instead of inventing a failure.

## Independent completion review

At `FINAL_VERIFY`, use a fresh context or a separate reviewer pass when available. Give it the plan, changed-file list, report, and test output. Ask for two verdicts in one pass: (1) requirements/evidence compliance and (2) regression or scope risk. Fix Critical/Important findings before reporting `passed`; record Minor findings as residual risks. Small tasks do not need two reviews each.

## Delivery policy

Validate an optional project `delivery-policy.json` with `scripts/validate_delivery_policy.py`; otherwise use the versioned bundled default and record its canonical digest. A project policy may be stricter but cannot omit TaskResult, TaskReview, EvalReport, MirrorVerification, current build/snapshot freshness, the five release gates, the three-repair ceiling, or manual-review blocking. Do not parse or compile `AGENTS.md` as policy.
