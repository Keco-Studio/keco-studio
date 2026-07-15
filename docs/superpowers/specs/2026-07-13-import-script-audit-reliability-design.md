# Import Script Audit Reliability Design

**Date:** 2026-07-13
**Status:** Approved in conversation
**Branch:** `fix-script-defeat`

## Problem

Import Script deterministically parses the rainy-manor fixture into the same valid 23-node story on every run, but the mandatory MiniMax Auditor is not reliable. A real local ten-run probe produced only three successful imports and seven failures. Successful runs sometimes required two identical audit attempts. A real Vercel Production import also reached all deterministic stages successfully, then received three Auditor failures and terminated after 236.6 seconds.

The current Auditor payload contains four overlapping representations of the same story:

- exact source units and commands;
- the model or deterministic `StoryExtraction`;
- the hydrated `StoryDocument`;
- a projection containing logical rows, compiled table rows, document paths, and table paths.

MiniMax has produced contradictory issues while comparing these representations, including claims that one node simultaneously has different presentation types or that a compiled row disagrees with a source object when the values are equal. Repeating the same full audit up to three times turns acceptance into a nondeterministic vote and does not repair the candidate.

## Goals

- Keep an independent MiniMax semantic audit mandatory for every imported story.
- Audit the exact logical content that will be written to the Library through one canonical representation.
- Preserve strict checks for omissions, additions, speaker errors, presentation errors, choices, branch behavior, commands, and path isolation.
- Distinguish a real candidate defect from an unsupported Auditor allegation before rejecting an otherwise valid import.
- Keep database writes impossible until deterministic validation and LLM review both approve the result.
- Make local and Vercel behavior observable and reproducible without exposing story text, prompts, tokens, or credentials in logs.

## Non-Goals

- No LLM provider or model change.
- No removal or weakening of LLM review.
- No increase to the three-candidate retry limit as a substitute for correctness.
- No database schema, Excel column, player, or variable runtime change.
- No trust in LLM-generated source references, command values, graph targets, or table layout.

## Authority Boundary

The Converter remains responsible for semantic interpretation when deterministic parsing is not possible:

- classify background, narration, dialogue, system text, and choices;
- identify speakers and visible content;
- create node IDs, branches, jumps, merges, and terminal paths;
- attach exact source commands to nodes or choices.

The server remains responsible for deterministic facts:

- source unit and source-reference existence;
- exact visible-content traceability and coverage;
- canonical command parsing and ownership;
- graph target existence, reachability, cycles, and choice fallthrough;
- path enumeration and branch leakage invariants;
- deterministic compilation to Library rows.

The LLM Auditor remains responsible for semantic review of the final candidate:

- missing, duplicated, invented, or meaning-changed visible content;
- wrong speaker or presentation classification;
- missing, invented, or incorrectly worded choices;
- semantically incorrect branch targets, merges, endings, or repeated decisions;
- wrong command ownership or command meaning;
- path outcomes that do not preserve the source story.

The server may prove that an Auditor allegation is unsupported, but it may not invent a semantic pass. An unsupported failure must be dismissed by an independent targeted MiniMax review.

## Canonical Audit View

The full Auditor no longer receives `StoryExtraction`, `StoryDocument`, compiled table text, and parallel document/table paths together. The server constructs one versioned `StoryAuditView` after deterministic validation:

```json
{
  "version": 1,
  "entryRowId": "Node1",
  "rows": [
    {
      "id": "Node1",
      "presentation": "dialogue",
      "speaker": "Mysterious Woman",
      "content": "Entering the mountains late at night, wind and rain raging...",
      "sourceUnitIds": ["source:3"],
      "commands": [],
      "nextRowId": "Node2",
      "choices": []
    }
  ],
  "paths": [
    {
      "rowIds": ["Node1", "Node2", "Node9"],
      "choiceTexts": ["East guest room"],
      "terminalRowId": "Node9",
      "commands": []
    }
  ],
  "structuralUnitIds": ["source:7"]
}
```

This view is the sole candidate representation in the audit request. Every audit row maps one-to-one to a compiled Library row before persistence. Presentation is expressed once with semantic names rather than duplicated numeric `Type` fields. Choices and commands appear only under their owning row. Paths reference those same row IDs and do not carry a second copy of row content.

The Auditor request contains only:

- exact `sourceUnits`;
- canonical source commands;
- the canonical `StoryAuditView`.

The compiled Excel-shaped table is not a second semantic source of truth. Deterministic compiler tests prove that the accepted audit rows produce the required 17-column or extended table.

## Audit And Adjudication Flow

Every deterministic or converted candidate follows this sequence:

