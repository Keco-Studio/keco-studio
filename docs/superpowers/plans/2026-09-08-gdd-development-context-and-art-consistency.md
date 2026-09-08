# GDD Development Context And Art Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This plan intentionally uses implementation-first sequencing because the user explicitly requested no TDD and one unified review after all feature work.

**Goal:** Make GDD-driven game development resolve the exact historical GDS Art Style, expose authoritative GDD image assets through MCP, pass supported references into real generators, and verify provenance separately from visual output.

**Architecture:** Keep `GameArtStyleSnapshot` as the only canonical style model. Add deterministic category projections, a project-authorized GDD development-context service and MCP read tool, additive reference-aware generator contracts, and result-level visual observations consumed by the Keco Godot Slice workflow. Historical GDD provenance always wins over the project's current GDS binding.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Zod, Supabase/PostgreSQL, Deno MCP server, PixelLab MCP adapters, Sharp, Jest, Deno test, Keco Codex/Claude skills.

## Global Constraints

- Do not use TDD; finish implementation before the consolidated test and review phase.
- Do not add `documents.design_system_id` or any competing GDD-to-GDS source of truth.
- Resolve generated GDD provenance only through `documents.gdd_generation_job_id` and the pinned generation job version.
- Never silently fall back to the project's current GDS binding.
- Keep `GameArtStyleSnapshot` canonical; category projections are derived and non-persistent.
- Keep `intendedRole` and `runtimeCompatibility` independent.
- Signed URLs are ephemeral transport and never identity, hash input, or persisted Slice state.
- GDS preset previews remain `concept_only` and are never production assets.
- A provider reference capability is `exact`, `fallback`, or `unavailable`; required unavailable capabilities block before a paid submission.
- Provenance success and visual-style success are separate statuses.
- Preserve legacy GDD, Map Plan, Character Plan, and stored generation records.
- Do one unified review after all implementation and tests are present; repair every detected scope or contract drift before delivery.

---

### Task 1: Canonical Art-Style Projections And Prompt Propagation

**Files:**
- Create: `src/lib/game-art-style/development.ts`
- Modify: `src/lib/gdd-generation/v2/generator.ts`
- Modify: `src/lib/agent/core.ts`
- Modify: `src/lib/agent/prompts.ts`

**Interfaces:**
- Produces: `hashGameArtStyleSnapshot(snapshot)`, `buildGddArtStyleContext(snapshot)`, `compileMapArtDirection(snapshot, constraints)`, `compileCharacterArtDirection(snapshot, constraints)`, `compileUiArtDirection(snapshot, constraints)`, `compileVfxArtDirection(snapshot, constraints)`, and `compileAnimationArtDirection(snapshot, constraints)`.
- Consumes: validated `GameArtStyleSnapshot` and optional `GameArtProjectConstraints`.

- [ ] **Step 1: Add deterministic style hashing and bounded category projections**

  Implement sorted-key canonical hashing and category projections that select the existing snapshot fields relevant to each consumer. Define explicit optional project constraints for camera, tile size, pixels per unit, character proportions, palette, outline width, output dimensions, transparency, and animation FPS. Preserve unknowns as `null` rather than invented defaults.

- [ ] **Step 2: Add safe GDD prompt context**

  Extend `sourceContext()` in the V2 generator with a bounded `BEGIN_UNTRUSTED_GAME_ART_STYLE_DATA` JSON block produced by `buildGddArtStyleContext()`. Tell the model to use rendering guidance without treating preview subjects, provider controls, or tool instructions as project facts.

- [ ] **Step 3: Add separate built-in Agent art context**

  Select `art_style` beside `rules` in `core.ts`, parse supported snapshots, and pass a separate `artStyleContext` into `buildSystemPrompt()`. Keep it outside `policyText` and rule evidence so Art Style cannot affect authorization or applied-rule reporting.

- [ ] **Step 4: Preserve unsupported snapshots safely**

  Omit unsupported raw JSON, add no prompt block, and keep normal Agent turns operational when the binding or Art Style read fails.

### Task 2: GDD Development Context Domain Model

