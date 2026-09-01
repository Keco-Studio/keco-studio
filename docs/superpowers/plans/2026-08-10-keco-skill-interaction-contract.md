# Keco Skill Interaction Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex and Claude Keco Skills present a concise, language-consistent interaction while separating static plans, mutable run state, and execution evidence with backwards-compatible recovery.

**Architecture:** Add one byte-equivalent interaction contract to each plugin, link every user-facing Keco workflow to it, and extend the existing BuildPlan/RunContext/status/evidence contracts instead of introducing a second execution engine. Prompt contracts control what the agent says; Python validators and Jest fixtures prevent runtime fields from leaking into new Plans and prevent invalid checkpoints from being accepted.

**Tech Stack:** Markdown Skill contracts, Python 3 offline validators, JSON fixtures, Jest/TypeScript plugin contract tests, Prettier.

---

## File Map

- Create `plugins/keco-codex/references/interaction-contract.md`: Codex copy of the shared user-language, intent-summary, progress, blocker, and resume contract.
- Create `plugins/keco-claude/references/interaction-contract.md`: Claude copy; tests require byte equality with the Codex copy.
- Modify `plugins/keco-codex/skills/keco-build-tables-from-document/SKILL.md` and `references/execution-policy.md`: apply the interaction contract to BuildPlan preview, confirmation, blocked states, and safe resume.
- Modify `plugins/keco-claude/skills/keco-build-tables-from-document/SKILL.md` and `references/execution-policy.md`: same behavior for Claude.
- Modify `plugins/keco-codex/skills/keco-develop-godot-slice-v2/SKILL.md`, `references/orchestration-contract.md`, `references/slice-document-contract.md`, and `scripts/validate_run_context.py`: keep RunContext/status as mutable state and add checkpoint/resume fields without invalidating legacy V2 contexts.
- Modify the matching Claude V2 Skill, references, and validators under `plugins/keco-claude/`.
- Modify V1 Godot and PixelLab map Skill entry points in both plugins so API/auth and language behavior is consistent for all shipped Keco workflows.
- Modify `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_plan.py` and `plugins/keco-claude/scripts/validate_plan.py`: reject runtime/evidence fields from new JSON Plans while accepting the existing task shape.
- Create `tests/fixtures/plugins/keco-interaction-contract.json`: deterministic blocker, resume, language, and plan-boundary cases consumed by both plugin tests.
- Modify `tests/unit/plugins/keco-plugin.test.ts`, `tests/unit/plugins/keco-claude-plugin.test.ts`, and `tests/unit/plugins/keco-godot-slice-v2.test.ts`: add RED/GREEN contract assertions and validator fixtures.
- Modify `tests/fixtures/plugins/keco-godot-slice-v2-run.json` only to add the optional legacy-compatible checkpoint fixture fields after validator tests are written.

No application UI, host CLI renderer, MCP server implementation, database schema, or unrelated worktree file is in scope.

### Task 1: Add The Shared Interaction Contract

**Files:**

- Create: `plugins/keco-codex/references/interaction-contract.md`
- Create: `plugins/keco-claude/references/interaction-contract.md`
- Modify: the four entry Skills in each plugin (`keco-build-tables-from-document`, `keco-develop-godot-slice`, `keco-develop-godot-slice-v2`, `pixellab-map-assets`)
- Test: `tests/unit/plugins/keco-plugin.test.ts`, `tests/unit/plugins/keco-claude-plugin.test.ts`

- [ ] **Step 1: Write the failing contract test**

Add assertions that both plugin reference files exist, are byte-identical, and are linked by every entry Skill. Assert the shared file contains the exact required concepts: latest-user-language selection, preserved technical identifiers, `Goal/Source/Scope/Success/Next`, the blocker fields `Status`, `Blocked at`, `Completed`, `Writes performed`, `Why`, `User action`, `Resume from`, `Checkpoint`, `Revalidation`, and the `running -> paused_with_checkpoint -> user_action -> revalidate -> resume` transition.

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
```

Expected: FAIL because the reference files and links do not exist.

- [ ] **Step 2: Add the byte-equivalent reference files**

Create both files with the same ASCII Markdown content:

```markdown
# Keco User Interaction Contract

## Language

