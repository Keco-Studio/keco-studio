# GDD EDD Score Report Contract

Every mode returns exactly one Markdown EDD score report in the user's language. Do not add recommendations, a rewrite, implementation tasks, a backlog, runtime claims, risk gates, PASS/FAIL, or separate Progression and Problem output.

## AI-Only Candidate

The `score` mode builds and validates this version 1 structure before rendering:

```json
{
  "schemaVersion": 1,
  "source": {
    "projectId": "project-id",
    "documentId": "document-id",
    "epoch": 0,
    "revision": 0,
    "title": "GDD title"
  },
  "dimensions": {
    "experienceValue": {
      "score": 0,
      "observations": [{ "statement": "Objective observation", "evidence": "GDD quotation or section" }],
      "rationale": "Evidence-to-band reasoning",
      "evidenceGaps": []
    },
    "gameplaySystems": {
      "score": 0,
      "observations": [{ "statement": "Objective observation", "evidence": "GDD quotation or section" }],
      "rationale": "Evidence-to-band reasoning",
      "evidenceGaps": []
    },
    "contentPresentation": {
      "score": 0,
      "observations": [{ "statement": "Objective observation", "evidence": "GDD quotation or section" }],
      "rationale": "Evidence-to-band reasoning",
      "evidenceGaps": []
    }
  },
  "totalScore": 0,
  "confidence": {
    "level": "high",
    "rationale": "Evidence coverage rationale",
    "limitations": []
  }
}
```

`totalScore` must equal the sum of the three dimension scores. Use exact dimension keys. Every observation needs an objective statement and directly traceable evidence. Evidence gaps identify absent or contradictory source content without prescribing a fix.

## Report Variants

### AI-only Provisional

Use for `score` and for `evaluate` before a valid human rating exists.

```markdown
# GDD EDD Score Report

- Evaluation mode: AI-only provisional
- Target: <title> (state <epoch>/<revision>)
- Total score: <total>/100
- Confidence: <high|medium|low>

| Dimension | Score |
| --- | ---: |
| Experience Value | <score>/30 |
| Gameplay and Systems | <score>/40 |
| Content and Presentation | <score>/30 |

## Experience Value
<observations with evidence>

Scoring rationale: <rationale>
Evidence gaps: <gaps or None>

## Gameplay and Systems
...

## Content and Presentation
...

## Confidence
<rationale and limitations>
```

In `evaluate`, include the human rating URL and valid sample count in this report. With zero samples, do not label the AI score as a combined or formal score.

### Human-Combined

After one or more valid human ratings, keep the AI evidence sections and add one combined-score section to the same report:

```markdown
## Human Rating And Combined Result

- Valid samples: <count>
- Experience Value human mean: <1-5 mean>/5
- Gameplay and Systems human mean: <1-5 mean>/5
- Content and Presentation human mean: <1-5 mean>/5
- Experience Value combined: <score>/100
- Gameplay and Systems combined: <score>/100
- Content and Presentation combined: <score>/100
- Formal total score: <score>/100
```

For each dimension: `combined = AI percentage * 70% + human percentage * 30%`. Then compute `final = experienceValue * 30% + gameplaySystems * 40% + contentPresentation * 30%`.

### Baseline

Include source state, provider, requested and observed models, run count, asset hashes, and a table for each dimension and total with `mean`, sample standard deviation, minimum, and maximum. Label it AI-only. Do not include human ratings or a threshold conclusion.

### Comparison

Include the same source and sampling configuration, baseline and current `mean +/- sample standard deviation`, and `difference = current mean - baseline mean` for every dimension and total. List Prompt, Rubric, Schema, result-template, or observed-model changes. Do not call a negative difference a regression and do not output PASS/FAIL.