**Files:**
- Create: `src/lib/gdd-development/contracts.ts`
- Create: `src/lib/gdd-development/documentAssets.ts`
- Create: `src/lib/gdd-development/runtimeCompatibility.ts`

**Interfaces:**
- Produces: strict `developmentTargetProfileSchema`, `gddDevelopmentContextSchema`, DTO types, `collectGddDocumentAssetReferences(markdown)`, and `evaluateRuntimeCompatibility(asset, targetProfile)`.
- Consumes: sanctioned MDX, GDD map-reference attributes, image metadata, and optional Godot 4 target profiles.

- [ ] **Step 1: Define bounded strict DTO schemas**

  Encode the approved context, origin, Art Style, preview, asset, warning, delivery, and target-profile contracts in Zod. Bound arrays, strings, dimensions, warnings, and total response count. Use `number` for epoch and revision.

- [ ] **Step 2: Parse document image references structurally**

  Walk `parseValidatedSanctionedMdx()` output. Deduplicate `GddMapReference` nodes by artifact ID, collect ordinary Markdown images by normalized URL plus alt text, and record recognized `ResourceReference` nodes without regex parsing. Ordinary images default to `unclassified`.

- [ ] **Step 3: Implement metadata-only compatibility**

  Compare kind, dimensions, alpha, tile geometry, and frame geometry against the optional target profile. Return `unknown` when the profile or required metadata is absent; never infer compatibility from appearance.

- [ ] **Step 4: Separate identity from delivery**

  Ensure canonical hashes omit `delivery`, and provide helpers that strip ephemeral URLs before a context is persisted into Slice planning evidence.

### Task 3: Historical Provenance Resolver And App API

**Files:**
- Create: `src/lib/gdd-development/contextService.ts`
- Create: `src/app/api/projects/[projectId]/gdd-development-context/[documentId]/route.ts`
- Modify: `src/lib/documents/gddMapArtifactService.ts`

**Interfaces:**
- Produces: `readGddDevelopmentContext(serviceClient, input)` and `GET /api/projects/:projectId/gdd-development-context/:documentId`.
- Consumes: authorized project ID, Document ID, optional target profile, document state gateway, `gdd_generation_jobs`, exact `game_design_system_versions`, `gdd_map_artifacts`, `map_assets`, and storage signing.

- [ ] **Step 1: Resolve current Document state and source references**

  Read the authoritative Markdown, epoch, revision, update tail, content hash, and generation job ID. Reject cross-project Documents before privileged joins.

- [ ] **Step 2: Resolve exact historical origin**

  Join the Document's generation job to its exact `design_system_id` and `version_id`; read that immutable version directly, validate its Art Style, and return its persisted `content_hash`. Never query `project_game_design_systems` in this resolver.

- [ ] **Step 3: Resolve GDD map assets**

  Batch-load referenced same-project artifacts and their exact ready `map_assets`. Return stable asset/revision/hash/dimensions/alpha identity, `runtime_candidate`, compatibility, and a five-minute signed delivery URL. Missing or non-ready assets remain visible with bounded warnings and no regeneration.

- [ ] **Step 4: Report non-map images safely**

  Return ordinary Markdown images as unclassified, non-authoritative records. Do not fetch external URLs. Return GDS preview metadata as concept-only references without converting public paths into project asset IDs.

- [ ] **Step 5: Add authorized route handling**

  Require accepted project read access, parse a strict optional `targetProfile` query payload, return the bounded public DTO, map absent Documents to 404, malformed profiles to 400, and unavailable schema/service state to a non-leaking stable error.

### Task 4: MCP GDD Development Context Tool

