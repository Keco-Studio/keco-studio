---
name: keco-godot-slice-implementation
description: Execute Keco Godot Slice V2 implementation tasks with RED/GREEN evidence, reviews, and resumable checkpoints.
---

# Keco Godot Slice Implementation

Read the [shared interaction contract](../../references/interaction-contract.md) before mutating work.

Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Keep progress to Completed, Current, Next, and Blocker; keep IDs, hashes, write tokens, raw MCP arguments, and evidence in machine artifacts.

Own dependency-ordered tasks, immutable allowedFiles, RED/GREEN commands, TaskResult, TaskReview, effective review levels, interaction checkpoints, pause/resume, successor runs, partial evidence, and checkpoint persistence.

## References

- [review-workflow.md](references/review-workflow.md)

## Scripts

- validate_task_evidence.py
- validate_interaction_checkpoint.py

Use contractVersion 2 and the canonical manifest/corpus. Preserve Keco authority, immutable plan bindings, and the interaction contract. Do not route new work to a legacy workflow.