Use the latest substantive user request to select the response language. Use it for headings, summaries, questions, progress, blockers, and final results. Preserve tool names, field labels, IDs, code, enum values, error codes, and verbatim source quotations.

## Intent Summary

Before an expensive operation, confirmation prompt, or first development write, show Goal, Source, Scope, Success, and Next. Ask one focused question only when source, dependency, acceptance, or allowed-file ambiguity changes the result.

## Blocker Fields

Every blocked message reports Status, Blocked at, Completed, Writes performed, Why, User action, Resume from, Checkpoint, and Revalidation. Never request a secret in chat.

## Resume

Re-check the failed capability and compare source, plan, identity, schema, row, and dirty-path revisions. If unchanged, resume from the checkpoint without repeating settled questions or regenerating assets. If changed, ask only the affected decision.

## Host Boundary

Calling, Called, Explored, and Updated Plan labels are host CLI rendering and are not controlled by this Skill.
```

Link it from every entry Skill with the existing relative-reference style. The link text must identify it as the user interaction contract.

- [ ] **Step 3: Run the focused test**

Run the same Jest command. Expected: PASS with the two files equal and all eight entry Skills linked.

- [ ] **Step 4: Commit the isolated contract**

```bash
git add plugins/keco-codex/references/interaction-contract.md plugins/keco-claude/references/interaction-contract.md plugins/keco-codex/skills plugins/keco-claude/skills tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts
git commit -m "feat: add shared Keco interaction contract"
```

### Task 2: Separate BuildPlan From Execution State And Evidence

**Files:**

- Modify: both plugins' `keco-build-tables-from-document/SKILL.md`, `references/schema-design.md`, and `references/execution-policy.md`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`, `tests/unit/plugins/keco-claude-plugin.test.ts`
- Test fixture: `tests/fixtures/plugins/keco-interaction-contract.json`

- [ ] **Step 1: Write the failing Plan-boundary test**

Add a JSON plan with a valid task plus forbidden runtime fields:

```json
{
  "version": 2,
  "tasks": [
    {
      "id": "task-01",
      "files": ["data/hero.json"],
      "dependsOn": [],
      "servesEvaluations": ["eval-01"],
      "red": { "command": "python3 tests/red.py", "expected": "fails" },
      "green": { "command": "python3 tests/green.py", "expected": "passes" },
      "review": { "spec": true, "quality": true },
      "status": "in_progress",
      "commandOutput": "secret runtime output"
    }
  ],
  "runId": "run-01",
  "writeToken": "token-should-not-be-in-plan"
}
```

Run each plugin's Plan validator through its existing Jest helper. Expected: FAIL because the current validator accepts these fields.

- [ ] **Step 2: Implement the minimal boundary validator**

Add a shared forbidden-key set to both validators:

```python
FORBIDDEN_RUNTIME_KEYS = {
    "runId", "writeToken", "status", "currentTask", "retryCount",
    "checkpoint", "resumeFrom", "blockedAt", "commandOutput",
    "changedFiles", "evidence", "readBack", "runtimeLogs",
}
```

Reject those keys at the plan root and task level with the error `plan contains runtime or evidence state`. Keep the existing required task checks unchanged. Do not reject document frontmatter `status` because it remains a legacy document lifecycle field validated by `validate_slice_documents.py`; only JSON execution plans and task bodies are subject to the new rule.

Update both BuildPlan references to state that execution IDs, checkpoint state, and evidence are sidecars, not plan fields. Update both V2 orchestration and slice-document references to state that task completion is marked by Markdown checkboxes in `docs/superpowers/plans/<slice-id>.md`; runtime status remains internal evidence.

- [ ] **Step 3: Run the boundary tests**

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts
```

Expected: PASS for rejection of the new invalid fixture and PASS for existing valid plan fixtures.

- [ ] **Step 4: Commit the Plan boundary**

```bash
git add plugins/keco-codex/skills/keco-build-tables-from-document plugins/keco-codex/skills/keco-develop-godot-slice-v2 plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_plan.py plugins/keco-claude/skills/keco-build-tables-from-document plugins/keco-claude/skills/keco-develop-godot-slice-v2 plugins/keco-claude/scripts/validate_plan.py tests/fixtures/plugins/keco-interaction-contract.json tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts
git commit -m "feat: separate Keco plans from runtime state"
```

### Task 3: Add Checkpoint And Blocker Recovery Contracts

**Files:**

- Modify: both plugins' V2 `references/orchestration-contract.md`, `references/slice-document-contract.md`, and `SKILL.md`
- Modify: both plugins' table `references/execution-policy.md` and `SKILL.md`
- Modify: both V2 `scripts/validate_run_context.py`
- Create: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_interaction_checkpoint.py`
- Create: `plugins/keco-claude/scripts/validate_interaction_checkpoint.py`
- Modify: `tests/fixtures/plugins/keco-godot-slice-v2-run.json`, `tests/fixtures/plugins/keco-interaction-contract.json`, and the three plugin test files

