# MCP GDD And Game Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing project GDD generation job through MCP and replace the game evaluation score with a fixed `artStyle` 50 plus `playerFun` 50 model.

**Architecture:** Extend `gds-tools.ts` with typed start/read/cancel wrappers over the existing project GDD REST job, then update both mirrored GDS skills and contracts. Replace the evaluation profile, scorer, validator, fixtures, and contracts in place while retaining top-level JSON `version: 1`; keep risk gates non-scoring and append progress through one focused Python helper.

**Tech Stack:** TypeScript, Deno MCP SDK, Zod, Python 3 standard library, Jest.

## Global Constraints

- Keep evaluation JSON at top-level `version: 1`.
- Score only `artStyle` (50) and `playerFun` (50); no other field contributes points.
- Reuse the existing project GDD API and worker; do not implement another generator.
- Keep Claude and human reviews separate and never combine their scores.
- Keep Skill Markdown and YAML ASCII-only.
- Preserve unrelated UI and historical design documents.
- Preserve user-owned untracked files and unrelated worktree changes.

---

### Task 1: Project GDD MCP Tools

**Files:**
- Modify: `supabase/functions/mcp/gds-tools.test.ts`
- Modify: `supabase/functions/mcp/gds-tools.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`

**Interfaces:**
- Consumes: existing `POST/GET/DELETE /api/projects/{projectId}/gdd-generation-jobs` application routes through `callKecoApp`.
- Produces: `generate_project_gdd`, `get_project_gdd_generation`, and `cancel_project_gdd_generation` MCP tools returning a bounded public project GDD job.

- [ ] **Step 1: Write failing registration, schema, route, projection, and telemetry tests**

Add the three names to `expectedNames`; assert account mode requires `projectId`, project mode rejects it, generation forwards:

```ts
{
  method: "POST",
  path: "/api/projects/11111111-1111-4111-8111-111111111111/gdd-generation-jobs",
  idempotencyKey: "gdd-request-1234",
  body: { designSystemId, versionId, mode: "professional", creativeBrief: "..." },
}
```

Assert poll uses `GET`, cancel uses `DELETE`, and failed jobs expose only `{ code: "GDD_GENERATION_FAILED", message: "Project GDD generation failed." }`.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts
npx jest --runInBand tests/unit/mcp/capabilities-probe.test.ts
```

Expected: failures report missing project GDD MCP tools and outdated capability counts.

- [ ] **Step 3: Implement the minimal typed wrappers and public projection**

Add one `publicGddJob()` whitelist for:

```ts
[
  "id", "project_id", "design_system_id", "version_id", "status", "phase",
  "mode", "contract_version", "attempt_count", "max_attempts", "available_at",
  "completed_at", "output_document_id", "output_document_name",
  "output_folder_id", "output_table_ids", "output_table_names",
  "applied_rule_ids", "omitted_rule_ids", "generation_series_id",
  "generation_revision", "resource_change_summary", "maps",
]
```

Register the three strict schemas, use `projectIdFor()`, encode route identities, forward idempotency separately from the body, and classify read/write tools in `server.ts`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2. Expected: all selected Deno and Jest tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add supabase/functions/mcp/gds-tools.ts supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts tests/unit/mcp/capabilities-probe.test.ts
git commit -m "feat(mcp): expose project GDD generation"
```

### Task 2: GDS Skill And Contract Workflow

**Files:**
- Modify: `plugins/keco-codex/skills/keco-manage-game-design-system/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-manage-game-design-system/SKILL.md`
- Modify: `plugins/keco-codex/references/gds-map-mcp-contract.md`
- Modify: `plugins/keco-claude/references/gds-map-mcp-contract.md`
- Modify: `tests/unit/plugins/keco-gds-map-plugin.test.ts`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Consumes: Task 1 MCP tool names and result identities.
- Produces: byte-identical Claude/Codex instructions for binding, generation polling, generated-document read-back, and cancellation.

- [ ] **Step 1: Write failing plugin synchronization and workflow tests**

Require both plugin copies to mention all three project GDD tools and the sequence:

```text
DISCOVER -> READ_GDS -> PLAN -> MUTATE_GDS -> POLL_GDS -> BIND
  -> GENERATE_GDD -> POLL_GDD -> READ_GDD -> REPORT
```

