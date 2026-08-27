# Game Evaluation Report Contract

## EvaluationProfile

`create_evaluation_profile.py` writes version 1 JSON with identity fields, fixed thresholds, and exactly `dimensions.artStyle` and `dimensions.playerFun`. Each dimension has max 50 and four immutable items with `id`, `dimension`, `name`, integer `max`, anchors, and non-empty `requiredEvidence`. Genre is metadata only.

## Evidence Input

Evidence version 1 binds to `profileId`, `buildHash`, and `gddRevision`. `sourceReferences` cites the GDD revision, Roadmap, SourceSnapshot, Godot build hash, and Slice EvalReport. External `claudeReview.items` contains exactly eight items. Each item has `dimension`, `itemId`, `status` (`evaluated` or `not_evaluated`), `score` within its maximum when evaluated, `reason`, `evidence`, `limitations`, and `nextIteration`. A `not_evaluated` item has a null score and no fabricated evidence.

Evidence may also contain `technicalEvidence`, `mandatoryEvaluations` (`passed`, `failed`, `manual_required`, or `blocked`), and unique P0-P3 `findings`. Preserve raw evidence by reference and do not embed secrets or invented player responses.

## GameEvaluationReport

The scorer writes version 1 JSON containing identity and source references, `claudeReview` with two dimension totals and eight item records, an independent null-filled `humanReview`, coverage, technical evidence, findings and severity counts, mandatory evaluations, and decision status/reasons. Only complete Claude item scores contribute to Claude totals. It never creates a combined score.

Human review uses the same report but is separate: both dimension entries and the total remain null until a human supplies complete comments and next-iteration notes. A manually completed human review must recompute its own total and is never merged with Claude.

## Execution Ledger

Profile, score, and validation operations use canonical input hashes plus the
evaluator and contract versions. A matching key reuses an artifact only when its
current SHA-256 digest matches the recorded output hash. `progress.jsonl` is the
only append-only fact source; `progress.md` is a generated projection.
