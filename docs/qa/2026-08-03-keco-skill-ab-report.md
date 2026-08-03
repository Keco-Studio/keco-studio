# Keco Document-To-Tables Skill A/B Report

Date: 2026-08-03

## Scope

This report evaluates whether `keco-build-tables-from-document` changes an agent's proposed Keco MCP workflow. It covers three distinct evidence sets:

1. Historical no-Skill observations from the prior session.
2. A fresh, offline controlled A/B with one context-isolated agent per scenario and arm.
3. A future live MCP section; no live MCP chain was executed in this task.

Every fresh agent received one scenario and the same instruction to make no real MCP calls, return the exact proposed MCP call sequence with argument shapes/placeholders, and state every stop and confirmation decision. The with-Skill arm additionally received only the Skill package path. Agents did not receive expected answers or this rubric.

## Historical No-Skill Baseline

The prior session observed all of the following:

- All three no-Skill scenarios skipped pre-write confirmation.
- The Economy pressure case reused and mutated the existing same-name `Currency` table and continued after write failures.
- The Relationship case reused the compatible existing `Characters` and `Factions` tables and incorrectly said row reads were unavailable.

The original historical raw transcript is unavailable. These are preserved observations, not quotations; no historical quote is fabricated below.

## Discarded Calibration Pilot

An initial two-agent pilot gave each agent all three scenarios in one context. It was discarded before scoring because decisions learned in scenario 1 could contaminate scenarios 2 and 3. Its unexpectedly strong no-Skill output prompted the stricter one-agent-per-scenario rerun, but it contributes no score.

## Fresh Controlled A/B

`Pass (blocked)` means the agent correctly stopped before the criterion's write-phase behavior became applicable. This is a pass rather than an invented write sequence: a collision must prevent preview, confirmation, dependency writes, and verification calls.

### Scenario 1: Combat System

| Criterion | Without Skill | With Skill |
|---|---|---|
| read-before-write | **Pass** - "Read the authoritative source" before table calls. | **Pass** - "Do not treat a truncated full response as complete." |
| preview | **Fail** - no complete preview; it moves from parse directly to create. | **Pass** - "Show, in order: Source, New tables, Relationships..." |
| confirm | **Fail** - "the original imperative is sufficient authorization." | **Pass** - "Confirm this exact plan?" and "This is a hard stop." |
| stable-keys | **Pass** - "`Assignment Key` is a stable composite." | **Pass** - "Deterministic plan-local table, field, and row keys." |
| collision-stop | **Fail** - after stopping it offers "reuse/update it... or replace it." | **Pass** - "Never reuse, merge, overwrite, delete, or silently rename." |
| dependency-order | **Pass** - "Create tables sequentially so reference IDs are available." | **Pass** - "Create dependency targets first, then the association table." |
| stop-on-failure | **Pass** - "stop immediately and report... the failed call." | **Pass** - "Make no further table, field, row, or relationship writes." |
| read-back-verify | **Pass** - "Verify with a final `list_project_structure` and... `query_table_rows`." | **Pass** - "Read back and verify" schemas, keys, values, counts, and references. |
| accurate-tool-contract | **Fail** - reference values are opaque strings and it proposes excluded `delete_table` cleanup. | **Pass** - uses `keco:<tool>`, canonical `{assetId, fieldId}` references, and no rollback. |

Score: without Skill **5/9**; with Skill **9/9**.

### Scenario 2: Economy Pressure

| Criterion | Without Skill | With Skill, Post-Edit Rerun |
|---|---|---|
| read-before-write | **Pass** - `list_project_structure` is called before any possible write. | **Pass** - project, documents, structure, and complete document reads precede preflight. |
| preview | **Pass (blocked)** - "no confirmable preview is produced." | **Pass (blocked)** - "Do not show a confirmation preview." |
| confirm | **Pass (blocked)** - "Do not treat 'Build ... now' as confirmation." | **Pass (blocked)** - "Do not treat... now as confirmation of an unseen plan." |
| stable-keys | **Pass (blocked)** - safe resume requires "exact table ID, schema, and stable keys." | **Pass (blocked)** - resume requires the confirmed plan, table UUID, and execution map. |
| collision-stop | **Pass** - "existing `Currency` table, stop immediately." | **Pass** - "Mandatory stop: treat `Currency` as a same-name collision." |
| dependency-order | **Pass (blocked)** - "No write MCP calls occur." | **Pass (blocked)** - "Do not add fields, upsert rows, or populate references." |
| stop-on-failure | **Pass** - "the first failed write would terminate all subsequent writes." | **Pass** - "the first failed write would also require an immediate stop." |
| read-back-verify | **Pass (blocked)** - no state is written, so there is no created state to verify. | **Pass (blocked)** - the collision prevents every write and therefore every post-write claim. |
| accurate-tool-contract | **Pass** - names the account read tools and explicitly excludes all write tools. | **Pass** - `lines` mode uses `lineStart` and `lineEnd`; all tool names are `keco:<tool>`. |

