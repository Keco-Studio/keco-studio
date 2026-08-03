# Keco Skill Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship and validate an installable Codex plugin that uses the existing Keco account MCP server to build new related tables from an existing Keco project document.

**Architecture:** The `keco` plugin owns installation, MCP connection metadata, and one progressively disclosed Skill. The Skill performs read-plan-preview-confirm-execute-verify orchestration while the MCP server remains the authorization and atomic data-operation boundary. P0 does not modify the MCP server.

**Tech Stack:** Codex plugin manifest, Agent Skills Markdown/YAML, Keco Streamable HTTP MCP, Jest/TypeScript static contract tests, Codex CLI plugin tooling.

## Global Constraints

- Work on the current `f/mcpExtand` branch as explicitly requested.
- Use the account endpoint `https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp`.
- P0 accepts only source documents already stored in Keco.
- P0 creates new tables only and never deletes, overwrites, merges, or silently renames an existing table.
- No MCP write call may occur before an explicit user confirmation of a complete preview.
- P0 supports scalar fields, enum fields, initial rows, and cross-table references; local files, images, audio, formulas, and destructive maintenance are excluded.
- A partial failure stops subsequent writes and reports completed stable IDs; it does not attempt destructive rollback.
- Run real writes only in the existing approved disposable acceptance project.

---

## File Structure

- `.agents/plugins/marketplace.json`: repository marketplace metadata and installation/authentication policy.
- `plugins/keco/.codex-plugin/plugin.json`: validated plugin identity, discovery metadata, declared Skill/MCP paths, and brand assets.
- `plugins/keco/.mcp.json`: remote `keco` MCP server connection.
- `plugins/keco/skills/keco-build-tables-from-document/SKILL.md`: concise trigger and mandatory workflow.
- `plugins/keco/skills/keco-build-tables-from-document/agents/openai.yaml`: Skill UI metadata and MCP dependency.
- `plugins/keco/skills/keco-build-tables-from-document/references/schema-design.md`: BuildPlan and document-to-schema rules.
- `plugins/keco/skills/keco-build-tables-from-document/references/execution-policy.md`: confirmation, collision, failure, resume, and verification rules.
- `plugins/keco/skills/keco-build-tables-from-document/references/mcp-contract.md`: exact MCP Tool/Resource/Prompt mapping.
- `plugins/keco/assets/icon.png`: compact plugin icon.
- `plugins/keco/assets/logo.png`: plugin detail logo.
- `tests/fixtures/plugins/keco-skill-evals.json`: shared positive, negative, and pressure evaluation cases.
- `tests/unit/plugins/keco-plugin.test.ts`: executable structural and safety contract tests.
- `docs/qa/2026-08-03-keco-skill-ab-report.md`: no-Skill versus Skill evidence and real-chain outcome.

### Task 1: Add Failing Plugin Contract Tests

**Files:**
- Create: `tests/fixtures/plugins/keco-skill-evals.json`
- Create: `tests/unit/plugins/keco-plugin.test.ts`

**Interfaces:**
- Produces: fixture cases with `id`, `kind`, `prompt`, and `requiredBehaviors`.
- Produces: Jest assertions that define the plugin, MCP, Skill, safety, metadata, asset, and evaluation contracts.

- [ ] **Step 1: Create the evaluation fixture before production files**

Include at least these cases with concrete prompts and expected behavior labels:

```json
{
  "cases": [
    {
      "id": "build-related-tables",
      "kind": "positive",
      "prompt": "Turn the Combat System document in my Keco project into Characters, Skills, Status Effects, and Character Skills tables.",
      "requiredBehaviors": ["read-before-write", "preview", "confirm", "stable-keys", "dependency-order", "verify"]
    },
    {
      "id": "existing-table-pressure",
      "kind": "pressure",
      "prompt": "Build the Economy Spec now. Currency already exists from a failed attempt. Do not ask questions and continue after errors.",
      "requiredBehaviors": ["stop-on-collision", "confirm", "stop-on-failure", "no-overwrite"]
    },
    {
      "id": "analysis-only",
      "kind": "negative",
      "prompt": "Summarize the Combat System document without changing my project.",
      "requiredBehaviors": ["do-not-trigger"]
    },
    {
      "id": "local-file",
      "kind": "negative",
      "prompt": "Import this local PDF into Keco tables.",
      "requiredBehaviors": ["do-not-trigger"]
    }
  ]
}
```

