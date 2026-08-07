# Keco Implicit Multi-Slice Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Keco Godot Slice V2 implicitly discover document-driven development requests, decompose all ideas into a Keco-authoritative roadmap, and execute every planned Slice sequentially until completion or a three-repair pause.

**Architecture:** Keep the existing single-Slice ledger as the inner execution loop and add a multi-Slice orchestration layer around it. Store a roadmap plus per-Slice spec/plan/status/eval-report documents in a semantically discovered Keco Project Folder, with local files as validated mirrors only. Contract tests enforce discovery, ordering, pause behavior, and implicit invocation.

**Tech Stack:** Markdown Skill contracts, YAML agent metadata, TypeScript/Jest contract tests, Python Skill/plugin validators, Codex plugin cachebuster and marketplace reinstall scripts.

## Global Constraints

- Source document names are arbitrary; select by semantic evidence, not a fixed `Feedback` label or newest timestamp alone.
- Automatically select only one clearly dominant source; tied candidates require one focused question and zero writes.
- Execute all planned Slices in dependency/priority order.
- A Slice gets at most three repair iterations; after the third failure, persist evidence, pause the roadmap, and ask the user.
- Keco documents are authoritative; local documents are mirrors.
- Preserve unrelated dirty files, including the existing V1 Skill edit and generated `__pycache__` directories.

---

### Task 1: Add RED contract tests for implicit multi-Slice behavior

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`

**Interfaces:**
- Consumes: current V2 Skill, agent metadata, and reference files.
- Produces: executable regex/file-existence contract for the new orchestration behavior.

- [ ] **Step 1: Replace the manual-only expectation with implicit invocation expectations**

Add assertions equivalent to:

```ts
expect(skill).toMatch(/document-driven[\s\S]*implicit/i);
expect(skill).not.toContain('explicitly selects `$keco-develop-godot-slice-v2`');
expect(metadata).toMatch(/allow_implicit_invocation: true/);
```

- [ ] **Step 2: Require the new multi-Slice contract and source-discovery rules**

```ts
expect(existsSync(path.join(skillRoot, 'references', 'multi-slice-orchestration.md'))).toBe(true);
expect(sourceData).toMatch(/semantic[\s\S]*clearly dominant[\s\S]*awaiting_user_confirmation/i);
```

- [ ] **Step 3: Require roadmap, sequential execution, and three-repair pause semantics**

```ts
const multiSlice = readFileSync(path.join(skillRoot, 'references', 'multi-slice-orchestration.md'), 'utf8');
expect(multiSlice).toMatch(/roadmap[\s\S]*dependencies[\s\S]*priority/i);
expect(multiSlice).toMatch(/NEXT_SLICE[\s\S]*completed/i);
expect(multiSlice).toMatch(/three|3[\s\S]*paused[\s\S]*user/i);
```

- [ ] **Step 4: Run the focused test and verify RED**

Run: `npx jest tests/unit/plugins/keco-godot-slice-v2.test.ts --runInBand`

Expected: FAIL because V2 is manual-only, the new reference does not exist, and the contracts are absent.

### Task 2: Implement the multi-Slice Skill contract

**Files:**
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/agents/openai.yaml`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/multi-slice-orchestration.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/source-data-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/slice-decision.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/slice-document-contract.md`
- Test: `tests/unit/plugins/keco-godot-slice-v2.test.ts`

**Interfaces:**
- Consumes: Keco `list_project_structure`, document listing/read/create/update operations, existing single-Slice ledger, and PixelLab/Godot gates.
- Produces: `Roadmap`, ordered `SliceCandidate[]`, and the existing per-Slice artifact set.

- [ ] **Step 1: Enable implicit invocation and define routing precedence**

Set metadata to:

```yaml
policy:
  allow_implicit_invocation: true
