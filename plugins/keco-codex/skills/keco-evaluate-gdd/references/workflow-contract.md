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

## Output Repository Contract

Run artifacts are versioned in the independent repository `git@github.com:Keco-Studio/edd-repo.git`, not in the source project repository. The default destination is `main/docs/gdd-edd/runs/<evaluation-id>/`. The publisher must create a unique safe ID, use a clean checkout with fast-forward-only synchronization, copy run artifacts while excluding `.git`, `node_modules`, local Web state, credentials, and temporary files, then create one commit and push by default. `--no-push` is the explicit dry-run override; repository, branch, path, and checkout may be overridden. Existing runs, dirty checkouts, local commits ahead of remote, and path traversal are hard failures. Never force-push, reset, or overwrite unrelated changes. The source GDD and source project working tree are never modified by publication.
