# Keco Skill and Codex Plugin Design

**Date:** 2026-08-03
**Status:** Approved for implementation
**Primary user:** A Keco user operating an existing Keco project through Codex
**P0 workflow:** Build structured tables from an existing Keco project document

## 1. Outcome

Ship an installable `keco` Codex plugin that connects to the existing account-scoped Keco MCP server and teaches Codex one reliable user workflow: turn a Keco design document into new, related Keco tables.

The plugin packages discovery metadata, the remote MCP connection, and a reusable Agent Skill. The Skill owns workflow sequencing and safety policy. The MCP server remains the authorization, validation, audit, rate-limit, and atomic data-operation boundary.

P0 is Codex-first and reads source documents already stored in Keco. Local DOCX, PDF, and Markdown import are deferred.

## 2. Existing Baseline

The account-scoped MCP endpoint already provides:

- OAuth authentication and per-project authorization;
- project discovery and duplicate-name disambiguation through stable IDs;
- project structure, table, row, and document reads;
- table, field, row, document, and image writes;
- MCP Resources and Prompts;
- strict input validation, RLS, telemetry, rate limits, and capability filtering.

The repository also has two systems that are not the new user-facing Skill:

- `.claude/skills/` contains development guidance for contributors working on Keco Studio.
- `src/lib/agent/workflows/` contains executable composite tools used by Keco's internal Agent.

Both remain separate from the plugin Skill.

## 3. Design Decision

Use a Skill-led plugin instead of either a prompt-only wrapper or a new server-side composite workflow.

| Approach | Advantages | Disadvantages | Decision |
|---|---|---|---|
| Reuse only the MCP Prompt | Smallest implementation | Weak workflow guarantees, limited recovery policy | Reject |
| Plugin plus user-facing Skill | Fast iteration, explicit safety rules, no MCP duplication | Multi-call execution is not globally atomic | Adopt for P0 |
| New composite MCP Tool | Strongest deterministic execution | Requires server workflow state, preview tokens, and broader backend work | Reconsider after P0 evidence |

The architecture boundary is:

```text
User request
  -> keco-build-tables-from-document Skill
       -> plan, preview, confirmation, sequencing, recovery
       -> Keco MCP
            -> OAuth, permissions, validation, atomic operations, audit
```

Repeated failures observed in real Skill runs may justify moving only the fragile operation into a composite MCP Tool later. P0 does not preemptively duplicate the workflow in the server.

## 4. Plugin Package

The initial plugin lives in the Keco Studio repository so its Skill and MCP contract can be versioned together:

```text
keco-studio/
├── .agents/plugins/marketplace.json
└── plugins/keco/
    ├── .codex-plugin/plugin.json
    ├── .mcp.json
    ├── skills/
    │   └── keco-build-tables-from-document/
    │       ├── SKILL.md
    │       ├── agents/openai.yaml
    │       └── references/
    │           ├── schema-design.md
    │           ├── execution-policy.md
    │           └── mcp-contract.md
    └── assets/
        ├── icon.png
        └── logo.png
```

### 4.1 Plugin responsibilities

`.codex-plugin/plugin.json` defines the `keco` package, semantic version, publisher information, user-facing descriptions, capabilities, starter prompts, branding, Skill path, and MCP configuration path.

`.mcp.json` configures the existing account-scoped Streamable HTTP endpoint:

```text
https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp
```

The marketplace entry uses `AVAILABLE` installation and `ON_INSTALL` authentication. P0 uses the repository marketplace for development and controlled beta distribution. A separate public marketplace or curated submission is a later release concern.

P0 does not include Apps, Hooks, or plugin scripts. Those components must not be declared in the manifest.

### 4.2 Skill responsibilities

`SKILL.md` contains only the essential procedural workflow and routing rules. It must stay concise and use imperative instructions.

`agents/openai.yaml` provides UI metadata, a default prompt that explicitly names `$keco-build-tables-from-document`, the Keco brand color, and an MCP dependency on the `keco` server.

Detailed information is progressively disclosed:

- `schema-design.md` defines how document concepts map to tables, field types, stable row keys, enums, and references.
- `execution-policy.md` defines preview, confirmation, collision, retry, partial failure, and reporting behavior.
- `mcp-contract.md` maps workflow stages to current Keco MCP Resources, Prompts, and Tools.

