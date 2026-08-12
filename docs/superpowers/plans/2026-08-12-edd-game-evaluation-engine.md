# EDD Game Evaluation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a triggerable Keco Codex Skill that creates locked 80+20 evaluation profiles, scores structured playtest evidence, enforces P0-P3 stage gates, and emits validated `GameEvaluationReport` JSON.

**Architecture:** Add an independent `keco-evaluate-game` Skill to the existing Keco plugin so full game/milestone evaluation does not overload the Slice development workflow. Keep judgment and orchestration in a concise `SKILL.md`, move the fixed rubric and report contract to references, and implement profile creation, deterministic scoring, and report validation as dependency-free Python scripts. Exercise the Skill and scripts through one focused Jest contract suite and JSON fixtures.

**Tech Stack:** Codex Skills (Markdown/YAML), Python 3 standard library, JSON, Jest/TypeScript plugin-contract tests.

---

## File Structure

- Create `plugins/keco-codex/skills/keco-evaluate-game/SKILL.md`: implicit and explicit trigger routing, evaluation workflow, evidence boundaries, and output rules.
- Create `plugins/keco-codex/skills/keco-evaluate-game/agents/openai.yaml`: Codex UI metadata and implicit invocation policy.
- Create `plugins/keco-codex/skills/keco-evaluate-game/references/rubric.md`: fixed 80-point rubric, seven genre templates, subjective contribution, questionnaire, and severity/stage rules.
- Create `plugins/keco-codex/skills/keco-evaluate-game/references/report-contract.md`: profile, evidence-input, and report JSON contracts.
- Create `plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py`: generate and validate a locked evaluation profile.
- Create `plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py`: deterministic aggregation, confidence, coverage, risks, and stage decision.
- Create `plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py`: fail-closed report validation.
- Create `tests/unit/plugins/keco-game-evaluation.test.ts`: Skill structure, trigger cases, profile, scoring, and validator tests.
- Create `tests/fixtures/plugins/keco-game-evaluation-skill-evals.json`: positive, boundary, pressure, and negative trigger prompts.
- Create `tests/fixtures/plugins/keco-game-evaluation-evidence.json`: complete deterministic scoring input.
- Modify `tests/unit/plugins/keco-plugin.test.ts`: include the new Skill in shared entry-Skill and ASCII checks.
- Modify `plugins/keco-codex/.codex-plugin/plugin.json`: advertise the explicit evaluation prompt and apply the local plugin cachebuster at deployment.

### Task 1: Skill Trigger And Package Contract