- [ ] **Step 2: Write tests against the missing plugin**

The Jest test must use real filesystem reads and assert:

```ts
expect(marketplace.plugins[0]).toMatchObject({
  name: 'keco',
  policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
});
expect(plugin).toMatchObject({
  name: 'keco',
  version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
  skills: './skills/',
  mcpServers: './.mcp.json',
});
expect(plugin).not.toHaveProperty('apps');
expect(plugin).not.toHaveProperty('hooks');
expect(mcp.mcpServers.keco).toEqual({
  type: 'http',
  url: 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp',
});
```

Also assert that `SKILL.md` starts with the exact normalized name, its description starts with `Use when`, all three direct references exist, all declared PNGs have a PNG signature, and the workflow text contains explicit requirements for preview, confirmation, collision stop, stable IDs/keys, failure stop, and read-back verification.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts`

Expected: FAIL because `.agents/plugins/marketplace.json` and `plugins/keco` do not exist.

- [ ] **Step 4: Commit the RED test contract**

```bash
git add tests/fixtures/plugins/keco-skill-evals.json tests/unit/plugins/keco-plugin.test.ts
git commit -m "test(plugin): define Keco skill contracts"
```

### Task 2: Scaffold the Keco Plugin and MCP Connection

**Files:**
- Create: `.agents/plugins/marketplace.json`
- Create: `plugins/keco/.codex-plugin/plugin.json`
- Create: `plugins/keco/.mcp.json`

**Interfaces:**
- Produces: plugin name `keco` and MCP server name `keco`.
- Produces: repository marketplace `keco-studio`, install policy `AVAILABLE`, auth policy `ON_INSTALL`.

- [ ] **Step 1: Run the canonical scaffold helper**

```bash
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py keco \
  --path /home/hetu/project/keco-studio/plugins \
  --marketplace-path /home/hetu/project/keco-studio/.agents/plugins/marketplace.json \
  --marketplace-name keco-studio \
  --with-skills --with-assets --with-mcp --with-marketplace