```

Update the description/body so document-driven Keco development, multi-idea decomposition, persistent planning, resource evolution, or runtime evaluation selects V2 without requiring the literal Skill name. Keep standalone art and Godot-only debugging out of scope.

- [ ] **Step 2: Add the roadmap contract**

Define a versioned record with source document identity, candidate Slice IDs, objectives, dependency IDs, priority, allowed-file scope, per-Slice state, current Slice ID, aggregate state, and Keco/local document bindings.

- [ ] **Step 3: Define semantic source discovery**

Require fresh project document summaries, semantic ranking, one clearly dominant auto-selection, tied-candidate confirmation, and no latest-document shortcut. Preserve `writeToken: null` until a source is accepted.

- [ ] **Step 4: Define the outer execution loop**

```text
SOURCE_DISCOVERY -> SLICE_DECOMPOSITION -> WRITE_ROADMAP
  -> SELECT_NEXT_SLICE -> existing single-Slice ledger
  -> UPDATE_ROADMAP -> NEXT_SLICE
```

Only select a Slice whose dependencies are complete; use priority as the tiebreaker. Create/read back its spec, plan, and status before execution, then create/read back eval-report before marking it complete.

- [ ] **Step 5: Define repair exhaustion**

After three failed repair iterations, persist the Slice failure evidence, mark the roadmap `paused`, clear the next-Slice transition, and ask the user. Do not skip to an independent Slice automatically.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `npx jest tests/unit/plugins/keco-godot-slice-v2.test.ts --runInBand`

Expected: PASS with all V2 contract cases green.

### Task 3: Update plugin discovery metadata and regression coverage

**Files:**
- Modify: `plugins/keco/.codex-plugin/plugin.json`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`
- Test: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Consumes: plugin manifest and V1/V2 agent metadata.
- Produces: user-facing default prompt and routing assertions that make multi-Slice V2 discoverable without breaking V1.

- [ ] **Step 1: Write RED plugin expectations**

Require a default prompt describing document-driven multi-Slice planning and assert V2 implicit invocation while V1 remains available for bounded simple Slices.

- [ ] **Step 2: Run the plugin test and verify RED**

Run: `npx jest tests/unit/plugins/keco-plugin.test.ts --runInBand`

Expected: FAIL because the manifest lacks the new prompt/routing text.

- [ ] **Step 3: Update the plugin manifest minimally**

Add one default prompt such as:

```json
"Read a Keco project document, plan its development ideas as ordered Godot slices, and execute them."
```

Do not hand-edit marketplace configuration.

- [ ] **Step 4: Run the plugin test and verify GREEN**

Run: `npx jest tests/unit/plugins/keco-plugin.test.ts --runInBand`

Expected: PASS.

### Task 4: Validate, cache-bust, reinstall, and verify both installations

**Files:**
- Modify: `plugins/keco/.codex-plugin/plugin.json` through the cachebuster helper.
- Verify: WSL and Windows Codex plugin cache directories.

**Interfaces:**
- Consumes: validated plugin source and the configured local marketplace.
- Produces: matching installed plugin versions and Skill hashes in WSL and Windows.

- [ ] **Step 1: Run Skill and plugin validation**

```bash
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/keco/skills/keco-develop-godot-slice-v2
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/keco
```

Expected: both validators exit 0.

- [ ] **Step 2: Run focused and plugin regression tests**

Run: `npx jest tests/unit/plugins/keco-godot-slice-v2.test.ts tests/unit/plugins/keco-plugin.test.ts --runInBand`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Update the source cachebuster**

Run:

```bash
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py plugins/keco
```

Expected: preserve `0.3.0` and replace only the `+codex.*` suffix.

- [ ] **Step 4: Reinstall from the configured local marketplace**

Confirm the repository marketplace name with `python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py --marketplace-path .agents/plugins/marketplace.json`, then run:

```bash
codex plugin add keco@keco-studio
powershell.exe -NoProfile -Command 'codex plugin add keco@keco-studio'
```

Both commands must resolve the marketplace at `/home/hetu/project/keco-studio/.agents/plugins/marketplace.json` or its `\\wsl.localhost\\Ubuntu` Windows path. Do not hand-edit marketplace files.

- [ ] **Step 5: Verify installed versions and hashes**

Compare source, WSL, and Windows `SKILL.md`, `multi-slice-orchestration.md`, agent metadata, and plugin manifest hashes. All three locations must match.

- [ ] **Step 6: Run final verification and commit only task-owned files**

Run fresh validators/tests, inspect `git diff --check`, and stage only files listed in this plan. Preserve the pre-existing V1 edit and `__pycache__` paths unstaged.
