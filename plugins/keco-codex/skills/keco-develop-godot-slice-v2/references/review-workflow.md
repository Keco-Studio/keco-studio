# Bundled Review Workflow

This file is self-contained. It gives the skill deterministic plan, task, and completion review rules without requiring another plugin.

## Plan validation

Before implementation, write a plan with exact files, task dependencies, evaluation IDs, RED command, GREEN command, and review points. Run `scripts/validate_plan.py`. Reject placeholders, unknown dependencies, missing evaluations, or tasks without commands. Review scope and allowed files once before issuing the write token.

## Task RED/GREEN

For each task:

1. Run the named RED command and confirm it fails for the intended missing behavior.
2. Make the smallest change serving the named evaluation.
3. Run the named GREEN command and record output and changed files.

Do not turn a clean parse, a generated asset, or a startup log into a behavioral pass. If RED cannot be observed because a service is unavailable, mark the task blocked instead of inventing a failure.

## Independent completion review

At `FINAL_VERIFY`, use a fresh context or a separate reviewer pass when available. Give it the plan, changed-file list, report, and test output. Ask for two verdicts in one pass: (1) requirements/evidence compliance and (2) regression or scope risk. Fix Critical/Important findings before reporting `passed`; record Minor findings as residual risks. Small tasks do not need two reviews each.
