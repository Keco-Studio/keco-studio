# Keco Godot Evaluation-Driven Development Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Keco plugin Skill that deterministically orchestrates Keco-sourced data design, Godot implementation, and evaluation-driven runtime verification.

**Architecture:** A single implicitly invokable Skill owns the complete Keco-to-Godot slice state machine. Focused references define source precedence, plans, evaluations, MCP usage, and recovery; two Python scripts export and validate deterministic read-only JSON snapshots.

**Tech Stack:** Codex plugin manifests, Agent Skills, Markdown contracts, Python 3 standard library, Jest/TypeScript contract tests, Keco MCP, Godot MCP.

## Global Constraints

- Work on branch `skillsExtand`.
- Keep `keco-build-tables-from-document` narrowly scoped and unchanged unless a contract test exposes a real overlap.
- Do not bundle or declare a second Godot MCP server in `plugins/keco/.mcp.json`.
- Explicit Skill invocation authorizes one bounded slice without a second confirmation.
- Never automatically delete Keco tables, fields, or rows or perform destructive type conversions.
- Generated Godot snapshot files are deterministic, versioned, hash-verified, and never authoritative over Keco.
- Stop before writes when either Keco MCP or Godot MCP identity checks fail.
- Limit automatic repair to three iterations and never claim unsupported mouse black-box coverage.
- Preserve unrelated user changes, including the untracked QA report in the Keco Studio worktree.

---

### Task 1: Add Failing Plugin And Trigger Contracts

**Files:**
- Modify: `tests/unit/plugins/keco-plugin.test.ts`
- Create: `tests/fixtures/plugins/keco-godot-skill-evals.json`

**Interfaces:**
- Consumes: existing Keco plugin contract test helpers.
- Produces: executable requirements for the new Skill tree, trigger isolation, MCP ownership, state-machine references, and UI metadata.

- [ ] **Step 1: Add trigger fixtures**

Create JSON cases for explicit Keco-to-Godot development, latest-feedback development, generic continuation, document-only table generation, Godot-only debugging, analysis-only, and asset generation. Each case declares `expectedSkill` as either `keco-develop-godot-slice`, `keco-build-tables-from-document`, or `none`.

- [ ] **Step 2: Add failing structural tests**

Define `godotSkillRoot`, load the new Skill and references, and assert:

```ts
expect(skill).toMatch(/^---\nname: keco-develop-godot-slice\n/);
expect(skill).toMatch(/CONNECT[\s\S]*DISCOVER[\s\S]*DEFINE_EVALS[\s\S]*IMPLEMENT[\s\S]*EVALUATE_RUNTIME/);
expect(skill).toMatch(/without (?:a second|additional) confirmation/i);
expect(skill).toMatch(/three repair iterations/i);
expect(mcp.mcpServers).not.toHaveProperty('godot');
```

Assert all six reference files, both scripts, and `agents/openai.yaml` exist. Assert the two Skill descriptions are mutually exclusive for their fixture prompts.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts`

Expected: FAIL because `plugins/keco/skills/keco-develop-godot-slice` does not exist.

- [ ] **Step 4: Commit the failing contract**

```bash
git add tests/fixtures/plugins/keco-godot-skill-evals.json tests/unit/plugins/keco-plugin.test.ts
git commit -m "test(plugin): define Keco Godot skill contract"
```

### Task 2: Scaffold The Skill And Implement Workflow Contracts

**Files:**
- Create: `plugins/keco/skills/keco-develop-godot-slice/SKILL.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/agents/openai.yaml`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/source-priority.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/data-plan.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/slice-plan.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/eval-spec.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/godot-mcp-policy.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice/references/recovery-policy.md`
- Modify: `plugins/keco/.codex-plugin/plugin.json`

**Interfaces:**
- Consumes: Keco MCP tools, external `godot` MCP tools, snapshot scripts from Task 3.
- Produces: `RunContext`, `SourceSnapshot`, `SlicePlan`, `DataPlan`, `EvalSpec`, `SnapshotManifest`, and `EvalReport` contracts.

- [ ] **Step 1: Scaffold with the official initializer**

Run:

