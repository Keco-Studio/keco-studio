# Keco Godot Asset Workflow Implementation Plan

**Goal:** Extend `keco-develop-godot-slice-v2` with self-contained character, animation, spritesheet, and tileset integration workflows while removing every runtime or installation dependency on Superpowers.

**Architecture:** Keep Keco as the authoritative asset and provenance store. Add focused reference contracts for provider-neutral asset planning, Godot animation import, and Godot tileset import; add deterministic Python scripts for SpriteFrames generation and package validation; enforce the behavior through the existing Jest contract suite.

**Tech Stack:** Markdown skill contracts, Python 3 standard library, Jest/TypeScript fixtures.

## Global Constraints

- Work on the current `skillsExtand` branch; do not create a worktree.
- The shipped skill must contain no `superpowers:*` requirement, external plugin dependency, or download prerequisite.
- Keep Keco-first persistence, provider capability discovery, write-token gates, and `KECO_EVAL` runtime evidence unchanged.
- Do not infer Godot terrain mappings when provider metadata does not define the layout.
- Reuse or additively extend compatible existing Keco tables, asset rows, Godot resources, and nodes before creating parallel replacements.
- Persist each Slice's user-facing documents as `docs/superpowers/specs/<slice-id>-design.md` and `docs/superpowers/plans/<slice-id>.md`; keep status and completion evidence internal.
- Do not touch the existing untracked `scripts/__pycache__/` directory.

---

### Task 1: Self-Contained Skill Contract

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/SKILL.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/review-workflow.md`
- Delete: `plugins/keco/skills/keco-develop-godot-slice-v2/references/superpowers-adapted.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/ab-matrix.md`

**Interfaces:**
- Produces: a fully bundled plan validation, task RED/GREEN, and completion-review workflow with no external skill requirement.

- [ ] Add a test that recursively rejects `superpowers:` requirements and requires `references/review-workflow.md`.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm it fails because the old reference and wording remain.
- [ ] Rename the bundled workflow reference and update `SKILL.md`, the A/B matrix, and test expectations.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm this contract passes.

### Task 2: Provider-Neutral Asset And Godot Contracts

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/SKILL.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/generated-asset-contract.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/existing-resource-evolution.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/godot-animation-contract.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/godot-tileset-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/eval-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/keco-pixellab-contract.md`

**Interfaces:**
- Produces: `AssetPlan` roles for style/reference/edit assets, upload/import, credits/jobs, canonical asset identity, reuse/extension decisions, animation state metadata, SpriteFrames imports, and typed tileset layouts.

- [ ] Add assertions for the asset references, canonical asset reuse, compatible-table/resource extension, upload/import before animation, SpriteFrames validation, terrain mapping gates, credits/job recovery, and packaged-export materialization.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm it fails for missing references and contracts.
- [ ] Write the minimal provider-neutral contracts and link them from `SKILL.md` at the stages where they must be read.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm all contract assertions pass.

### Task 3: Deterministic SpriteFrames Builder

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/scripts/build_spriteframes_resource.py`

**Interfaces:**
- Consumes: a JSON package with `resourcePath` and animations containing `name`, `sheetPath`, `sheetFile`, `frameWidth`, `frameHeight`, `frameCount`, `fps`, and `loop`.
- Produces: a deterministic Godot 4 `SpriteFrames` `.tres`; exits nonzero when PNG dimensions, frame geometry, names, fps, paths, or counts are invalid.

- [ ] Add a test that creates valid PNG headers, runs the missing script, expects the full `.tres`, and verifies dimension mismatch rejection.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm it fails because the builder is absent.
- [ ] Implement PNG-header parsing, manifest validation, deterministic resource IDs, atlas regions, and atomic output using only Python 3 standard library.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm valid generation and invalid-dimension rejection pass.

### Task 4: Generated Asset Package Validator

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/scripts/validate_generated_asset_package.py`

**Interfaces:**
- Consumes: a JSON package containing parent assets and child files with stable keys, kinds, provider identity, hashes, target paths, animation metadata, or tileset layout metadata.
- Produces: JSON `{ "ok": true, ... }`; rejects duplicate keys/paths, path traversal, incomplete animation metadata, unsupported tileset layouts, missing files, and SHA/dimension mismatches.

- [ ] Add valid and invalid package tests before creating the validator.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm it fails because the validator is absent.
- [ ] Implement strict package validation using Python 3 standard library and the typed contracts.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts` and confirm both acceptance and rejection cases pass.

### Task 5: Persistent Slice Documents

**Files:**
- Modify: `tests/unit/plugins/keco-godot-slice-v2.test.ts`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/references/slice-document-contract.md`
- Create: `plugins/keco/skills/keco-develop-godot-slice-v2/scripts/validate_slice_documents.py`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/SKILL.md`

**Interfaces:**
- Consumes: a target Godot project folder containing the paired `docs/superpowers/specs/<slice-id>-design.md` and `docs/superpowers/plans/<slice-id>.md`; runtime status and evaluation evidence are internal sidecars.
- Produces: validated ISO dates, `latest`/`status`/`completed` consistency, supersession links, task progress, and document frontmatter bound to one slice ID.

- [ ] Add a test that creates a valid slice directory and rejects a completed slice without an eval report or a stale document marked latest.
- [ ] Run the focused Jest suite and confirm the missing validator/reference fail.
- [ ] Implement the bundled document contract and Python validator with no external dependency.
- [ ] Run the focused Jest suite and confirm valid/latest/completed/superseded states are enforced.

### Task 6: Verification And Review

**Files:**
- Modify only files required to fix findings from verification.

**Interfaces:**
- Consumes: all contracts, scripts, and focused tests from Tasks 1-5.
- Produces: a verified, self-contained skill change with an evidence-backed final report.

- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-godot-slice-v2.test.ts`.
- [ ] Run `npm run test:unit -- --runInBand tests/unit/plugins/keco-plugin.test.ts tests/unit/plugins/keco-godot-snapshot.test.ts tests/unit/plugins/keco-godot-slice-v2.test.ts`.
- [ ] Run each Python script with `--help` and compile the new scripts with `python3 -m py_compile` while directing bytecode to a temporary directory.
- [ ] Search the shipped v2 skill for external Superpowers requirements and placeholder text.
- [ ] Review `git diff --check`, the changed-file list, and the final diff for scope, asset authority, security, and unsupported-evidence regressions.
