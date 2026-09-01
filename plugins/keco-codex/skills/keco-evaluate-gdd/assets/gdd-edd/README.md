# Keco GDD EDD Engine

This bundled engine ports the reference GDD EDD workflow into a generic Keco manifest adapter. It supports one AI evaluation with a human rating Web, AI-only baseline sampling, and baseline comparison. Each invocation publishes its run artifacts to the independent EDD repository by default.

Node.js 20 or newer is required.

## Commands

Run a complete AI and human evaluation:

```bash
npm run eval -- --manifest <case.json> --workspace-root <workspace> --run-root <run-root>
```

Create the default three-sample AI-only baseline:

```bash
npm run eval:baseline -- --manifest <case.json> --workspace-root <workspace> --run-root <run-root> --runs 3
```

Compare current AI-only samples with the saved baseline:

```bash
npm run eval:compare -- --manifest <case.json> --workspace-root <workspace> --run-root <run-root> --runs 3
```

Publishing defaults to `git@github.com:Keco-Studio/edd-repo.git`, branch `version4`, under
`docs/gdd-edd/runs/<evaluation-id>/`. Use `--no-push` to stage the run locally
without a commit or push. `--output-repo`, `--output-branch`,
`--output-runs-path`, and `--output-checkout` override the destination. The
publisher refuses an existing run, dirty checkouts, local commits ahead of the
remote, non-fast-forward updates, and path traversal. It never force-pushes.

Use `--provider codex|claude`, `--model <model-id>`, and `--runs <2-20>` as needed. Baseline creation refuses overwrite unless `--force` is supplied.

## Workflow

1. The Keco adapter validates a version 1 manifest and the source `epoch/revision`.
2. Every input file must resolve inside the selected workspace.
3. The AI reads only the staged GDD and rubric and returns schema-constrained JSON.
4. Node validates three dimensions and writes private Progression, Problem, and Result artifacts.
5. Evaluate mode starts the human rating Web and updates the Result in place.
6. Each dimension combines AI 70% and human 30%; the final score weights dimensions 30%, 40%, and 30%.

Baseline and compare modes call the AI sequentially and do not start the Web or create evaluation documents. Statistics include mean, sample standard deviation, minimum, and maximum. Comparison reports current mean minus baseline mean and configuration changes, without PASS/FAIL or regression claims.

## Data

- Evaluation state is stored under the supplied run root.
- Human rating data is local to the run root.
- A repeated submission from the same browser updates its prior rating.
- Free-text comments stay in the local data store and are not written to Markdown.
- Baselines bind the GDD state and content hash, provider, requested model, input hashes, and observed models.

## Verification

```bash
npm test
npm run check
```

Tests use temporary directories and do not invoke paid model calls.