**Files:**
- Create: `supabase/functions/mcp/gdd-context-tools.ts`
- Create: `supabase/functions/mcp/gdd-context-tools.test.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `plugins/keco-codex/references/gds-map-mcp-contract.md`
- Modify: `plugins/keco-claude/references/gds-map-mcp-contract.md`

**Interfaces:**
- Produces: read-only `read_gdd_development_context` for account and project MCP modes.
- Consumes: `{ projectId?, documentId, targetProfile? }` and the authorized app route from Task 3.

- [ ] **Step 1: Register the strict tool schema**

  Require `projectId` only in account mode, reject unknown keys, and expose the optional target profile exactly as defined by the app contract.

- [ ] **Step 2: Call the authorized app bridge**

  Encode project and Document IDs into the route, pass target profile without leaking credentials, return only the approved bounded fields, and map app errors through existing MCP error handling.

- [ ] **Step 3: Add protocol classification and discovery**

  Register the tool in both MCP modes and add it to `READ_TOOLS` so telemetry records it as a read rather than static/unknown work.

- [ ] **Step 4: Update the public MCP contract mirrors**

  Document historical provenance, target-profile semantics, intended-role/compatibility separation, ephemeral delivery, and the prohibition on current-binding fallback identically in Codex and Claude plugin references.

### Task 5: Reference-Aware Map And Character Contracts

**Files:**
- Modify: `src/lib/gdd-generation/maps/plan.ts`
- Modify: `src/lib/gdd-generation/maps/worker.ts`
- Modify: `src/features/character-assets/model/characterAssetSchema.ts`
- Modify: `src/lib/server/characterAssetMcpService.ts`
- Modify: `src/app/api/mcp/character-assets/route.ts`
- Modify: `supabase/functions/mcp/character-tools.ts`
- Modify: `supabase/functions/pixellab-character/types.ts`
- Modify: `supabase/functions/pixellab-character/auth.ts`
- Modify: `supabase/functions/pixellab-character/pixellab-client.ts`
- Modify: `supabase/functions/pixellab-character/lifecycle.ts`

**Interfaces:**
- Produces: additive Character Plan V2 reference bindings and provider `referenceCompatibility`; extends GDD map planning to accept verified Map Plan references when available.
- Consumes: Keco asset IDs, revisions, SHA-256 values, intended roles, selected style-copy dimensions, and live provider schemas.

- [ ] **Step 1: Make GDD Map Plan reference input explicit**

  Extend `mapPlanFromGddBrief()` with an optional verified-reference argument matching existing Map Plan V3 `references` and `styleReference`. Preserve the current empty behavior when no approved project asset exists; never use GDS previews automatically.

- [ ] **Step 2: Add Character Plan V2**

  Define additive character-only `schemaVersion: 2` with bounded `references` carrying asset ID, SHA-256, `style|source` role, required flag, and usage. Continue parsing all stored V1 character and animation plans unchanged.

- [ ] **Step 3: Resolve character references authoritatively**

  Before paid submission, verify every reference belongs to the project, is ready, matches its expected SHA-256, and has a provider-usable identity. Persist resolved provenance in attempt metadata without storing signed URLs.

- [ ] **Step 4: Negotiate live provider capability**

  Inspect the live `create_character` schema for supported reference parameters. Report `exact` when every requested role maps without semantic loss, `fallback` only when a non-required reference can be represented by bounded textual direction, and `unavailable` when a required reference cannot be represented. Block unavailable required references before state transition to a paid queued submission.

- [ ] **Step 5: Pass supported provider references**

  Extend `characterArguments()` only with fields proven present in the discovered schema. Keep URLs and provider controls out of Character Plan descriptions and bind animations to the verified source character as before.

### Task 6: Result-Level Visual Observation And Verification

**Files:**
- Create: `src/lib/game-art-style/outputValidation.ts`
- Create: `scripts/game-art-style/inspectOutput.ts`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-assets/references/generated-asset-contract.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-assets/references/generated-asset-contract.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-verification/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-verification/SKILL.md`

**Interfaces:**
- Produces: `visualOutputObservationSchema`, `evaluateVisualOutput(observation, direction)`, and a Sharp-backed inspector command that emits machine-readable JSON.
- Consumes: authoritative local PNG bytes, compiled category direction, provenance hashes, and category acceptance constraints.

- [ ] **Step 1: Define separate verification states**

  Model `provenanceStatus` and `visualStyleStatus` independently as `pass|fail|blocked`. Require observable assertions and evidence for visual pass; a matching Art Style hash can satisfy only provenance.

