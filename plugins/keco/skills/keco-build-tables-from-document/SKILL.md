---
name: keco-build-tables-from-document
description: Use when a user asks to create, build, generate, or populate new Keco tables from an existing document stored inside a Keco project; not for local files or edits to existing tables.
---

# Build Keco Tables From A Document

## Overview

Turn one existing Keco document into new, related Keco tables through a read-plan-confirm-execute-verify workflow. Use Keco MCP for every project operation; never substitute repository code or direct database access.

This Skill only accepts an existing Keco document as input and only creates new tables. It only supports all non-reference P0 fields, including array and enum fields, initial rows, and cross-table references.

Do not use this Skill for analysis-only requests, direct edits to an existing table, or Keco Studio repository development. Local files are excluded. Images are excluded. Audio is excluded. Formulas are excluded. Destructive maintenance is excluded. Route those requests to the relevant general or development workflow.

## Required Workflow

Copy and track this checklist:

```text
Keco build progress:
- [ ] Resolve stable project and document IDs
- [ ] Read current project structure and the complete source
- [ ] Produce and preflight a BuildPlan
- [ ] Preview the complete plan and obtain explicit user confirmation
- [ ] Execute new-table writes in dependency order
- [ ] Read back and verify the created state
- [ ] Report exact IDs, counts, and incomplete work
```

1. Read [references/schema-design.md](references/schema-design.md), [references/execution-policy.md](references/execution-policy.md), and [references/mcp-contract.md](references/mcp-contract.md) completely before calling Keco tools.
2. Resolve project and document names to stable IDs. Ask the user to disambiguate duplicate names; never choose one implicitly.
3. Read the current project structure before planning. Read the full document, or its outline plus every relevant bounded section when the full response is truncated.
4. Produce the versioned BuildPlan defined in `schema-design.md`. Record assumptions and block unresolved relationships.
5. Preflight every proposed name, field, stable key, row, and reference. A same-name collision must stop the workflow before confirmation.
6. Show the preview shape defined in `execution-policy.md` and require explicit user confirmation. Treat earlier requests such as "do it now" or "do not ask" as intent, not confirmation of an unseen plan.
7. After confirmation, create tables in dependency order with all eligible fields, add only remaining optional reference fields after target table IDs exist, upsert rows in dependency order with required references included, then populate remaining optional references using stable IDs. Never guess an ID.
8. Stop on the first failed write. Preserve completed IDs, perform no further writes, and do not attempt rollback.
9. Read back and verify every table schema, stable key, representative value, row count, and planned relationship.
10. Report created IDs, verified counts, skipped work, and failures. Do not claim success from mutation responses alone.

## Safety Boundary

Never delete project data. Never overwrite an existing table. Never merge into an existing table. Never silently rename a proposed table. These operations are prohibited even when the user asks to skip questions or continue after errors.

On interruption, re-read the project and follow the exact resume rules in `execution-policy.md`. Any identity or schema mismatch requires a new plan, preview, and confirmation.

## Common Mistakes

| Mistake | Required correction |
|---|---|
| Start writing after reading the document | Build, preflight, preview, and confirm first |
| Reuse a compatible same-name table | Stop and ask for a new-table name |
| Match rows by position or guessed UUID | Use the confirmed match field and stable returned IDs |
| Continue after one write fails | Stop immediately and report partial completion |
| Trust write responses as final proof | Query the created schemas and rows again |