```bash
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  keco-develop-godot-slice \
  --path plugins/keco/skills \
  --resources scripts,references \
  --interface display_name="Develop Godot Slice" \
  --interface short_description="Build and evaluate Godot slices from Keco designs" \
  --interface default_prompt="Use $keco-develop-godot-slice to implement the next Godot gameplay slice from my Keco project and evaluate it."
```

Expected: a normalized Skill folder with `SKILL.md` and `agents/openai.yaml`.

- [ ] **Step 2: Write the orchestration Skill**

Use frontmatter:

```yaml
---
name: keco-develop-godot-slice
description: Use when a user explicitly asks to implement or continue one Godot gameplay slice from Keco project GDDs, feedback, or tables and evaluate the running result; not for Keco-only table creation, analysis-only requests, asset generation, running existing tests only, or Godot work unrelated to Keco design sources.
---
```

The body must require complete reference reads, copyable progress tracking, the fixed state machine, no second confirmation, one-slice scope, pre-implementation evaluations, deterministic snapshot export, Godot MCP runtime evidence, three repair iterations, exact reporting, and prohibited destructive operations.

- [ ] **Step 3: Write focused references**

Define exact YAML-like shapes and gates:

```text
source-priority.md -> conflict order and SourceSnapshot
slice-plan.md      -> RunContext, slice selection, allowed files, exclusions
data-plan.md       -> additive table design, stable IDs, Keco development records
eval-spec.md       -> evaluation types, preconditions, actions, evidence, scoring
godot-mcp-policy.md -> tool ordering, frozen runtime, state-first evidence
recovery-policy.md -> source drift, dirty files, partial writes, bounded repair
```

Keep each reference one level from `SKILL.md` and avoid duplicated normative text.

- [ ] **Step 4: Finish UI metadata and plugin prompts**

Configure `agents/openai.yaml` with Keco brand color, implicit invocation, the existing Keco HTTP dependency, and a Godot MCP dependency without embedding or duplicating a server URL. Update plugin version from `0.1.0` to `0.2.0`, broaden the descriptions to include evaluated Godot slices, and add one default prompt for the new workflow.

- [ ] **Step 5: Run the plugin contract**

Run: `npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts`

Expected: only snapshot-script existence or behavior assertions from Task 3 may still fail; all Skill content assertions pass.

- [ ] **Step 6: Commit the Skill contracts**

```bash
git add plugins/keco tests/unit/plugins/keco-plugin.test.ts
git commit -m "feat(plugin): add Keco Godot slice workflow"
```

### Task 3: Implement Deterministic Snapshot Export And Validation

**Files:**
- Create: `plugins/keco/skills/keco-develop-godot-slice/scripts/export_keco_snapshot.py`
- Create: `plugins/keco/skills/keco-develop-godot-slice/scripts/validate_snapshot.py`
- Create: `tests/fixtures/plugins/keco-godot-snapshot-input.json`
- Create: `tests/unit/plugins/keco-godot-snapshot.test.ts`

**Interfaces:**
- Consumes: normalized JSON with `schemaVersion`, `project`, `capturedAt`, `sources`, and `tables`.
- Produces: `<output>/manifest.json`, `<output>/tables/<table-key>.json`, aggregate SHA-256, and exit status 0/1.

- [ ] **Step 1: Write failing script tests**

The Jest test must invoke Python through `spawnSync` and verify:

```ts
expect(first.status).toBe(0);
expect(second.status).toBe(0);
expect(readFileSync(firstManifest)).toEqual(readFileSync(secondManifest));
expect(validation.status).toBe(0);
expect(validationAfterMutation.status).not.toBe(0);
```

Also test duplicate table keys, duplicate row keys, missing reference targets, invalid filenames, and a source/schema mismatch.

- [ ] **Step 2: Run the script test and verify failure**

Run: `npx jest --runInBand tests/unit/plugins/keco-godot-snapshot.test.ts`

Expected: FAIL because the scripts do not yet implement the CLI contract.

- [ ] **Step 3: Implement the exporter**

Use only the Python standard library. Normalize and validate all input before replacing output. Sort tables, fields, rows, value keys, source documents, and source tables. Serialize with UTF-8, two-space indentation, `ensure_ascii=False`, and one trailing newline. Write through a temporary directory and replace only the `tables` directory and manifest after every file succeeds.