Require `output_document_id` to be read with `read_document`, terminal job handling, and no queued/running completion claim.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/plugins/keco-gds-map-plugin.test.ts tests/unit/plugins/keco-plugin.test.ts
```

Expected: missing tool and workflow assertions fail.

- [ ] **Step 3: Update ASCII-only skills and shared contracts**

Document exact account/project schemas, binding prerequisite, idempotency behavior, terminal statuses, cancel behavior, generated result IDs, and `read_document` read-back. Apply byte-identical content to Claude and Codex copies.

- [ ] **Step 4: Run tests and verify GREEN**

Run Step 2. Expected: both suites pass and ASCII validation remains green.

- [ ] **Step 5: Commit Task 2**

```bash
git add plugins/keco-codex/skills/keco-manage-game-design-system/SKILL.md plugins/keco-claude/skills/keco-manage-game-design-system/SKILL.md plugins/keco-codex/references/gds-map-mcp-contract.md plugins/keco-claude/references/gds-map-mcp-contract.md tests/unit/plugins/keco-gds-map-plugin.test.ts tests/unit/plugins/keco-plugin.test.ts
git commit -m "docs(keco): route GDD generation through MCP"
```

### Task 3: Fixed Art Style And Player Fun Evaluation

**Files:**
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py`
- Modify: `tests/fixtures/plugins/keco-game-evaluation-evidence.json`
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`

**Interfaces:**
- Consumes: evidence with identity, `claudeReview.items`, mandatory evaluations, findings, and source references.
- Produces: a `version: 1` profile and report whose only scored dimensions are `artStyle` and `playerFun`, plus an independent empty `humanReview`.

- [ ] **Step 1: Replace evaluation tests and fixture first**

Assert the profile has exactly these item maxima:

```ts
{
  artStyle: { styleConsistency: 20, assetQualityAndFit: 15, uiReadabilityAndLayout: 10, visualFeedbackAndEmotion: 5 },
  playerFun: { coreLoopAppeal: 20, meaningfulChoices: 15, feedbackPacingAndGoals: 10, motivationToContinue: 5 },
}
```

Assert complete scores sum to 100, any `not_evaluated` item makes dimension and total scores null, technical evidence does not alter points, over-limit/duplicate/unknown items fail, risk gates still apply, and scorer output has empty human slots.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts
```

Expected: old 80+20 profile and questionnaire-based scorer fail the new assertions.

- [ ] **Step 3: Implement the fixed profile and scorer**

Generate immutable metrics containing `id`, `dimension`, `name`, `max`, anchors, and required evidence. Validate all eight Claude items with:

```json
{
  "status": "evaluated",
  "score": 12,
  "reason": "Evidence-bounded explanation",
  "evidence": ["slice-eval:combat-01"],
  "limitations": ["No target-player session"],
  "nextIteration": "Run a five-player comparison"
}
```

Sum only Claude item scores. Keep coverage, mandatory evaluation, P0-P3, stage threshold, critical evidence, and decision status separate from score calculation. Always emit null `humanReview` slots.

- [ ] **Step 4: Implement strict report validation**

Recompute item, dimension, and total sums; reject invalid identity, maxima, evidence, review status, human totals, and decision contradictions. Allow either the scorer's empty human slots or a coherent manually completed human review, but never create a combined score.

- [ ] **Step 5: Run tests and verify GREEN**

Run Step 2. Expected: all evaluation tests pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game/scripts tests/fixtures/plugins/keco-game-evaluation-evidence.json tests/unit/plugins/keco-game-evaluation.test.ts
git commit -m "feat(keco): score art style and player fun"
```

### Task 4: Evaluation Contracts, Progress Audit, And End-To-End Verification

**Files:**
- Create: `plugins/keco-codex/skills/keco-evaluate-game/scripts/progress_log.py`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/references/rubric.md`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/references/report-contract.md`
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/agents/openai.yaml`
- Modify: `tests/fixtures/plugins/keco-game-evaluation-skill-evals.json`
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Consumes: Task 3 profile, evidence, and report values.
- Produces: append-only `progress.jsonl`, Chinese `progress.md`, and current ASCII skill contracts describing the true Claude boundary and two-dimension score.