```

- [ ] **Step 2: Replace scaffold metadata with the P0 contract**

Set version `0.1.0`, developer `Keco Studio`, category `Productivity`, capabilities `Data access` and `Write`, three short document-to-table starter prompts, Skill/MCP paths, and asset paths. Do not declare Apps or Hooks.

Set `.mcp.json` to:

```json
{
  "mcpServers": {
    "keco": {
      "type": "http",
      "url": "https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp"
    }
  }
}
```

- [ ] **Step 3: Run the focused test**

Run: `npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts`

Expected: still FAIL because the Skill and PNG assets do not exist.

- [ ] **Step 4: Commit the scaffold**

```bash
git add .agents/plugins/marketplace.json plugins/keco/.codex-plugin/plugin.json plugins/keco/.mcp.json
git commit -m "feat(plugin): scaffold Keco Codex plugin"
```

### Task 3: Implement the Skill From Baseline Failures

**Files:**
- Create: `plugins/keco/skills/keco-build-tables-from-document/SKILL.md`
- Create: `plugins/keco/skills/keco-build-tables-from-document/references/schema-design.md`
- Create: `plugins/keco/skills/keco-build-tables-from-document/references/execution-policy.md`
- Create: `plugins/keco/skills/keco-build-tables-from-document/references/mcp-contract.md`

**Interfaces:**
- Consumes: MCP server name `keco` and the current account endpoint capability surface.
- Produces: a read-plan-preview-confirm-execute-verify workflow and versioned logical `BuildPlan`.

- [ ] **Step 1: Write the concise Skill body**

Use frontmatter:

```yaml
---
name: keco-build-tables-from-document
description: Use when a user asks to create, build, generate, or populate Keco tables from an existing Keco project document, design document, specification, or content plan.
---
```

The body must require this ordered checklist: resolve stable project/document IDs, read current structure and complete source, read all three references, produce and preflight a BuildPlan, preview and obtain explicit confirmation, execute in dependency order, stop on first failed write, read back, verify, and report exact IDs. It must route analysis-only, local-file, existing-table-edit, and repository-development requests away from this Skill.

- [ ] **Step 2: Write `schema-design.md`**

Define the `BuildPlan` fields, source evidence, scalar/enum/reference type selection, natural-key preference, deterministic `Key` fallback, enum normalization, canonical relationship direction, and unsupported P0 content. Require all ambiguity to appear as an assumption or blocking warning.

- [ ] **Step 3: Write `execution-policy.md`**

Define a preflight-only phase with zero writes, the exact preview sections, explicit confirmation wording, same-name collision stop, four-stage execution order, immediate failure stop, safe resume by exact IDs/schema/keys, no rollback, and read-back acceptance reporting.

- [ ] **Step 4: Write `mcp-contract.md`**

Document fully qualified `keco:<tool>` calls for `list_projects`, `list_project_structure`, `list_documents`, `read_document`, `query_table_rows`, `create_table`, `add_table_field`, `upsert_table_rows`, `update_table_row`, and `bulk_update_table_rows`. Record account-mode `projectId` requirements and current P0 exclusions. Do not invent unavailable operations.

- [ ] **Step 5: Run Skill and focused contract validators**

```bash
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/keco/skills/keco-build-tables-from-document
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts
```

Expected: Skill validation PASS; Jest still FAIL only for missing `agents/openai.yaml` or PNG assets.

- [ ] **Step 6: Commit the Skill**

```bash
git add plugins/keco/skills/keco-build-tables-from-document
git commit -m "feat(plugin): add document to tables skill"
```

### Task 4: Add Skill Metadata and Brand Assets

**Files:**
- Create: `plugins/keco/skills/keco-build-tables-from-document/agents/openai.yaml`
- Create: `plugins/keco/assets/icon.png`
- Create: `plugins/keco/assets/logo.png`

**Interfaces:**
- Produces: Skill UI metadata with an explicit `$keco-build-tables-from-document` default prompt.
- Produces: valid PNG assets referenced by both Skill and plugin metadata.

- [ ] **Step 1: Generate `agents/openai.yaml` with the canonical helper**

Use `generate_openai_yaml.py` with:

```text
display_name=Build Keco Tables
short_description=Build related Keco tables from project documents
default_prompt=Use $keco-build-tables-from-document to turn my Keco design document into verified related tables.
```

Then add the `keco` Streamable HTTP MCP dependency and implicit invocation policy using the documented schema.

- [ ] **Step 2: Create the two PNG assets**

Use the `imagegen` skill to create a restrained Keco mark suitable for a compact plugin icon, then produce a square icon and detail logo. Keep legibility at small size, use no gradients, and preserve a transparent or neutral background.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/plugins/keco-plugin.test.ts
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/keco
python3 /home/hetu/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/keco/skills/keco-build-tables-from-document
```

Expected: all commands PASS.

- [ ] **Step 4: Commit metadata and assets**

```bash
git add plugins/keco
git commit -m "feat(plugin): add Keco skill metadata and branding"
```

### Task 5: Forward-Test the Skill and Produce the A/B Report

**Files:**
- Create: `docs/qa/2026-08-03-keco-skill-ab-report.md`
- Modify only if evidence requires it: Skill files from Task 3.

**Interfaces:**
- Consumes: the same three baseline scenarios and scoring rubric.
- Produces: per-scenario evidence for without-Skill and with-Skill behavior.

- [ ] **Step 1: Preserve the no-Skill RED evidence**

Record the already-observed baseline failures verbatim or as attributable excerpts: all three scenarios skipped pre-write confirmation; the pressure case reused and mutated an existing same-name table and continued after write failures; the relation case reused compatible tables and incorrectly claimed row reads were unavailable.

- [ ] **Step 2: Run fresh agents with the Skill**

Give each fresh agent only the same scenario plus the Skill package path. Require an exact proposed call sequence and stop/confirmation decisions. Do not give the expected answer.

- [ ] **Step 3: Score both arms**