- [ ] **Step 2: Inspect measurable output properties**

  Use Sharp to report decoded format, dimensions, alpha, visible pixels, approximate palette cardinality, semitransparent-pixel ratio, edge density, nearest-neighbor block consistency for pixel-art targets, and SHA-256. Fail closed on malformed or oversized inputs.

- [ ] **Step 3: Evaluate category constraints**

  Check exact dimensions, transparency, palette bounds when explicitly locked, pixel-grid/antialiasing expectations, and category-specific required observations. Mark semantic palette, silhouette, composition, perspective, and subject-matter criteria as requiring structured visual review rather than manufacturing an automated pass.

- [ ] **Step 4: Update verification skill mirrors**

  Require authoritative download, inspector evidence, and a structured visual review. Regenerate only failed assets and record the changed prompt/reference. Keep Codex and Claude copies byte-equivalent where their platform front matter does not differ.

### Task 7: GDD-To-Slice Preflight And Asset Reuse Policy

**Files:**
- Modify: `plugins/keco-codex/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco-claude/skills/keco-develop-godot-slice-v2/SKILL.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-preflight/references/gdd-coverage-contract.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-preflight/references/gdd-coverage-contract.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-assets/references/existing-resource-evolution.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-assets/references/existing-resource-evolution.md`
- Modify: `plugins/keco-codex/skills/keco-godot-slice-assets/references/keco-pixellab-contract.md`
- Modify: `plugins/keco-claude/skills/keco-godot-slice-assets/references/keco-pixellab-contract.md`
- Modify: `contracts/keco-slice-v2/contract-manifest.json`
- Modify: `contracts/keco-slice-v2/conformance-cases.json`

**Interfaces:**
- Produces: required GDD development-context preflight, persisted sanitized provenance, `derive_from_source` evolution strategy, and separate visual/provenance gates.
- Consumes: Task 4 MCP DTO and Task 6 observations.

- [ ] **Step 1: Require historical context read**

  After GDD Document identity resolution, require `read_gdd_development_context` and bind its Document token, origin version hash, Art Style hash, and selected source asset identities into SourceProfile and planning evidence.

- [ ] **Step 2: Handle legacy and unclassified inputs explicitly**

  Make `origin: null`, unsupported Art Style, unclassified images, incompatible runtime candidates, and changed context hashes explicit Slice decisions. Do not infer the current project GDS or write before required user decisions are resolved.

- [ ] **Step 3: Add source derivation semantics**

  Add `derive_from_source` beside existing evolution strategies. Require source ID/revision/hash, target path, provider adapter decision, and reason. Keep exact reuse distinct from derivation and new creation.

- [ ] **Step 4: Extend canonical Slice contracts**

  Add bounded development-context and dual-verification fields to the manifest and conformance cases without breaking legacy reads. Update contract hashes through the repository's canonical generation/validation path.

### Task 8: Consolidated Automated Coverage

**Files:**
- Modify: `src/lib/gdd-generation/v2/generator.test.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`
- Create: `src/lib/game-art-style/development.test.ts`
- Create: `src/lib/game-art-style/outputValidation.test.ts`
- Create: `src/lib/gdd-development/documentAssets.test.ts`
- Create: `src/lib/gdd-development/runtimeCompatibility.test.ts`
- Create: `src/lib/gdd-development/contextService.test.ts`
- Create: `tests/unit/gdd-development-context-route.test.ts`
- Modify: `src/lib/gdd-generation/maps/plan.test.ts`
- Modify: `tests/unit/character-assets/character-asset-schema.test.ts`
- Modify: `tests/unit/character-assets/character-asset-mcp-service.test.ts`
- Modify: `supabase/functions/pixellab-character/pixellab-client.test.ts`
- Modify: `supabase/functions/pixellab-character/lifecycle.test.ts`
- Modify: `tests/unit/plugins/keco-gds-map-plugin.test.ts`
- Modify: `tests/fixtures/plugins/keco-slice-contract-cases.json`

