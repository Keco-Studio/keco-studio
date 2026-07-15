# Import Script LLM Latency Design

**Date:** 2026-07-13
**Status:** Approved in conversation

## Problem

A successful natural-language Import Script conversion currently makes at least six sequential MiniMax requests: Extractor, Graph Planner, two Graph Auditor votes, and two Content/Table Auditor votes. A split vote adds a seventh request. Real profiling of the rainy-manor fixture took 48.161 seconds; LLM requests consumed effectively all of that time while segmentation, deterministic validation, and table projection took less than 10 milliseconds.

The duplicate votes repeat the same prompt and evidence. They increase latency and can create an unnecessary third call when nondeterministic verdicts split, but they do not add a new audit dimension.

## Decisions

Natural-language imports use this pipeline:

```text
Extractor -> Graph Planner -> Combined Auditor -> deterministic acceptance
```

Explicit legacy-format imports and unambiguous consecutively numbered natural branches continue to use deterministic parsing followed by the same Combined Auditor. The numbered parser only accepts `Branch 1/2/...: Choose [...]` sections with consecutive ordinals and non-empty branch content; ambiguous prose falls back to the three-stage LLM pipeline.

The Combined Auditor remains an independent MiniMax request. It checks all semantic and presentation concerns previously split across the Graph Auditor and Content/Table Auditor:

- missing, duplicated, invented, or meaning-changed content;
- incorrect speakers and presentation types;
- missing or incorrect choices;
- wrong branch targets, invalid merges, branch leakage, and repeated decisions;
- command mutation or wrong command ownership;
- compiled table and enumerated path mismatches.

The server continues to reject invalid model contracts, unresolved targets, unreachable nodes, automatic cycles, invalid commands, incomplete source coverage, and other deterministic failures before the audit. Database writes remain impossible until both deterministic validation and the LLM audit pass.

## Retry And Failure Behavior

- A passing first candidate for arbitrary prose requires exactly three LLM calls.
- Explicit and unambiguous numbered-branch candidates require exactly one LLM audit call.
- An Auditor rejection starts a fresh candidate attempt with its structured issues supplied to the next Extractor.
- Candidate attempts remain capped at three.
- Provider-aborted responses retain the existing bounded retry behavior.
- Each request retains the 150-second deadline and cancellation propagation.
- No partial library or table rows are written on failure.

## Prompt And Payload

The existing full Auditor becomes the Combined Auditor. Its prompt explicitly owns graph/path checks formerly emphasized by the Graph Auditor. Its input remains source units, canonical commands, extraction, hydrated document, and the compiled projection containing rows, table, paths, and table paths. The dedicated Graph Auditor prompt, tool, message builder, request function, and consensus helper are removed.

## Progress

Progress reports one `Combined Auditor` wait after table projection. Deterministic candidates report deterministic parsing, validation, and projection rather than calling all such candidates explicit. Existing phases and stream contracts stay unchanged so API and UI consumers need no migration.

## Verification

- Unit tests prove a first-attempt natural-language import calls only Extractor, Graph Planner, and Combined Auditor.
- Unit tests prove Auditor rejection feeds issues into a fresh candidate attempt.
- Prompt tests prove the Combined Auditor covers branch exclusivity, merges, repeated decisions, and absence of invented prerequisites.
- Existing explicit-format, deterministic-validation, timeout, cancellation, table, and playback tests remain green.
- A real MiniMax import of the rainy-manor fixture records total duration, stage durations, result node count, and audit verdict.

## Measured Result

- Rainy-manor numbered branches: 3.634 seconds, 23 nodes, one Combined Auditor call, passed.
- Arbitrary unformatted fog-port story: 12.796 seconds, 8 nodes, one Extractor, one Graph Planner, one Combined Auditor, passed.
- Previous rainy-manor baseline: 48.161 seconds and seven LLM calls.

## Non-Goals

- No provider change.
- No weakening or removal of LLM semantic review.
- No database, Excel schema, table compiler, or player changes.
- No parallel auditing, streaming token display, or Extractor contract redesign in this change.