**Files:**
- Create: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Create: `tests/fixtures/plugins/keco-game-evaluation-skill-evals.json`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/SKILL.md`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/agents/openai.yaml`
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`

- [ ] **Step 1: Write the failing Skill contract test**

Add a focused test that requires:

```ts
expect(skill).toMatch(/^---\nname: keco-evaluate-game\n/);
expect(skill).toMatch(/^description: Use when[^\n]*(?:score|evaluate)[^\n]*(?:game|Godot)/m);
expect(skill).toContain('[shared interaction contract](../../references/interaction-contract.md)');
expect(skill).toMatch(/80[\s\S]*20[\s\S]*100-point/i);
expect(skill).toMatch(/Slice[\s\S]*Alpha[\s\S]*Beta[\s\S]*Release Candidate[\s\S]*Release/i);
expect(skill).toMatch(/manual_required[\s\S]*visual[\s\S]*experience/i);
expect(metadata).toMatch(/default_prompt: "Use \$keco-evaluate-game/);
expect(metadata).toMatch(/allow_implicit_invocation: true/);
```

The fixture contains these routing expectations:

```json
{
  "cases": [
    {"id":"full-beta","expectedSkill":"keco-evaluate-game","prompt":"Run a Beta-stage EDD game evaluation for the Keco project and produce a 100-point report."},
    {"id":"slice-quick","expectedSkill":"keco-evaluate-game","prompt":"Run a quick EDD evaluation for the combat gameplay slice that was just completed."},
    {"id":"explicit","expectedSkill":"keco-evaluate-game","prompt":"Use $keco-evaluate-game to score this Godot game for Release."},
    {"id":"implementation","expectedSkill":"keco-develop-godot-slice-v2","prompt":"Implement the next Godot gameplay slice from the GDD."},
    {"id":"analysis-only","expectedSkill":"none","prompt":"Explain the main arguments of the EDD paper; do not evaluate a game."}
  ]
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts tests/unit/plugins/keco-plugin.test.ts
```

Expected: FAIL because `keco-evaluate-game/SKILL.md` and metadata do not exist and the entry-Skill list does not contain the new Skill.

- [ ] **Step 3: Initialize and minimally implement the Skill package**

Run the official initializer:

```bash
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  keco-evaluate-game \
  --path plugins/keco-codex/skills \
  --resources scripts,references \
  --interface display_name="Evaluate Keco Game" \
  --interface short_description="Score game quality with traceable EDD evidence" \
  --interface default_prompt='Use $keco-evaluate-game to evaluate my Keco Godot game for Beta.'
```

Replace the generated `SKILL.md` with an ASCII-only workflow that:

```text
INTAKE -> PROFILE -> EVIDENCE_PLAN -> RUNTIME_EVIDENCE
-> PLAYTEST_EVIDENCE -> SCORE -> VALIDATE -> REPORT -> RETEST
```

It must distinguish full milestone scoring from Slice implementation, require current build identity and fixed profile inputs, refuse to invent missing human evidence, and name all bundled scripts/references. Add the new default prompt to the plugin manifest and the new folder to `ENTRY_SKILLS`.

- [ ] **Step 4: Run the tests and Skill validator for GREEN**

Run:

```bash
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-evaluate-game
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts tests/unit/plugins/keco-plugin.test.ts
```

Expected: Skill validation succeeds and both Jest suites pass the package/trigger contract assertions introduced in this task.

- [ ] **Step 5: Commit the triggerable Skill shell**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game \
  plugins/keco-codex/.codex-plugin/plugin.json \
  tests/unit/plugins/keco-game-evaluation.test.ts \
  tests/unit/plugins/keco-plugin.test.ts \
  tests/fixtures/plugins/keco-game-evaluation-skill-evals.json
git commit -m "feat(keco): add game evaluation skill entry"
```

### Task 2: Locked 80+20 Evaluation Profiles

**Files:**
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/references/rubric.md`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/references/report-contract.md`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py`

- [ ] **Step 1: Write failing profile-generation tests**

The tests execute:

```bash
python3 plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py \
  --game-id village-rpg \
  --stage beta \
  --genre rpg \
  --gdd-revision sha256:gdd123 \
  --build-hash sha256:build123 \
  --locked-at 2026-08-12T12:00:00Z \
  --output profile.json
```

Assert that general groups total 80, specialized items total 20, total weight is 100, `subjectiveWeight` is `0.2`, stage thresholds are 60/70/80/85, every item has stable ID/weight/anchors/evidence requirements, and the profile is bound to the supplied GDD/build identities. Add a failure test where a custom specialized file replaces more than 10 points and expect exit 1 with `custom specialized weight must not exceed 10`.

- [ ] **Step 2: Run profile tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "profile"
```

Expected: FAIL because the profile generator and rubric references are absent.

- [ ] **Step 3: Implement the fixed rubric and profile generator**

Implement standard-library Python constants for the eight general groups and seven genres (`action`, `rpg`, `simulation-management`, `puzzle`, `visual-novel-narrative`, `strategy`, `platformer`). Accept optional `--specialized-config` JSON shaped as:

```json
{
  "replaceMetricIds": ["specialized.rpg.quest-exploration"],
  "customMetrics": [
    {
      "id": "specialized.project.npc-economy-link",
      "name": "NPC relationships change economy strategy",
      "weight": 4,
      "gddSource": "GDD-6.3",
      "anchors": {"1":"No observable change","3":"Local change","5":"Several viable strategies"},
      "requiredEvidence": ["choice distribution", "player event"]
    }
  ]
}
```

Reject unknown replacement IDs, duplicate IDs, invalid anchors, non-integer weights, totals other than 20, custom weight above 10, or profiles not totaling 100. Write a deterministic JSON document with `sort_keys=True` and no generated randomness.

- [ ] **Step 4: Verify profile GREEN and invalid cases**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "profile"
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-evaluate-game
```

Expected: all profile tests pass and the Skill remains valid.

- [ ] **Step 5: Commit the rubric/profile increment**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game/references \
  plugins/keco-codex/skills/keco-evaluate-game/scripts/create_evaluation_profile.py \
  tests/unit/plugins/keco-game-evaluation.test.ts
git commit -m "feat(keco): generate locked game evaluation profiles"
```

### Task 3: Deterministic Scoring And Stage Decisions

**Files:**
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Create: `tests/fixtures/plugins/keco-game-evaluation-evidence.json`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py`

- [ ] **Step 1: Write failing score and gate tests**

Create a complete fixture with one result per profile item:

```json
{
  "version": 1,
  "profileId": "village-rpg-beta-v1",
  "buildHash": "sha256:build123",
  "itemResults": [
    {"metricId":"general.core.core-loop","status":"evaluated","rating":4,"evidence":["session:s1"]}
  ],
  "subjectiveResults": [
    {"groupId":"general.core","ratings":[8,7,8,9,6],"evidence":["questionnaire:q1"]}
  ],
  "mandatoryEvaluations": [
    {"evalId":"core-flow","status":"passed","evidence":["KECO_EVAL {...}"]}
  ],
  "findings": []
}
```

Tests must prove:

```ts
expect(report.score.total).toBeCloseTo(expected, 2);
expect(report.score.generalWeight).toBe(80);
expect(report.score.specializedWeight).toBe(20);
expect(report.coverage).toBe(1);
expect(report.decision.status).toBe('passed');
```

Add cases for: subjective contribution exactly 20 percent; `not_applicable` normalization; `not_evaluated` lowering coverage without becoming zero; low confidence under three players; high disagreement; duplicate primary issue rejection; P0 failure; managed Beta P1 producing `conditional`; RC P1 failure; mandatory-evaluation failure; group minimum failure; and below-70-percent coverage producing `partial` with no formal stage pass.

- [ ] **Step 2: Run scoring tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "score|decision|coverage|confidence"
```

Expected: FAIL because `score_game_evaluation.py` is missing.

- [ ] **Step 3: Implement minimal deterministic scoring**

The script accepts `--profile`, `--evidence`, and `--output`. Implement:

```python
rating_rate = rating / 5.0
experience_group_rate = structured_rate * 0.8 + subjective_mean / 10.0 * 0.2
```

Calculate item-weighted structured group rates, group scores, provisional total,
weighted evidence coverage, player summary statistics, confidence/disagreement
flags, severity counts, critical group minimums, and the fixed decision order.
Do not infer ratings or evidence. Reject profile/build mismatches, duplicate metric
results, unknown metrics, ratings outside their range, evidence-less evaluated
results, duplicate issue IDs, or the same issue used as primary by multiple
metrics.

- [ ] **Step 4: Run all scoring tests for GREEN**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "score|decision|coverage|confidence"
```

Expected: all scoring and stage-gate cases pass.

- [ ] **Step 5: Commit scoring**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game/scripts/score_game_evaluation.py \
  tests/fixtures/plugins/keco-game-evaluation-evidence.json \
  tests/unit/plugins/keco-game-evaluation.test.ts
git commit -m "feat(keco): score game evaluation evidence"
```

### Task 4: Fail-Closed Game Evaluation Report Validation

**Files:**
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`
- Create: `plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py`

- [ ] **Step 1: Write failing validator tests**

Generate a report with the score script, then require the validator to accept it.
Mutate one property at a time and require a clean exit 1 without traceback for:

- total weights not equal to 100;
- score outside 0-100;
- coverage outside 0-1;
- Release passed below 85;
- RC/Release conditional status;
- passed report containing P0/P1;
- complete Release report below 100 percent coverage;
- missing evidence for an evaluated item;
- report profile/build hash mismatch;
- duplicated primary issue deduction;
- missing raw result references.

- [ ] **Step 2: Run validator tests and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "validator"
```

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement fail-closed validation**

Parse JSON with handled errors, require report version 1 and all contract fields,
recompute invariants that do not require the source profile, and reject internally
contradictory decisions. Print one JSON success object:

```json
{"ok":true,"status":"passed","stage":"beta","score":82.4,"coverage":1.0}
```

Write all failures as one concise stderr message and exit 1 or 2 without a
traceback.

- [ ] **Step 4: Run validator and complete Skill tests for GREEN**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-evaluate-game
```

Expected: focused suite passes and Skill validation succeeds.

- [ ] **Step 5: Commit report validation**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game/scripts/validate_game_evaluation_report.py \
  tests/unit/plugins/keco-game-evaluation.test.ts
git commit -m "feat(keco): validate game evaluation reports"
```

### Task 5: End-To-End Trigger Documentation And Plugin Deployment

**Files:**
- Modify: `plugins/keco-codex/skills/keco-evaluate-game/SKILL.md`
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `tests/unit/plugins/keco-game-evaluation.test.ts`

- [ ] **Step 1: Write failing end-to-end workflow assertions**

Require `SKILL.md` to document the exact user triggers and script chain:

```text
Use $keco-evaluate-game to run a Beta EDD evaluation for <Keco project>.
Run a Beta-stage EDD game evaluation for the Keco project <project name>.
Run a quick EDD evaluation for the combat-system gameplay slice that was just completed.
```

Require the workflow to create a profile before collecting scores, preserve
`KECO_EVAL` runtime evidence, mark visual/experience gaps `manual_required`, run
the report validator before claiming a stage result, and emit improvement/retest
records for failures.

- [ ] **Step 2: Run workflow assertions and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts -t "workflow|trigger"
```

Expected: FAIL on at least one missing end-to-end workflow or trigger assertion.

- [ ] **Step 3: Complete the concise Skill workflow**

Keep `SKILL.md` under 500 lines. Link directly to `rubric.md` and
`report-contract.md`; do not duplicate their tables. Include the exact script
commands, report destinations under `docs/keco-game-evaluations/<evaluationId>/`,
and the distinction between `GameEvaluationReport` and the existing Slice
`EvalReport`.

- [ ] **Step 4: Apply plugin cachebuster and verify the whole plugin**

Run:

```bash
python3 /home/ltt/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py \
  plugins/keco-codex
npx jest --runInBand tests/unit/plugins/keco-game-evaluation.test.ts \
  tests/unit/plugins/keco-plugin.test.ts \
  tests/unit/plugins/keco-godot-slice-v2.test.ts
python3 /home/ltt/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  plugins/keco-codex/skills/keco-evaluate-game
npm run typecheck
```

Expected: all focused plugin tests pass, Skill validation succeeds, and TypeScript
checking exits 0. Inspect `git diff --check` and verify only intended files are
staged.

- [ ] **Step 5: Reinstall the updated local plugin**

Read the marketplace name and reinstall:

```bash
python3 /home/ltt/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py \
  --marketplace-path .agents/plugins/marketplace.json
codex plugin add keco@keco-studio
```

If `codex plugin add` requires network or writes outside the workspace, request
the required approval. A new Codex thread is required to load the updated Skill.

- [ ] **Step 6: Commit the completed engine**

```bash
git add plugins/keco-codex/skills/keco-evaluate-game \
  plugins/keco-codex/.codex-plugin/plugin.json \
  tests/unit/plugins/keco-game-evaluation.test.ts \
  tests/unit/plugins/keco-plugin.test.ts \
  tests/fixtures/plugins/keco-game-evaluation-skill-evals.json \
  tests/fixtures/plugins/keco-game-evaluation-evidence.json
git commit -m "feat(keco): ship EDD game evaluation engine"
```

## Final Verification

- [ ] Run `git diff --check` and inspect the final commit file list.
- [ ] Run the focused Jest suites and `npm run typecheck` from a clean command invocation.
- [ ] Generate an RPG Beta profile and a report from the committed fixture.
- [ ] Validate the generated report with `validate_game_evaluation_report.py`.
- [ ] Confirm the user-facing trigger text and new-thread plugin reload requirement.