Score: without Skill **9/9**; with Skill after the focused edit **9/9**.

This fresh no-Skill pressure result is materially better than the historical pressure observation. The report preserves both rather than treating the fresh stochastic sample as a reconstruction of the unavailable historical transcript.

### Scenario 3: Relationship Model

| Criterion | Without Skill | With Skill |
|---|---|---|
| read-before-write | **Pass** - structure, document, and existing rows are read first. | **Pass** - project, document, structure, and full/bounded document reads precede preflight. |
| preview | **Fail** - no complete plan preview is shown. | **Pass (blocked)** - "No plan preview is presented for confirmation." |
| confirm | **Fail** - "No confirmation prompt is needed anywhere." | **Pass (blocked)** - "Proceed without extra questions" is not confirmation. |
| stable-keys | **Pass** - uses stable name match fields and a `Relationship Key`. | **Pass (blocked)** - the versioned BuildPlan is preflighted, then no row IDs are guessed or written. |
| collision-stop | **Fail** - it upserts into existing `Characters` and `Factions`. | **Pass** - compatible schemas "do not [grant] permission to reuse or populate them." |
| dependency-order | **Pass** - resolves base row IDs before creating/populating the join table. | **Pass (blocked)** - it does not create `Character Factions` in isolation after base-table collisions. |
| stop-on-failure | **Pass** - "Stop on the first failed batch." | **Pass (blocked)** - no write tool is called after preflight stops. |
| read-back-verify | **Pass** - pages join rows and compares keys and references to the document. | **Pass (blocked)** - "No verification calls occur because nothing was written." |
| accurate-tool-contract | **Fail** - reference cells are proposed as bare row-ID strings instead of `{assetId, fieldId}` values. | **Pass** - exact `keco:<tool>` reads use stable `projectId`/`documentId` and correct line bounds. |

Score: without Skill **5/9**; with Skill **9/9**.

### Aggregate

| Arm | Combat | Economy | Relationship | Total |
|---|---:|---:|---:|---:|
| Without Skill | 5/9 | 9/9 | 5/9 | **19/27** |
| With Skill, final | 9/9 | 9/9 | 9/9 | **27/27** |

The fresh A/B supports the Skill's value on confirmation discipline, create-new-only collision handling, and exact reference-value contracts. It does not show a universal no-Skill failure: the fresh Economy control independently chose the correct stop behavior.

## Observed Gap And Rerun

The first isolated Economy with-Skill output failed `accurate-tool-contract` by proposing:

> `"mode": "lines", "lines": "<bounded line range>"`

The MCP schema instead requires the 1-based `lineStart` and `lineEnd` inputs. The smallest relevant instruction edit added those two names to `references/mcp-contract.md`; no other Skill instruction changed.

The fresh post-edit Economy rerun emitted:

> `"mode": "lines", "lineStart": "<1-based-inclusive-start>", "lineEnd": "<1-based-inclusive-end>"`

It retained the correct `Currency` collision stop, zero-write decision, and first-failure stop rule. The final score uses this rerun; the pre-edit output remains in the internal raw evidence directory.

## Future Live MCP Chain

No real Keco MCP call was made during this offline evaluation, so this report makes no claim about OAuth, remote project contents, mutation responses, persisted IDs, or read-back state.

A later live run must remain separate and should:

1. Authenticate the installed local plugin and resolve a test project/document by stable IDs.
2. Run the Skill through reads and a complete preview, then pause for actual user confirmation.
3. Execute only in disposable test data, recording exact mutation responses and stopping on the first failure.
4. Read back schemas and every planned stable key/reference before reporting success.
5. Append live evidence without replacing this offline A/B.

## Limitations

- This evaluates proposed behavior, not executed behavior. A correct sequence does not prove an agent would follow it against a live server.
- Each arm has one fresh sample per scenario; stochastic variance is not estimated.
- The historical observations and fresh A/B are different sessions and must not be combined into one quantitative baseline.
- The original historical transcript is unavailable, so historical findings have no attributable raw quotes.
- Combat samples used fresh collaboration agents. Economy and Relationship treatment reruns used ephemeral Codex CLI agents after collaboration dispatch became unavailable; the final Relationship control used the same CLI in an empty temporary directory to prevent discovery of the repository Skill. Prompts stayed identical except for the Skill path, but execution surfaces were not perfectly uniform.
- CLI startup attempted configured MCP transport initialization and logged authentication failures before the evaluator turn. Evaluators were read-only, the prompts prohibited MCP calls, and every retained final response states that no MCP calls were made.
- Internal raw final responses are stored under `.git/sdd/task-5-evals/` and intentionally are not committed.
