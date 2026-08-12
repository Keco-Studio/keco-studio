# Game Evaluation Report Contract

## Contents

- EvaluationProfile
- Evidence input
- GameEvaluationReport

## EvaluationProfile

`create_evaluation_profile.py` writes version 1 JSON with identity fields, fixed thresholds, `subjectiveWeight: 0.2`, `generalMetrics`, and `specializedMetrics`. Every metric contains `id`, `groupId`, `name`, integer `weight`, anchors `1`/`3`/`5`, and non-empty `requiredEvidence`. Custom metrics also contain `gddSource`.

The profile is immutable input for one evaluation configuration. A changed build, GDD revision, stage, genre, metric, weight, or threshold creates another profile.

## Evidence Input

Evidence version 1 binds to `profileId` and `buildHash` and contains:

- `itemResults`: one result per metric with status `evaluated`, `not_applicable`, or `not_evaluated`; evaluated results require a 1-5 rating and evidence references.
- `subjectiveResults`: 1-10 target-player ratings and evidence for experience groups.
- `mandatoryEvaluations`: `passed`, `failed`, `manual_required`, or `blocked` with evidence.
- `findings`: unique issue ID, P0-P3 severity, one primary metric, linked metrics, evidence, and repair ownership fields when required.

Preserve raw evidence by reference. Do not embed secrets, unnecessary personal data, or invented player responses.

## GameEvaluationReport

The scorer writes version 1 JSON containing profile/build identity, stage, score totals and groups, coverage, subjective summaries, confidence flags, findings and severity counts, mandatory evaluations, decision status/reasons, and raw result references.

Allowed decisions are `passed`, `conditional`, `partial`, `failed`, and `blocked`. Release Candidate and Release cannot be conditional. A report validator must pass before the Skill claims a formal result.