## 5. Trigger Contract

The Skill triggers when a user asks to create or populate Keco tables from an existing Keco design document, specification, content plan, or similar structured source.

Positive examples include:

- "Turn my combat design document into Keco tables."
- "Create character, skill, and status-effect tables from this Keco document."
- "Build the data model described in the project specification."

The Skill must not trigger for:

- general analysis or summarization with no table-creation intent;
- direct edits to one existing table;
- local PDF, DOCX, or Markdown import in P0;
- Keco Studio repository development or debugging tasks.

## 6. Workflow Contract

### 6.1 Resolve scope

1. List accessible projects when no stable `projectId` is already known.
2. Match a project name only when it is unique.
3. Ask the user to disambiguate duplicate names and use the selected stable ID thereafter.
4. List project structure and documents.
5. Resolve the source document to a stable `documentId`.

### 6.2 Read source and destination state

1. Read the current project structure before planning.
2. Read the source document with bounded MCP operations.
3. For an oversized document, read its outline and relevant heading or line ranges rather than treating a truncated body as complete.
4. Do not perform writes during discovery, reading, or planning.

### 6.3 Produce a BuildPlan

Represent the proposed result with a versioned logical contract:

```ts
type BuildPlan = {
  version: 1;
  source: {
    projectId: string;
    documentId: string;
  };
  tables: Array<{
    key: string;
    name: string;
    description?: string;
    fields: PlannedField[];
    rows: PlannedRow[];
  }>;
  assumptions: string[];
  warnings: string[];
};
```

Each proposed table and relationship keeps enough source evidence to explain why it exists. Ambiguous concepts become explicit assumptions or warnings rather than silent guesses.

Every table must have a stable scalar matching field. Prefer a natural identifier from the document. If none exists, add a `Key` string field and derive deterministic values from the source entity names.

### 6.4 Preflight and preview

Before asking for confirmation:

1. Compare every proposed table name with the current project structure.
2. Validate field names, types, enum options, row keys, and relationship targets.
3. Detect unresolved references, duplicate keys, unsupported content, and ambiguous mappings.
4. Stop on a same-name table instead of reusing, overwriting, deleting, or silently renaming it.
5. Present table counts, field summaries, row counts, relationships, assumptions, and warnings.

Require explicit user confirmation of that preview. Cancellation must produce no writes.

### 6.5 Execute in dependency order

After confirmation:

1. Create every table with scalar fields that do not depend on another table.
2. Record returned table IDs immediately.
3. Add relationship fields only after all target table IDs are known.
4. Populate scalar and enum row values using a stable matching field.
5. Record returned or resolved row IDs.
6. Populate cross-table references only after all target rows exist.
7. Stop on an unexpected schema or identity mismatch.

This ordering prevents guessed UUIDs and dangling references.

### 6.6 Verify and report

1. Read back every created table schema.
2. Read enough rows to verify counts, stable keys, representative scalar values, and every planned relationship.
3. Compare the observed state with the BuildPlan.
4. Report created table IDs, completed row counts, verified relationships, skipped work, and any incomplete step.

Do not report success based only on successful write responses.

## 7. P0 Safety Boundaries

- Create new tables only.
- Never delete tables, fields, rows, documents, or references.
- Never overwrite or automatically merge an existing same-name table.
- Never bypass MCP permission checks or ask for credentials outside the OAuth flow.
- Never claim a truncated document was fully analyzed.
- Never infer a project from a duplicate name.
- Do not support local file import, images, audio, formulas, or destructive maintenance.
- Do not attempt global rollback after a partial multi-call failure.

The supported data model focuses on ordinary scalar fields, enum fields, initial rows, and cross-table references.

## 8. Failure and Recovery

MCP domain errors remain authoritative. The Skill explains the stable error outcome without hiding or rewriting its meaning.

| Failure | Required behavior |
|---|---|
| OAuth missing or expired | Stop and request the normal Keco connection flow |
| Viewer or revoked access | Stop before writes and report the permission boundary |
| Duplicate project name | Ask the user to choose by stable project ID |
| Same-name table exists | Stop before confirmation and request a rename or cancellation |
| Ambiguous document concept | Add an assumption or ask for clarification before confirmation |
| Unresolved reference target | Block the affected plan before execution |
| MCP validation or rate error | Stop at the failed step and preserve completed-object IDs |
| Verification mismatch | Report partial completion; do not claim success or delete data |