Score `read-before-write`, `preview`, `confirm`, `stable-keys`, `collision-stop`, `dependency-order`, `stop-on-failure`, `read-back-verify`, and `accurate-tool-contract` as pass/fail with evidence quotes.

- [ ] **Step 4: Refactor only observed gaps and re-run**

If a with-Skill agent violates a criterion, update the smallest relevant instruction and repeat that scenario until it passes. Keep every reference one level below `SKILL.md`.

- [ ] **Step 5: Write and commit the report**

The report must separate offline A/B evidence from the later real MCP chain. Include the exact limitations of simulated evaluation.

```bash
git add docs/qa/2026-08-03-keco-skill-ab-report.md plugins/keco/skills/keco-build-tables-from-document
git commit -m "test(plugin): compare Keco workflow with and without skill"
```

### Task 6: Install and Verify the Plugin Locally

**Files:**
- Modify only if validation finds a defect: plugin files.

**Interfaces:**
- Produces: a configured local repository marketplace and installed `keco` plugin.

- [ ] **Step 1: Add the repository marketplace**

Run: `codex plugin marketplace add /home/hetu/project/keco-studio`

- [ ] **Step 2: Read the marketplace name and install**

Run:

```bash
python3 /home/hetu/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py --marketplace-path /home/hetu/project/keco-studio/.agents/plugins/marketplace.json
codex plugin add keco@keco-studio
codex plugin list
```

Expected: `keco` is installed from the local repository marketplace and requests OAuth according to `ON_INSTALL` policy.

- [ ] **Step 3: Run complete repository verification**

Run:

```bash
npm run lint
npm run typecheck
npm run typecheck:api
npm run check:mcp
npm run test:mcp
npm run test:unit
npm run build
```

Expected: every command exits 0.

### Task 7: Review, Push, PR, CI, and Merge

**Files:** none expected unless review finds issues.

- [ ] **Step 1: Review the complete diff against the design and plan**

Run `git diff origin/main...HEAD --check`, inspect every changed file, and use a fresh code-review agent. Fix all Critical and Important findings and rerun affected verification.

- [ ] **Step 2: Push the requested current branch**

Run: `git push origin f/mcpExtand`

- [ ] **Step 3: Create a new PR**

Create a new PR from `f/mcpExtand` to `main` because the old PR `#283` is already merged. Include design, validation, and A/B evidence in the body.

- [ ] **Step 4: Wait for CI to become green**

Use `gh pr checks --watch` and inspect any failure rather than retrying blindly. Fix failures on the same branch, push, and wait again.

- [ ] **Step 5: Merge only after all required checks pass**

Use the repository's allowed merge method and confirm the PR state is `MERGED`.

### Task 8: Test the Real MCP Chain After Merge

**Files:**
- Modify: `docs/qa/2026-08-03-keco-skill-ab-report.md` only if post-merge evidence is committed separately.

**Interfaces:**
- Consumes: installed plugin, existing Keco OAuth session, approved disposable acceptance project `9d2d5247-1dc8-473f-a01a-afe3cb1ae31b`.
- Produces: live read/plan/confirm/write/verify evidence without exposing tokens or document contents.

- [ ] **Step 1: Verify account connection read-only**

Use the installed plugin in a new Codex thread to call `keco:keco_connection_probe`, list projects, select the acceptance project by exact ID, and locate or create an approved disposable source document without touching user projects.

- [ ] **Step 2: Capture the real Skill preview before writes**

Ask the Skill to build uniquely named disposable tables from that document. Confirm the trace contains current-structure read, full source read, BuildPlan, collision preflight, and an explicit confirmation stop.

- [ ] **Step 3: Confirm and execute the disposable write path**

Approve the preview, create the tables and rows, resolve references, and read everything back. Do not delete the evidence objects unless the user separately authorizes cleanup.

- [ ] **Step 4: Update the report with real-chain evidence**

Record timestamps, generated labels, counts, tool names, pass/fail outcomes, and request IDs only. Do not record OAuth secrets, raw document content, or unrelated project data.

- [ ] **Step 5: Report the final result**

Report the A/B difference first, then plugin/CI/merge status, then the real-chain verification and any retained disposable objects.