**Interfaces:**
- Consumes all interfaces from Tasks 1-7.
- Produces regression evidence for the complete feature after implementation.

- [ ] **Step 1: Cover Art Style propagation and isolation**

  Assert exact snapshot fields enter GDD and Agent contexts, unsafe directives are sanitized, unsupported snapshots are omitted, rule evidence is unchanged, and preview subject matter is not promoted to project fact.

- [ ] **Step 2: Cover provenance and authorization**

  Assert historical version resolution survives project rebind/clear, current binding is never queried, cross-project access fails, legacy origin is null, corrupt Art Style is bounded, and delivery URLs do not affect hashes.

- [ ] **Step 3: Cover image inventory and compatibility**

  Assert structural deduplication, runtime-candidate map defaults, unclassified Markdown defaults, concept-only previews, target-profile hashing, and independent intent/compatibility states.

- [ ] **Step 4: Cover real generator contracts**

  Assert Map Plan reference propagation, Character V1 compatibility, Character V2 strictness, reference identity checks, exact/fallback/unavailable negotiation, and blocking before paid submission.

- [ ] **Step 5: Cover visual observations and skill contracts**

  Assert measurable image observations, separate status derivation, required semantic review, GDD preflight tool use, source derivation records, and mirrored plugin instructions.

- [ ] **Step 6: Run focused suites**

  Run the exact changed Jest files, `npm run test:mcp`, PixelLab Deno tests, Slice validators, and plugin fixture validators. Expected result: all pass with no snapshot or contract drift.

### Task 9: Unified Review, Drift Repair, And Full Verification

**Files:**
- Review every file changed since commit `4a9fe6e8`.
- Modify only files needed to repair findings.

**Interfaces:**
- Produces: review findings resolved, clean full validation, and delivery-ready commits.

- [ ] **Step 1: Review the complete diff once**

  Inspect behavior, security, RLS boundaries, immutable version identity, paid-submission ordering, schema compatibility, response bounds, duplicated Codex/Claude instructions, and unintended unrelated changes. Treat specification drift as a defect.

- [ ] **Step 2: Compare repository history**

  Run `git log --oneline --decorate --all`, inspect recent GDD/GDS/MCP/map/character fixes with `git log -p -- <affected paths>`, and verify the implementation does not reintroduce stale-binding, replay, data-leakage, idempotency, paid-job, or prompt-loss regressions.

- [ ] **Step 3: Repair every finding**

  Apply scoped fixes, update consolidated tests for corrected behavior, and repeat the full diff review until no P0-P3 finding remains.

- [ ] **Step 4: Run full verification**

  Run `npm run lint`, `npm run typecheck`, `npm run typecheck:api`, `npm run check:mcp`, `npm run test:mcp`, `npm run test:unit -- --runInBand`, contract/skill validators, and `npm run build`. Expected result: every command exits 0.

- [ ] **Step 5: Verify worktree and commits**

  Require `git diff --check`, no unintended untracked files, no secrets or signed URLs, and a clean `git status`. Review every branch commit against `4a9fe6e8`.

### Task 10: GitHub Delivery And Merge Confirmation

**Files:**
- No source changes unless CI reveals a verified defect.

**Interfaces:**
- Produces: pushed `unify-art-style` branch, reviewed PR, green required checks, merged PR, and confirmed remote merge state.

- [ ] **Step 1: Push the explicit branch**

  Push with `git push -u origin unify-art-style` only after Task 9 passes.

- [ ] **Step 2: Create the PR**

  Use `gh pr create` with a summary separating provenance, reuse, generator references, and visual validation, plus the exact verification commands and migration/compatibility notes.

- [ ] **Step 3: Wait for all required checks**

  Monitor `gh pr checks --watch`. Do not merge while a check is queued, running, skipped unexpectedly, or failed. For failures, inspect logs, fix verified defects on the branch, rerun local relevant checks, push, and wait again.

- [ ] **Step 4: Merge and confirm**

  Merge using the repository's allowed non-interactive method, then query the PR and remote default branch to confirm `state=MERGED`, a non-null merge commit, and that the merge commit is reachable from `origin/main`.