- [ ] **Step 1: Write the failing checkpoint tests**

Add a checkpoint fixture with this shape:

```json
{
  "version": 1,
  "status": "paused",
  "blockedAt": "pixellab-capability-check",
  "completed": ["source-discovery", "plan-review"],
  "writesPerformed": [],
  "userAction": "Configure the PixelLab connection outside chat",
  "resumeFrom": "execution-preflight",
  "checkpoint": {
    "runId": "run-01",
    "planRevision": "plan-03",
    "sourceRevisions": { "gdd": "12" }
  },
  "revalidate": ["pixellab-capability", "gdd-revision", "dirty-paths"]
}
```

Test that the validator accepts this safe paused state, rejects a missing `resumeFrom`, rejects a non-empty `writesPerformed` with `status: blocked_before_write`, and rejects any key-like field or secret-looking value. Expected: FAIL because no checkpoint validator or contract assertions exist.

- [ ] **Step 2: Implement the checkpoint validator**

The validator must accept `status: running|paused|resuming|completed`, require `blockedAt`, `userAction`, `resumeFrom`, `checkpoint`, and `revalidate` when paused, and require `writesPerformed` to be an empty list for `blocked_before_write`. It must reject keys named `apiKey`, `API_KEY`, `secret`, `tokenValue`, or `credential` and reject values matching common provider key prefixes. It must print `checkpoint valid` on success and a stable error on failure.

Keep `validate_run_context.py` backwards-compatible: legacy V2 contexts without `interaction` remain valid; new contexts may carry an optional `interaction` object validated by the checkpoint script.

- [ ] **Step 3: Add the recovery wording to both Skills**

Every table and Godot Skill must require the exact user-facing fields below, translated to the active user language while retaining field names in examples:

```text
Status: execution paused
Blocked at: <failed boundary>
Completed: <safe completed work>
Writes performed: <none or partial scope>
Why: <specific cause>
User action: <one action; never paste a secret>
Resume from: <stage>
Checkpoint: <non-secret identifiers>
Revalidation: <checks before resume>
```

Add explicit resume behavior: retry only the failed boundary, revalidate source/plan/identity/dirty paths, and do not repeat settled questions when unchanged. State that any development write before a blocker is `partial`, not `blocked_before_write`.

- [ ] **Step 4: Run checkpoint tests**

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts
```

Expected: PASS for valid paused, invalid secret, invalid partial, and legacy RunContext cases.

- [ ] **Step 5: Commit recovery contracts**

```bash
git add plugins/keco-codex/skills/keco-develop-godot-slice-v2 plugins/keco-codex/skills/keco-build-tables-from-document plugins/keco-claude/skills/keco-develop-godot-slice-v2 plugins/keco-claude/skills/keco-build-tables-from-document tests/fixtures/plugins/keco-godot-slice-v2-run.json tests/fixtures/plugins/keco-interaction-contract.json tests/unit/plugins
git commit -m "feat: add resumable Keco blocker checkpoints"
```

### Task 4: Normalize User-Facing Language And Progress

**Files:**

- Modify: the eight entry `SKILL.md` files in `plugins/keco-codex/skills/` and `plugins/keco-claude/skills/`
- Modify: both table execution policies and both V2 orchestration contracts
- Modify: both plugin contract test files

- [ ] **Step 1: Write the failing language/progress assertions**

Assert that every entry Skill links the interaction contract and contains these rules: latest substantive user request selects the language, headings and blockers follow it, technical identifiers remain unchanged, and progress contains completed/current/next/blocker only. Assert that the table preview requires the user-language headings `Source`, `New tables`, `Relationships`, `Assumptions and warnings`, and `Execution` only as semantic section names that are translated in rendered user prose; raw tool payloads are excluded from the default preview.

Run the focused plugin test command and expect FAIL for missing language/progress clauses.

- [ ] **Step 2: Add the concise progress and intent contract**

At each workflow entry, add the shared contract link and a short local rule:

```text
Before expensive or mutating work, summarize Goal, Source, Scope, Success, and Next in the user's language. Show only outcome progress by default. Keep IDs, hashes, write tokens, raw MCP arguments, and evidence in the machine artifacts or detail view.
```

Use the existing table confirmation gate and Godot ambiguity gate; do not introduce an extra question for mechanically consistent read-only discovery.

- [ ] **Step 3: Run language/progress tests**

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts
```