Reference values use:

```json
{
  "targetTableKey": "resources",
  "targetRowKeys": ["food"]
}
```

Validate target table and row keys before writing. File names derive only from validated lower-case hyphen keys.

- [ ] **Step 4: Implement the validator**

Recompute each file hash and the aggregate hash, verify manifest paths remain below the snapshot root, validate schema and source metadata, reject unexpected JSON files, and optionally compare a supplied normalized source input.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-godot-snapshot.test.ts
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit scripts and tests**

```bash
git add plugins/keco/skills/keco-develop-godot-slice/scripts tests/fixtures/plugins/keco-godot-snapshot-input.json tests/unit/plugins
git commit -m "feat(plugin): export verified Keco Godot snapshots"
```

### Task 4: Validate The Complete Plugin And Review Contracts

**Files:**
- Modify as required by validation: `plugins/keco/skills/keco-develop-godot-slice/**`
- Modify as required by validation: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Consumes: complete Skill and scripts.
- Produces: a validated `keco` plugin ready for installation and real-chain testing.

- [ ] **Step 1: Run Skill and plugin validators**

Run:

```bash
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/keco/skills/keco-develop-godot-slice
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/keco
```

Expected: both validators report success.

- [ ] **Step 2: Run focused and broad tests**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-godot-snapshot.test.ts
npm run test:unit -- --runInBand
npm run build
git diff --check
```

Expected: all tests and the production build pass with no whitespace errors.

- [ ] **Step 3: Review the change**

Confirm trigger descriptions do not overlap, every referenced tool exists, source precedence is consistent, generated JSON is deterministic, destructive operations remain prohibited, repair is bounded, and existing Keco workflows remain unchanged.

- [ ] **Step 4: Commit validation fixes**

```bash
git add plugins/keco tests/fixtures/plugins tests/unit/plugins
git commit -m "test(plugin): harden Keco Godot workflow"
```

Skip the commit only when there are no validation fixes.

### Task 5: Push, Review, Merge, Reinstall, And Test The Real Chain

**Files:**
- Create after real-chain execution: `docs/qa/2026-08-04-keco-godot-skill-real-chain-report.md`

**Interfaces:**
- Consumes: validated branch, repository PR workflow, installed Keco plugin, live Keco project, live Godot editor.
- Produces: merged plugin and retained post-merge evidence.

- [ ] **Step 1: Push the feature branch**

Run: `git push -u origin skillsExtand`

Expected: remote branch updated successfully.

- [ ] **Step 2: Create and inspect the pull request**

Create a PR from `skillsExtand` to `main` with the design, Skill, script, trigger, and validation summary. Inspect the diff and CI state. Address only findings relevant to this change.

- [ ] **Step 3: Merge through the repository workflow**

Merge only after required checks pass. Record the PR URL and merge commit.

- [ ] **Step 4: Reinstall through the supported cachebuster flow**

Run the plugin creator's `update_plugin_cachebuster.py` against `plugins/keco`, read the installed repository marketplace name from `.agents/plugins/marketplace.json`, reinstall `keco` from that local marketplace, verify installed Skill hashes, then restore the source manifest to base version `0.2.0` after installation.

- [ ] **Step 5: Run post-merge trigger and snapshot smoke tests**

Use fresh Codex context when possible. Verify the new Skill is discoverable, its Keco and Godot dependencies are present, document-only requests remain routed to the old Skill, and the snapshot scripts pass against the fixture.

- [ ] **Step 6: Run the live Another Spring baseline**

Open Godot with the MCP addon enabled in WSL bind mode. Confirm the editor reports `C:\Users\lenovo\Desktop\another-spring`, Godot 4.7, and the expected addon version. Run the approved sleep/day and data-source EvalSpecs against the current `extend` branch and retain baseline failures without editing the game unless the installed Skill is running the actual slice workflow.

- [ ] **Step 7: Persist and commit the report**

Record exact commands, versions, hashes, Keco and Godot identities, evaluation evidence, unsupported mouse coverage, failures, and residual risks. Commit and push the QA report on `skillsExtand`; if the PR is already merged, create the smallest follow-up PR for only that report and merge it after checks.
