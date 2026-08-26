# GDD EDD Workflow Contract

## Modes

| Mode | AI runs | Player/human rating | Persistent baseline | Comparison |
| --- | ---: | --- | --- | --- |
| `score` | 1 | No | No | No |
| `evaluate` | 1 | Yes, through the bundled Web | No | No |
| `baseline` | 3 by default; 2-20 allowed | No | Yes | No |
| `compare` | 3 by default; 2-20 allowed | No | Reads existing baseline | Yes |

`evaluate` normalizes each AI dimension to 100, normalizes the player/human 1-5 mean to 100, and combines `AI 70% + player/human 30%`. The final score weights the combined dimensions as Experience Value 30%, Gameplay and Systems 40%, and Content and Presentation 30%.

`baseline` and `compare` execute AI calls sequentially. Summarize each dimension and total with mean, sample standard deviation, minimum, and maximum. Comparison differences are `current mean - baseline mean`.

The workflow must not output PASS/FAIL, regression, degradation, or acceptance conclusions. A comparison reports numbers and configuration changes only.

## Locked Identity And Configuration

Every baseline records:

- Keco project ID, document ID, GDD `epoch`, and GDD `revision`;
- GDD, Prompt, Rubric, Schema, and result-template SHA-256 hashes;
- provider, requested model, and observed model identifiers;
- sample count and individual sample metadata.

Provider and requested model select the baseline file. A different GDD document ID, `epoch`, `revision`, or GDD hash is incompatible and requires a new baseline. Prompt, Rubric, Schema, result-template, and observed-model differences remain visible as configuration changes in an otherwise compatible comparison.

## Keco Manifest

Stage inputs in one temporary workspace and use a version 1 manifest:

```json
{
  "schemaVersion": 1,
  "id": "sample-r0-e2",
  "title": "Sample",
  "source": {
    "projectId": "project-id",
    "documentId": "document-id",
    "epoch": 2,
    "revision": 0
  },
  "paths": {
    "gdd": "inputs/gdd.md",
    "prompt": "inputs/prompt.md",
    "rubric": "inputs/rubric.md",
    "resultTemplate": "inputs/result.md"
  },
  "outputStem": "sample-r0-e2"
}
```

All input paths must be relative files inside `workspaceRoot`. Reject absolute paths, `..` escapes, missing files, and symlinks that resolve outside the workspace. `epoch` and `revision` are non-negative integers and may equal `0`.

The source GDD remains read-only. Temporary Progression, Problem, Result, raw evidence, Web state, baseline JSON, and manifests are engine artifacts. The only Keco write allowed by this skill is one explicitly requested independent EDD score report document.