After interruption or partial failure, the next attempt first re-reads the project. It may resume only when existing table schemas and stable row keys exactly match the confirmed BuildPlan. Any mismatch requires a new preview and confirmation.

This provides safe continuation without introducing destructive rollback behavior. Stable row keys prevent duplicated rows during a valid resume. Table creation is resumed only by matching the exact recorded table identity and schema, never by assuming that a same-name table is safe.

## 9. Testing Strategy

### 9.1 Static validation

- Validate the plugin manifest and all declared asset paths.
- Validate the Skill frontmatter, folder name, and `agents/openai.yaml`.
- Assert that Apps and MCP entries are declared only when their companion files exist.
- Assert that the Skill references only MCP capabilities present in the current account endpoint.

### 9.2 Trigger evaluations

Maintain positive and negative prompt fixtures. The Skill must trigger for document-to-table creation requests and remain inactive for analysis-only, single-table edit, local-file import, and repository-development requests.

### 9.3 Workflow fixtures

Use representative Keco documents covering:

1. one table with scalar fields;
2. multiple tables with enum fields;
3. multiple tables with bidirectional concepts but one canonical reference direction;
4. missing natural identifiers requiring generated `Key` values;
5. a long document requiring segmented reads;
6. ambiguous concepts requiring assumptions;
7. a same-name destination table;
8. viewer-only access;
9. cancellation at preview;
10. interruption followed by safe resume.

Run write evaluations only in an approved disposable project. Never use production user projects as fixtures.

### 9.4 P0 acceptance criteria

- No MCP write call occurs before explicit confirmation.
- Cancellation produces zero project mutations.
- All accepted fixtures create the planned tables, fields, rows, and references.
- Verification detects intentionally injected missing rows or references.
- A retry after an interrupted row-writing stage creates no duplicate rows.
- Same-name tables and duplicate project names are never selected implicitly.
- Permission failures and partial completion are reported accurately.

## 10. Delivery Phases

### Phase 0: Contract freeze

- Record the account endpoint and exact MCP Tool, Resource, and Prompt dependencies.
- Select stable positive and negative Skill trigger examples.
- Prepare disposable source documents and expected BuildPlans.

### Phase 1: Local plugin MVP

- Scaffold `plugins/keco` and its repository marketplace entry.
- Add the remote MCP connection and OAuth-on-install policy.
- Implement the single P0 Skill and its three reference files.
- Add minimal Keco icon and logo assets.
- Validate and install the plugin locally.

### Phase 2: Workflow evaluation

- Run static, trigger, read-only planning, write, verification, and resume scenarios.
- Refine instructions based on raw failures rather than adding speculative complexity.
- Reinstall with a cachebuster for each local iteration and test in a new Codex thread.

### Phase 3: Controlled beta

- Release the repository marketplace plugin to approved Keco users.
- Monitor MCP audit outcomes, validation errors, partial executions, and user cancellations without storing document contents in plugin telemetry.
- Establish a versioned compatibility note between plugin and MCP server releases.

### Phase 4: Hardening and expansion

- Move demonstrably fragile deterministic operations into composite MCP Tools when evidence supports it.
- Consider local file ingestion, existing-table merge workflows, additional Skills, and public marketplace distribution as separate designs.

## 11. Success Measures

P0 is successful when a new user can install the plugin, authenticate with Keco, select an existing project document, approve a clear table plan, and receive verified related tables without manual MCP tool prompting.

Product evidence should answer:

- Did the correct Skill trigger?
- Did the preview match the final project state?
- Were any writes attempted before confirmation?
- Did retries duplicate tables or rows?
- Which workflow steps repeatedly required correction?

Only the last question should drive future MCP composite-tool work.

## 12. Non-Goals

- Replacing Keco's internal Agent workflows.
- Replacing MCP Prompts or exposing plugin instructions as server code.
- Supporting Claude-specific plugin packaging in P0.
- Importing local files.
- Updating or reconciling existing tables.
- Destructive changes or automatic rollback.
- Building a custom Codex App UI.
- Shipping multiple end-user Skills before the first workflow is reliable.
