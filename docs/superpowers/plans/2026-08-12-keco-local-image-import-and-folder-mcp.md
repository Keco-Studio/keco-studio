# Keco Local Image Import And Folder MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or parallel agents with strictly disjoint file ownership. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship discoverable single and batch Keco image upload contracts, owner/admin-only folder creation, and a lightweight local-image import Skill in both plugin packages.

**Architecture:** Reuse one internal image preparation/completion implementation for single and batch MCP Tools. Add an authenticated atomic `mcp_create_folder` RPC and a thin MCP Tool wrapper. Keep local bytes outside MCP and encode routing, confirmation, recovery, and verification in a concise cross-plugin Skill.

**Tech Stack:** Deno, TypeScript, Zod, MCP SDK, Supabase/PostgreSQL, Jest, Markdown/YAML plugin Skills.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-12-keco-local-image-import-and-folder-mcp-design.md` exactly.
- Do not use TDD; implement first, then add and run focused tests.
- Support only PNG, JPEG, GIF, WebP, and safe static SVG, with a 5 MiB per-image limit and 20 items per batch.
- Never place raw bytes or Base64 in MCP JSON and never persist or log signed URLs, upload headers, bearer tokens, or credentials.
- Folder creation is limited to project owners and accepted `admin` collaborators.
- Preserve existing single-image Tool compatibility and existing invalid-object cleanup behavior.
- Preserve unrelated dirty worktree files.
- Commit only files belonging to this feature on the current branch.

---

### Task 1: MCP Image Batch Tools And Folder Creation

**Files:**
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/server.ts`
- Modify: `supabase/functions/mcp/errors.ts` if new public error codes require registration
- Modify: `supabase/functions/mcp/image-tools.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Create: `supabase/functions/mcp/folder-tools.test.ts`
- Create: `supabase/migrations/20260812000000_mcp_create_folder.sql`
- Create: `tests/unit/database/mcp-create-folder-migration.test.ts`

**Interfaces:**
- Produce: `prepare_image_uploads({ projectId?, files[1..20] })`
- Produce: `complete_image_uploads({ projectId?, paths[1..20] })`
- Produce: `create_folder({ projectId?, name, description?, parentFolderId? })`
- Produce: `public.mcp_create_folder(p_project_id uuid, p_name text, p_description text, p_parent_folder_id uuid)` using authenticated identity only.

- [ ] Extract internal `prepareImageUpload` and `completeImageUpload` operations so single and batch Tools share validation, storage behavior, cleanup, and response objects.
- [ ] Expand single-Tool descriptions and path validation messages with the exact PUT and `image.path` provenance contract.
- [ ] Register `prepare_image_uploads` with a strict 1-20 file schema and ordered discriminated `items`, `preparedCount`, and `failedCount` output.
- [ ] Register `complete_image_uploads` with a strict 1-20 unique-path schema and ordered discriminated `items`, `completedCount`, and `failedCount` output.
- [ ] Ensure runtime storage failures are item-scoped while schema and authorization failures remain whole-call failures.
- [ ] Implement atomic `mcp_create_folder` SQL authorization, parent/project validation, scoped conflict mapping, insert, grants, and complete returned row.
- [ ] Register `create_folder`, map stable folder errors, and require owner/admin rather than general editor write permission.
- [ ] Add focused Deno and Jest tests after implementation for schemas, ordering, partial failures, path provenance, role behavior, nesting/conflicts, and endpoint exposure.
- [ ] Run `npm run check:mcp`, focused Deno MCP tests, and the migration Jest test.

### Task 2: Local Image Import Skill And Plugin Packages

**Files:**
- Create: `plugins/keco-codex/skills/keco-import-local-assets/SKILL.md`
- Create: `plugins/keco-codex/skills/keco-import-local-assets/agents/openai.yaml`
- Create: `plugins/keco-claude/skills/keco-import-local-assets/SKILL.md`
- Modify: `plugins/keco-codex/.codex-plugin/plugin.json`
- Modify: `plugins/keco-claude/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `tests/unit/plugins/keco-plugin.test.ts`
- Modify: `tests/unit/plugins/keco-claude-plugin.test.ts`
- Create: `tests/fixtures/plugins/keco-local-image-import-skill-evals.json`

**Interfaces:**
- Produce: Skill name `keco-import-local-assets` with discovery text for local Keco image/file-directory imports.
- Consume: live MCP schemas for exact Tool arguments; Skill owns only routing, field provenance, sequencing, recovery, and read-back rules.

- [ ] Write an ASCII-only Skill linked to the shared interaction contract, with explicit positive and negative routing boundaries.
- [ ] Encode inventory, unique project resolution, read/preview/confirmation, optional folder/table creation, batch PUT flow, stable file-name matching, checkpoint recovery, and authoritative read-back.
- [ ] Add concise Codex `agents/openai.yaml` metadata and expose a matching default prompt in the Codex manifest.
- [ ] Add the byte-equivalent Skill body to Claude while respecting Claude package layout and metadata conventions.
- [ ] Bump Codex build metadata and Claude clean semver consistently with their package rules; update Claude marketplace metadata.
- [ ] Add post-implementation routing/contract tests based on the apple-and-pear trace, including PixelLab/Godot/document/unsupported negatives and cross-plugin synchronization.
- [ ] Run focused Codex and Claude plugin Jest suites.

### Task 3: MCP Documentation And Capability Probes

**Files:**
- Modify: `docs/mcp/README.md`
- Modify: `scripts/probe-mcp-capabilities.ts`
- Modify: `tests/unit/mcp/capabilities-probe.test.ts`

**Interfaces:**
- Consume: the five public Tools `create_image_upload`, `complete_image_upload`, `prepare_image_uploads`, `complete_image_uploads`, and `create_folder`.
- Produce: canonical user/developer documentation and expected capability lists for account and legacy endpoints.

- [ ] Document the exact single upload protocol, ordered batch protocol, sensitive-data boundary, partial results, and folder creation/read-back sequence.
- [ ] Add the three new Tools to expected write capability lists without weakening account/legacy checks.
- [ ] Update capability tests after implementation and run the focused Jest test.

### Task 4: Integration Review, Verification, Cache Refresh, And Commit

**Files:**
- Review all files changed by Tasks 1-3.
- Modify only files required to resolve integration or review findings.

**Interfaces:**
- Consume: all Task 1-3 deliverables.
- Produce: one coherent branch state matching the approved spec and installed plugin contract.

- [ ] Inspect every subagent diff and report; reject overlapping or out-of-scope changes.
- [ ] Run focused tests, `npm run check:mcp`, complete MCP tests, both complete plugin suites, and relevant migration/capability Jest tests.
- [ ] Request an independent whole-change code review and resolve every Critical or Important finding.
- [ ] Re-run all affected verification commands after fixes.
- [ ] Execute the supported Codex cache-buster/reinstall flow and inspect the installed manifest, Skill, validator, and capability surface; refresh Claude local metadata where the environment supports it.
- [ ] Run `git diff --check`, inspect `git status`, stage only feature files, and commit the final implementation on the current branch.

