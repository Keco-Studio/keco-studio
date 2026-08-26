# EDD Game Evaluation Rubric

## Score Composition

Score exactly two dimensions. `artStyle` is 50 points and `playerFun` is 50 points. Only the eight listed Claude review items contribute points. Technical stability, coverage, mandatory evaluations, P0-P3 findings, and stage gates are acceptance or risk data, not score dimensions.

## Art Style: 50 Points

| Item | Max |
|---|---:|
| styleConsistency | 20 |
| assetQualityAndFit | 15 |
| uiReadabilityAndLayout | 10 |
| visualFeedbackAndEmotion | 5 |

## Player Fun: 50 Points

| Item | Max |
|---|---:|
| coreLoopAppeal | 20 |
| meaningfulChoices | 15 |
| feedbackPacingAndGoals | 10 |
| motivationToContinue | 5 |

Genre remains profile metadata. It may guide evidence selection but cannot add, remove, or reweight these eight items.

Use direct evidence-bounded scores from zero through each item maximum. Every evaluated item needs a reason, evidence references, limitations, and a next-iteration recommendation. If evidence is insufficient, use `not_evaluated` with a null score. Never fabricate player statements.

Player fun means the implemented evidence suggests players may enjoy and continue interacting. It is not a claim about player opinion. Without target-player records, state the limitation explicitly.

## Evidence Boundary

Claude may inspect actual game frames, assets, Godot runtime output, GDD revision, Roadmap, SourceSnapshot, Godot build hash, and Slice EvalReport. The repository has no Claude MCP implementation. A caller must provide external Claude JSON that passes the scorer contract; otherwise the review remains pending.

## Risk And Stage Gates

| Stage | Score | Risk | Coverage |
|---|---:|---|---:|
| Alpha | 60 | No P0; managed P1 may be conditional | 70% |
| Beta | 70 | No P0; open P1 requires owner, fixed acceptance, target version | 90% |
| Release Candidate | 80 | No P0/P1 | 100% |
| Release | 85 | No P0/P1 | 100% |

P0 is fatal, P1 blocks Release Candidate and Release, P2 is major with a workaround, and P3 is local or non-blocking. These gates never add points.