- [ ] **Step 1: Write failing progress and documentation tests**

Require each script run to append a structured event with `segment`, `goal`, `inputs`, `execution`, `expectedOutput`, `actualResult`, `meaning`, and `nextImpact`; require Markdown to contain Chinese headings and indented JSON. Require a second invocation to retain the first event. Require current skill text to prohibit automatic human scoring and unsupported Claude claims.

- [ ] **Step 2: Run tests and verify RED**

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts tests/unit/plugins/keco-plugin.test.ts
```

Expected: missing progress files/helper and old rubric assertions fail.

- [ ] **Step 3: Implement append-only progress and update current contracts**

Add `progress_log.py` using append mode for both files. Derive the progress directory from each command's output path and append actual parsed input/output summaries. Rewrite current Skill, rubric, report contract, metadata, and trigger fixtures in ASCII while keeping user-facing runtime output in the user's language.

- [ ] **Step 4: Run direct Python chain**

Create a temporary directory and run:

```bash
evaluation_tmp=$(mktemp -d)
python3 plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py --game-id village-rpg --stage beta --genre rpg --gdd-revision sha256:gdd123 --build-hash sha256:build123 --locked-at 2026-08-26T00:00:00Z --output "$evaluation_tmp/profile.json"
python3 plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py --profile "$evaluation_tmp/profile.json" --evidence tests/fixtures/plugins/keco-game-evaluation-evidence.json --output "$evaluation_tmp/report.json"
python3 plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py "$evaluation_tmp/report.json"
```

Expected: all commands exit zero; report total is 100 for the complete fixture; progress has three ordered events.

- [ ] **Step 5: Run focused verification and verify GREEN**

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-gds-map-plugin.test.ts tests/unit/mcp/capabilities-probe.test.ts
npx deno test --config supabase/functions/mcp/deno.json --allow-env --allow-net supabase/functions/mcp/gds-tools.test.ts supabase/functions/mcp/server.test.ts supabase/functions/mcp/account-tools.test.ts
npm run typecheck
npm run check:mcp
```

Expected: every command exits zero.

- [ ] **Step 6: Commit Task 4**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game tests/fixtures/plugins/keco-game-evaluation-skill-evals.json tests/unit/plugins/keco-game-evaluation.test.ts tests/unit/plugins/keco-plugin.test.ts docs/superpowers/plans/2026-08-26-mcp-gdd-and-game-evaluation.md
git commit -m "feat(keco): complete evidence based game evaluation"
```

### Task 5: Branch Delivery And Plugin Refresh

**Files:**
- No product files expected.
- Inspect repository/plugin scripts before selecting refresh commands.

**Interfaces:**
- Consumes: verified feature branch commits.
- Produces: pushed branch, PR, green required checks, merged PR, green post-merge `main`, and refreshed Windows/WSL plugin installations.

- [ ] **Step 1: Verify clean diff and complete required checks**

Run focused tests, typecheck, MCP check, `git diff --check`, and inspect `git status` and branch commit range.

- [ ] **Step 2: Push and create PR**

```bash
git push -u origin feat/mcp-gdd-evaluation
gh pr create --base main --head feat/mcp-gdd-evaluation --title "feat: generate GDD through MCP and revise game evaluation" --body "Expose durable project GDD generation through MCP and replace the game evaluation score with fixed artStyle and playerFun dimensions."
```

- [ ] **Step 3: Poll PR checks and repair failures**

Resolve `pr_number=$(gh pr view --json number --jq .number)`, then use `gh pr checks "$pr_number" --watch` or bounded polling. For any failure, inspect logs, add a regression test where applicable, fix, rerun local verification, commit, and push. Repeat until required checks are green.

- [ ] **Step 4: Merge and verify post-merge checks**

Merge through the repository's accepted PR method, then poll the merge commit's workflow runs until terminal success. Do not update installed plugins from an unverified merge.

- [ ] **Step 5: Refresh Windows and WSL plugins**

Inspect the repository's plugin install/cachebuster scripts and current installation targets. Run the supported refresh commands against merged `main`, verify installed manifests and skill files match the merge commit, and report both environments separately.