Expected: PASS with all eight entry Skills linked and all language/progress clauses present.

- [ ] **Step 4: Commit interaction wording**

```bash
git add plugins/keco-codex/skills plugins/keco-claude/skills tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts
git commit -m "feat: normalize Keco user-facing progress"
```

### Task 5: Verify Cross-Package Compatibility And Safety

**Files:**

- Modify: `tests/unit/plugins/keco-plugin.test.ts`, `tests/unit/plugins/keco-claude-plugin.test.ts`, `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify only when required by a failing focused assertion: the two plugin `README.md` files and the two plugin manifests

- [ ] **Step 1: Run the complete focused plugin test suite before claiming completion**

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-claude-plugin.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-godot-snapshot.test.ts
```

Expected: all focused plugin tests pass with no failures.

- [ ] **Step 2: Run every offline validator against retained fixtures**

```bash
python3 plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_run_context.py tests/fixtures/plugins/keco-godot-slice-v2-run.json
python3 plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_plan.py tests/fixtures/plugins/keco-godot-slice-v2-plan.json
python3 plugins/keco-codex/skills/keco-develop-godot-slice-v2/scripts/validate_eval_report.py tests/fixtures/plugins/keco-godot-slice-v2-report.json
```

Expected: each command exits `0`; the invalid Plan and invalid checkpoint tests fail only inside their negative assertions.

- [ ] **Step 3: Check formatting and package scope**

```bash
npx --no-install prettier --check plugins/keco-codex/references/interaction-contract.md plugins/keco-claude/references/interaction-contract.md docs/superpowers/plans/2026-08-10-keco-skill-interaction-contract.md
git diff --check
git status --short
```

Expected: Prettier passes, no whitespace errors, and the diff contains only the planned plugin, validator, fixture, test, and contract files. Existing user changes remain unstaged.

- [ ] **Step 4: Run the repository plugin test subset**

```bash
npm run test:unit -- --runInBand tests/unit/plugins
```

Expected: the plugin test subset passes. Report unrelated existing failures separately; do not change application UI files to make this Skill contract pass.

- [ ] **Step 5: Commit verification-only adjustments**

```bash
git add tests/unit/plugins tests/fixtures/plugins plugins/keco-codex plugins/keco-claude
git commit -m "test: verify Keco interaction compatibility"
```

## Plan Self-Review

### Spec coverage

- Language consistency: Task 1 and Task 4.
- Intent summary and progressive disclosure: Task 1 and Task 4.
- Static Plan ownership: Task 2.
- Mutable checkpoint and blocker fields: Task 3.
- API Key/OAuth/Godot/PixelLab recovery: Task 3 and its fixtures.
- Legacy compatibility: Task 2, Task 3, and Task 5.
- Codex/Claude synchronization: Task 1 and Task 5.
- Host CLI boundary: explicitly documented in the Skill contract; no implementation task claims to change it.
- Safety and evidence gates: Task 2, Task 3, and Task 5 preserve existing validators and focused tests.

### Placeholder scan

This plan contains no `TBD`, `TODO`, or unspecified implementation step. Every command has an expected outcome, and every modified file has a named responsibility.

### Type and contract consistency

- `blocked_before_write` is reserved for zero development writes; any development mutation before a blocker is `partial`.
- `RunState` owns mutable task and recovery status; Plan JSON and Markdown do not.
- `TaskResult` and `EvalReport` own command/read-back/runtime evidence; Plan does not.
- Legacy V2 `RunContext` remains valid when it lacks the optional interaction block.