```text
source
  -> deterministic parser or Converter/Graph Planner
  -> deterministic validation
  -> canonical StoryAuditView
  -> Primary Auditor
       -> pass: accept candidate
       -> fail: validate issue references, then Targeted Adjudicator
            -> unsupported allegations: accept candidate
            -> one or more confirmed defects: reject candidate
```

The Targeted Adjudicator is an independent MiniMax request with a separate prompt and tool contract. It receives only:

- each alleged issue from the Primary Auditor;
- the referenced source units;
- the referenced canonical rows and relevant path summaries;
- the exact rule the allegation claims was violated.

For each allegation it returns `confirmed` or `unsupported` with the same issue and reference IDs. It cannot rewrite the story, introduce new issues, or approve unrelated parts of the candidate.

A Primary Auditor pass is sufficient because deterministic validation has already established structural facts; as today, a pass may carry only non-blocking minor notes. A Primary Auditor fail is not sufficient because real probes show frequent unsupported allegations. The candidate is accepted only when every allegation is marked unsupported. If the Targeted Adjudicator confirms any allegation from a failing verdict, the candidate is rejected regardless of the allegation's severity label. This prevents adjudication from weakening the current fail-closed policy.

## Retry Behavior

Deterministically parsed candidates are immutable. A confirmed semantic defect ends the import instead of submitting the unchanged candidate to the same Auditor two more times.

Converted candidates may use a confirmed issue as structured feedback for the next Extractor and Graph Planner candidate. Candidate generation remains capped at three attempts. Unsupported allegations do not consume another candidate attempt.

Provider-level aborted responses retain bounded transport retries. Each LLM request retains the 150-second deadline and request cancellation propagation. No failure, timeout, cancellation, malformed response, or confirmed issue may write a Library or partial rows.

## Prompt Rules

The Primary Auditor prompt must:

- declare `StoryAuditView` as the only candidate source of truth;
- compare candidate semantics directly with exact source units;
- never infer a mismatch from absent intermediate objects or numeric table types;
- cite existing source unit IDs and row IDs for every issue;
- return `pass` when it cannot identify a concrete supported issue;
- avoid stylistic preferences, alternate valid graph designs, or invented narrative prerequisites.

The Targeted Adjudicator prompt must:

- decide only whether each supplied allegation is supported by the supplied evidence;
- reject contradictory allegations that assign multiple values to the same canonical field;
- treat missing evidence as `unsupported`, not as permission to speculate;
- preserve strict review of visible content, choices, speakers, commands, and branch outcomes.

## Progress And Errors

Progress distinguishes the two LLM stages:

- `Waiting for Primary Auditor LLM response`;
- `Verifying Auditor issues with Targeted Adjudicator`.

User-facing failures include stable issue codes and affected row/source IDs without exposing raw prompts or hidden reasoning. A confirmed defect reports that the story failed semantic audit. Transport timeouts and provider aborts remain distinct from semantic failures.

## Observability

Each Import Script request records sanitized stage telemetry:

- deployment environment and Vercel region when available;
- LLM stage, candidate attempt, elapsed milliseconds, and outcome;
- provider request ID when returned in response headers;
- issue codes and referenced IDs, but not source text or prompts;
- whether a failure was confirmed or dismissed by adjudication.

The LLM client must expose response metadata without changing Agent Chat behavior. Import Script consumes that metadata through a scoped completion API or callback.

## Verification

Unit tests must prove:

- the Primary Auditor payload contains one canonical candidate representation and no `extraction`, `document`, compiled `table`, or duplicate table paths;
- every canonical row maps one-to-one to the final compiled logical row;
- a Primary pass accepts only after deterministic validation;
- a Primary fail with all allegations unsupported accepts the candidate;
- a Primary fail with any confirmed allegation rejects it;
- malformed issue IDs or adjudication output fail closed;
- deterministic candidates are not pointlessly regenerated or re-audited unchanged;
- converted candidates receive only confirmed issues as retry feedback;
- cancellation, timeout, provider abort, and database write ordering remain correct.

Regression tests must preserve:

- explicit nested choices, merges, independent endings, and dynamic option columns;
- the four trust paths with final values `2`, `0`, `4`, and `0`;
- rainy-manor east/west branch isolation;
- rejection of missing content, invented content, wrong speakers, modified commands, unreachable targets, and branch leakage;
- reference-compatible Excel and Library output.

## Live Acceptance

Before merge:

- rainy-manor succeeds 10/10 consecutive local MiniMax imports;
- rainy-manor succeeds 10/10 consecutive Vercel Production imports;
- nested-trust succeeds 10/10 consecutive real imports with all four outcomes correct;
- seeded invalid candidates are rejected 10/10 with confirmed issue codes;
- every accepted import contains a Primary Auditor pass or an all-unsupported Targeted Adjudicator verdict;
- no failed run creates a Library;
- stage latency and provider request metadata are captured for every real run.
