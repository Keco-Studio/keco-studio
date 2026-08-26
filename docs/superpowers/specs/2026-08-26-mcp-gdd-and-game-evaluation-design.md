# MCP GDD And Game Evaluation Design

## Goal

Complete the project GDD generation workflow through the Keco MCP and replace
the current `keco-evaluate-game` 80+20 score with one fixed 100-point model:

- `artStyle`: 50 points
- `playerFun`: 50 points

The GDD generator remains the existing Keco application job and worker. The MCP
is a typed orchestration boundary, not a second generation implementation.

## Scope

This change covers:

- MCP tools to start, poll, and cancel project GDD generation;
- MCP-safe projection of project GDD job results;
- GDS skill instructions and the shared GDS MCP contract;
- the fixed two-dimension, eight-item game evaluation profile;
- separate Claude and human review structures;
- append-only evaluation progress artifacts;
- focused MCP, plugin, Python, and Jest contract tests.

This change does not modify unrelated UI, replace the existing GDD worker,
implement gameplay, or rewrite prior design records.

## MCP GDD Workflow

### Tools

Add three tools beside the existing Game Design System tools:

1. `generate_project_gdd`
   - Account endpoint input: `projectId`, `designSystemId`, `versionId`, `mode`,
     optional `creativeBrief`, and `idempotencyKey`.
   - Project endpoint input omits `projectId`.
   - Calls `POST /api/projects/{projectId}/gdd-generation-jobs` with the
     idempotency key.
   - Returns a bounded public job projection.
2. `get_project_gdd_generation`
   - Accepts `generationJobId` and account-mode `projectId`.
   - Calls `GET /api/projects/{projectId}/gdd-generation-jobs/{jobId}`.
   - Returns status, phase, output document/folder/table identities, map status,
     revision information, and a sanitized terminal error.
3. `cancel_project_gdd_generation`
   - Accepts the same identity as the read tool.
   - Calls `DELETE /api/projects/{projectId}/gdd-generation-jobs/{jobId}`.
   - Returns the bounded public job projection.

The tools never call an LLM directly. They reuse the application's existing
authorization, bound-GDS check, durable job, retry, validation, and persistence
behavior.

### Skill Sequence

`keco-manage-game-design-system` extends its current flow to support:

```text
DISCOVER -> READ_GDS -> PLAN -> MUTATE_GDS -> POLL_GDS -> BIND
  -> GENERATE_GDD -> POLL_GDD -> READ_GDD -> REPORT
```

The skill verifies the project binding before generation, polls until a terminal
status, then reads `output_document_id` through `read_document`. A queued or
running job is never reported as a completed GDD. Failure and cancellation are
reported without inventing a document. The final GDD becomes a valid source for
`keco-develop-godot-slice-v2`.

## Evaluation Score Model

The JSON contract continues to use top-level `version: 1`. Its scoring semantics
become the fixed model below. No compatibility adapter retains the old 80+20
weights.

| Dimension | Item | Maximum |
|---|---|---:|
| `artStyle` | `styleConsistency` | 20 |
| `artStyle` | `assetQualityAndFit` | 15 |
| `artStyle` | `uiReadabilityAndLayout` | 10 |
| `artStyle` | `visualFeedbackAndEmotion` | 5 |
| `playerFun` | `coreLoopAppeal` | 20 |
| `playerFun` | `meaningfulChoices` | 15 |
| `playerFun` | `feedbackPacingAndGoals` | 10 |
| `playerFun` | `motivationToContinue` | 5 |

The score contains exactly these two dimensions. Genre remains profile identity
metadata and does not select or change metrics.

### Claude Review

The scorer accepts an externally produced Claude review. It does not assume a
Claude MCP or model client exists. Each of the eight fixed items has:

- `status`: `evaluated` or `not_evaluated`;
- `score`: null when not evaluated, otherwise a number from zero through the
  item's maximum;
- `reason`;
- `evidence`: concrete references;
- `limitations`;
- `nextIteration`.

An evaluated item requires a score, reason, and evidence. A not-evaluated item
has a null score and must state its evidence limitation. The two dimension
scores and the 100-point total are emitted only when all eight items are
evaluated. Automated runtime success cannot supply or increase a `playerFun`
score. Without player records, Claude describes an evidence-bounded appeal
assessment and records the absence of observed player experience.

### Human Review

`humanReview` lives beside `claudeReview` in `report.json`:

```json
{
  "artStyle": {
    "score": null,
    "max": 50,
    "comment": null,
    "nextIteration": null
  },
  "playerFun": {
    "score": null,
    "max": 50,
    "comment": null,
    "nextIteration": null
  },
  "total": {
    "score": null,
    "max": 100
  }
}
```

The scorer always creates these empty slots and never derives them from Claude,
runtime, or questionnaire data. A human may later enter valid values; the report
validator checks those values but never merges them into the Claude score.

### Non-Scoring Acceptance Data

Coverage, mandatory evaluations, stability evidence, P0-P3 findings, and stage
gates remain in the report. They can make the decision partial, conditional,
failed, or blocked, but do not contribute points. A formal stage pass requires a
complete Claude score plus the applicable evidence and risk gates.

The report references current evidence identities when available:

- GDD revision;
- Roadmap;
- SourceSnapshot;
- Godot build hash;
- Slice EvalReport.

Absent histories remain absent. The workflow never reconstructs calls that were
not recorded.

## Progress Audit

Each evaluation directory contains:

```text
docs/keco-game-evaluations/<evaluationId>/
  profile.json
  evidence.json
  report.json
  progress.jsonl
  progress.md
```

The scripts append events in execution order. They never rewrite earlier audit
events. Every event records the task segment, goal, inputs, execution method,
expected output, actual result, concrete meaning, and effect on the next step.
`progress.jsonl` is machine-readable. `progress.md` is a Chinese readable mirror
using formatted JSON blocks and explanations based on actual values rather than
generic success text.

## Validation And Errors

The profile creator rejects any metric set other than the fixed two dimensions
and eight items. The scorer rejects unknown, duplicate, over-limit, unsupported,
or contradictory review items. The report validator recomputes dimension and
total sums, validates evidence and identity consistency, enforces empty default
human fields for scorer output, and checks non-scoring stage decisions.

MCP errors use existing safe error handling. Private worker diagnostics, bearer
tokens, provider payloads, and signed URLs are not returned. Idempotency conflicts
and stale project/GDS bindings stop the workflow and require a fresh read.

## Testing

Tests cover:

- registration and account/project schemas for all three GDD MCP tools;
- exact REST route, method, body, and idempotency forwarding;
- safe job projection and failure redaction;
- GDS skill and MCP contract synchronization;
- exact 50/50 profile weights and eight item identities;
- complete, partial, invalid, and over-limit Claude reviews;
- non-scoring risk and stage gates;
- empty and manually completed human review validation;
- append-only JSONL and Chinese Markdown progress;
- a direct profile to score to validate Python chain;
- focused MCP, plugin, and evaluation Jest suites.

## Acceptance Criteria

- A writable MCP client can create or select a GDS, bind its version, generate a
  project GDD, poll it, and read the generated document without using the UI.
- `keco-evaluate-game` exposes only `artStyle` and `playerFun` score dimensions.
- The eight fixed maximums total 100 exactly.
- Claude and human scores remain separate and are never automatically combined.
- Missing Claude evidence never becomes a fabricated score.
- Technical health and risks affect acceptance but never add score points.
- Existing historical design documents and unrelated UI remain unchanged.
