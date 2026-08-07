# Game Art Keco-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Route implicit game-art and Godot development intent through Keco-first asset registration before any PixelLab generation.

**Architecture:** Keep pure art exploration available as a temporary, non-Keco path. For development intent, discover a semantically compatible Keco asset registry, create and read back a `planned` row, generate and validate through PixelLab, upload the authoritative image object, update the same row to `ready`, export from Keco, and only then materialize into Godot.

**Tech Stack:** Markdown skill contracts, YAML skill metadata, Keco MCP, PixelLab MCP, Godot MCP, Python skill/plugin validators, Jest plugin tests.

## Global Constraints

- Do not require users to mention PixelLab explicitly for game-art requests.
- Treat Godot/project/map/art terms as development intent when context indicates a game project.
- Never assume an asset registry table name or field label.
- Never copy a temporary PixelLab file directly into Godot.
- Require paginated Keco read-back after planned and ready writes.
- Store the complete verified Keco image object, not only a URL.

### Task 1: Update game-art intent routing

**Files:**
- Modify: `plugins/keco/skills/pixellab-map-assets/SKILL.md`
- Modify: `plugins/keco/skills/pixellab-map-assets/agents/openai.yaml`

- [ ] Expand the skill trigger description to include generic game-art requests, Godot terms, Chinese map/character/NPC/UI terms, and style-reference requests.
- [ ] Add high/medium/low confidence behavior and route development intent into the Keco-first path.
- [ ] Add an explicit Keco-first checklist and forbid direct temporary-file integration.

### Task 2: Complete the Keco-first asset contract

**Files:**
- Modify: `plugins/keco/skills/pixellab-map-assets/references/pixellab-operations.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice/references/asset-plan.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/keco-pixellab-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/generated-asset-contract.md`

- [ ] Require planned fields: stable key, type, purpose, target path, dimensions, transparency, operation, prompt, references and hashes, `runId`, `sliceId`, and planned status.
- [ ] Map canonical semantic roles to actual discovered field labels and IDs; block on ambiguity.
- [ ] Require Keco upload, complete-image verification, same-row ready update, paginated read-back, authoritative download, and Godot materialization.

### Task 3: Validate and refresh the plugin

**Files:**
- Modify: `plugins/keco/.codex-plugin/plugin.json`

- [ ] Run all affected skill validators.
- [ ] Run the Keco plugin Jest tests.
- [ ] Refresh the plugin cachebuster and reinstall from `keco-studio`.

### Task 4: Persist slice plans in the Keco Project Folder

**Files:**
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/orchestration-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/slice-document-contract.md`
- Modify: `plugins/keco/skills/keco-develop-godot-slice-v2/references/source-data-contract.md`

- [x] Discover the canonical Keco project and an existing compatible folder before `WRITE_SPEC`.
- [x] Create `spec`, `plan`, `status`, and final `eval-report` as Keco documents with `folderId`; retain returned document IDs and state tokens.
- [x] Read back every Keco document after create/update and keep local `docs/keco-godot-slices/<sliceId>/` only as a validated mirror.
- [x] Block before writes when no suitable Keco folder exists because the exposed MCP has no folder-creation operation.
