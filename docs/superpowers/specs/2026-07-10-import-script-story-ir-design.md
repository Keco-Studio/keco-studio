# Import Script Story IR Design Spec

**Date:** 2026-07-10  
**Status:** Superseded by `2026-07-11-import-script-minimal-story-plan-design.md`
**Scope:** Replace prose-to-standard-text conversion with an audited Story IR pipeline, support dynamic choices and nested branches, and execute numeric story variables during playback  
**Related:** [Import Script branch playback spec](../../../specs/012-import-script-branch-playback/spec.md), [Agent design](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

### 1.1 Problem

Import Script currently uses different definitions of "standard format" at different stages:

- `looksLikeStructuredScript` accepts broad surface markers such as `O1:`.
- The parser only recognizes a narrower full-width grammar and only numeric `O1`, `O2`, and `Oend` branch labels.
- The validator compares stored option values such as `Jump O1` directly with labels such as `O1`.
- The table and player historically assumed three fixed options.

Consequently, input can be classified as directly importable even when options, labels, jumps, or quoted lines are misparsed. The imported table then contains no branch semantics, so playback can only reveal every physical row in order.

The confirmed reproduction contains half-width structural punctuation, paired Chinese quotes, nested labels such as `O1A_END`, branch-end commands written as `Jump Merge`, and a final `Oend` label. Current behavior classifies it as directly importable, reports no validation errors, emits empty option/jump columns, and performs a linear playback.

The real MiniMax-M3 contract test on the new Story IR path correctly identified all three choice groups in that reproduction, but returned every numeric command `value` as a JSON string despite the tool schema requiring a number. Strict parsing rejected the candidate on all three attempts. Provider retries therefore cannot be the only defense for redundant command fields when the authoritative numeric command already exists verbatim in the source.

### 1.2 Decision

Adopt **Story IR**, a versioned JSON intermediate representation, as the only internal story-semantic model.

- Valid legacy standard text may bypass LLM conversion only after lossless parsing and full semantic validation.
- All other text is converted directly to Story IR by a dedicated Converter LLM.
- A deterministic validator and an independent Auditor LLM must both approve the Story IR before any database write.
- Story IR is deterministically compiled into a library table with as many option columns as the script requires.
- Playback dynamically reads all option columns, follows nested branches, executes numeric variable commands, and interpolates variable placeholders.

The LLM no longer emits the old standard text format. The old format remains an accepted compatibility input only.

### 1.3 Goals

| ID | Goal |
|---|---|
| G1 | Prevent surface-level format detection from directly importing semantically broken scripts. |
| G2 | Convert prose and mixed-format scripts into a typed, strictly validated Story IR. |
| G3 | Detect omitted, duplicated, fabricated, mutated, or misattributed story content before import. |
| G4 | Preserve dialogue, options, events, speakers, and variable commands without plot rewriting. |
| G5 | Support arbitrary unique branch labels, arbitrary nesting depth, and no business-level choice-count limit. |
| G6 | Preserve old standard-text imports and old `Option0..Option2` tables without migration. |
| G7 | Stream conversion, validation, audit, retry, merge, and import progress in both import entry points. |
| G8 | Execute `=`, `+=`, `-=`, `*=`, and `/=` numeric commands and render `[variable]` placeholders during playback. |

### 1.4 Non-Goals

- Executing the legacy `If` field or arbitrary boolean expressions.
- Persisting playback progress or variable state across sessions.
- Auto-play, typewriter animation, audio, background, portrait, or CG command execution.
- Showing a user confirmation preview before import.
- Migrating existing script libraries to new option-command columns.
- Letting an LLM add dialogue, transitions, endings, choices, characters, events, or variable changes.

### 1.5 Relationship to the Earlier Spec

This design supersedes `specs/012-import-script-branch-playback/spec.md` where the two conflict, specifically:

- standard-text LLM output is replaced by Story IR;
- three fixed options are replaced by dynamic options;
- branch labels are no longer limited to `O` plus digits;
- validation includes source coverage and semantic auditing;
- player scope now includes numeric variable execution and interpolation.

Existing interactive playback behavior from the earlier spec remains required.

---

## 2. End-to-End Architecture

```text
Import modal / Agent Chat
        |
        v
Exact source capture + source hash
        |
        v
Legacy direct-import attempt
        |
        +-- lossless parse + full validation pass --> Story IR
        |
        +-- any loss or error ----------------------> Source-unit chunking
                                                         |
                                                         v
                                                Converter LLM -> partial Story IR
                                                         |
                                                         v
                                                command canonicalization
                                                         |
                                                         v
                                                deterministic chunk validation
                                                         |
                                                         v
                                                independent semantic audit
                                                         |
                                                         v
                                                merge + global graph validation
                                                         |
                                                         v
                                                global relationship audit
                                                         |
                                                         v
                                                dynamic table compiler
                                                         |
                                                         v
                                                library rows + player runtime
```

### 2.1 Component Boundaries

| Component | Responsibility | Must not do |
|---|---|---|
| Source Capture | Bind import to exact user text, message span, or attachment bytes. | Rewrite or summarize the script. |
| Source Unitizer | Produce stable, lossless source units with character offsets. | Infer story semantics. |
| Legacy Adapter | Parse compatible standard text into Story IR. | Decide correctness from surface regexes alone. |
| Converter | Map source units to Story IR using a JSON-only prompt. | Emit standard text or invent plot content. |
| Command Canonicalizer | Rebuild command variable, operator, and numeric value from the exact cited `source` command. | Infer a command not present in source or repair invalid command syntax. |
| Validator | Enforce schema, provenance, graph, command, and resource rules. | Make semantic guesses. |
| Auditor | Compare original content with Story IR for semantic preservation. | Repair or rewrite output. |
| Chunk Merger | Combine validated partial IR and resolve cross-chunk structure. | Silently rename explicit source labels. |
| Table Compiler | Convert validated IR into deterministic field definitions and rows. | Invoke an LLM. |
| Player Runtime | Traverse rows and maintain in-memory variable state. | Mutate persisted table values while playing. |

---

## 3. Source Capture

### 3.1 Import Modal

File and text modes pass exact input bytes/text to the import pipeline with:

```typescript
interface ImportSource {
  origin: 'file' | 'modal_text' | 'agent_message' | 'agent_attachment';
  sourceId: string;
  content: string;
  sha256: string;
  fileName?: string;
  messageId?: string;
  startOffset?: number;
  endOffset?: number;
}
```

The server computes `sha256`; the client-provided value is not trusted.

### 3.2 Agent Chat

The Agent decides to invoke `import_script` but does not copy or normalize the story into a trusted `sourceText` argument.

The tool references source data by one of:

- `messageId` plus exact `startOffset` and `endOffset` for a plain-text message;
- an attachment ID for uploaded files or structured message parts.

The server verifies that the referenced message belongs to the active conversation and user, validates offsets, slices the stored original content, and computes the source hash. The Agent may select a source span but cannot alter its bytes.

If the reference is missing, ambiguous, stale, unauthorized, or outside the message, the tool fails before conversion and asks for a resolvable source. The legacy free-form `sourceText` tool argument must not be the authoritative source after this design is implemented.

---

## 4. Story IR

### 4.1 Versioned Model

```typescript
interface StoryDocument {
  version: 1;
  entryLabel: string;
  nodes: StoryNode[];
}

type StoryNodeType = 'dialogue' | 'narration' | 'scene' | 'system';

interface StoryNode {
  label: string;
  type: StoryNodeType;
  speaker?: string;
  content: string;
  commands: StoryCommand[];
  next?: string;
  options: StoryOption[];
  sourceRefs: SourceRef[];
  structuralRepair?: StructuralRepair;
}

interface StoryOption {
  text: string;
  target: string;
  commands: StoryCommand[];
  sourceRefs: SourceRef[];
  structuralRepair?: StructuralRepair;
}

interface StoryCommand {
  source: string;
  variable: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: number;
  sourceRefs: SourceRef[];
}

interface SourceRef {
  sourceId: string;
  unitId: string;
  start: number;
  end: number;
}

interface StructuralRepair {
  kind: 'generated_label' | 'normalized_label' | 'resolved_jump';
  reason: string;
  sourceRefs: SourceRef[];
}
```

### 4.2 Invariants

- `version` must equal `1`.
- `entryLabel` must resolve to exactly one node.
- Labels are unique, case-sensitive identifiers matching `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`. They may represent any nesting depth.
- Every option `target` and node `next` value resolves to exactly one node.
- `options` is an array with no product-level count cap.
- Choice commands belong to the selected option and execute before entering its target.
- Node commands execute when the node is entered.
- `next` represents an unconditional jump after the node; absent `next` means fall through to the next Story IR node.
- A branch path must not fall through into a sibling option target. Independent branch endings without a source merge use a generated empty terminal node with explicit structural provenance.
- Every plot-bearing field has one or more valid `sourceRefs`.
- A `structuralRepair` may create or normalize labels and targets, but may not justify new plot-bearing content.
- Commands preserve the source variable name, operator, and numeric value exactly.
- Unknown JSON properties are rejected rather than ignored.

### 4.3 Content Preservation

Story content may undergo only safe presentation normalization:

- normalize line endings;
- trim surrounding whitespace introduced by structural syntax;
- remove matched outer quotation wrappers;
- normalize punctuation only in structural markers, never rewrite dialogue or narrative punctuation in a way that changes wording.

Prose that does not contain direct dialogue remains narration. The Converter must not invent quoted dialogue from a prose summary.

---

## 5. Direct-Import Qualification

`looksLikeStructuredScript` is not a sufficient direct-import gate. A legacy text qualifies only if all steps pass:

1. Parse the complete source through the Legacy Adapter.
2. Convert the parser result to Story IR.
3. Verify every plot-bearing source unit is represented.
4. Verify no parser syntax leaked into `speaker` or `content`.
5. Validate every label, option, jump, command, and reachable path.
6. Verify a deterministic semantic round trip does not lose options, commands, or source content.

Any uncertainty routes the original source, not parser output, to the Converter. A failed direct-import attempt is not an import error by itself.

Directly qualified legacy input does not call either LLM. This preserves the selected policy: valid standard scripts are fast, while superficially standard but semantically broken scripts receive LLM conversion.

---

## 6. LLM Conversion and Audit

### 6.1 Prompt Isolation

The existing standard-text `SYSTEM_PROMPT` in `scriptConversionService` must not be passed to either new model call. It requires full-width standard text, `O1..O3`, and at most three choices, which conflicts with this design.

Use two independent prompts and independent model requests:

| Prompt | Output | Context |
|---|---|---|
| JSON Converter | Story IR JSON conforming to a strict schema | Source units, allowed structural repairs, prior structured issues on retry |
| Semantic Auditor | Audit verdict JSON | Original source units and the candidate Story IR; no Converter rationale or hidden chain-of-thought |

The general Agent Chat prompt remains unchanged except for the `import_script` tool contract. It selects the tool but does not parse the story.

### 6.2 Structured Output

The Converter response must be parsed as structured JSON and validated against a server-owned schema. Markdown fences, prose explanations, multiple JSON documents, unknown keys, non-finite numbers, prototype keys, and general-purpose schema coercion are rejected. The only normalization exceptions are:

- known collection fields (`commands`, `options`, `sourceRefs`, and audit `issues`) may fill an omitted/empty value as `[]`, decode a JSON collection string, or wrap a non-empty singleton object as a one-item array;
- provider objects whose only key is `item` are recursively unwrapped;
- a source ref whose `unitId` resolves in the current server-owned chunk is canonicalized to that unit's server-owned `sourceId/start/end`;
- every object inside a known `commands` array must contain either one exact numeric command or a source-backed structural fragment containing exactly one numeric command; the server extracts that exact command token and deterministically replaces or supplies `source`, `variable`, `operator`, and `value` before strict schema parsing.
- an option `text` that contains a valid ASCII option-label prefix and a final matched metadata wrapper with a supported `Jump` marker is reduced to the display text between them; the option target and commands remain in their dedicated fields. Earlier parentheses inside the display text are preserved.

Command canonicalization is source reconstruction, not free-form coercion. It may turn a provider value such as `"1"` into `1`, or normalize a provider fragment such as `($trust+=1; jump O1)` to `$trust+=1`, only because that exact numeric token is present in the fragment. The later validator still requires the canonical command source to occur in the referenced authoritative source unit. A fragment containing zero or multiple supported numeric commands is ambiguous and fails conversion. A missing, malformed, unsupported, or uncited command source also fails; the canonicalizer never guesses a variable, operator, or value from surrounding prose. Unknown properties and missing or unknown `unitId` values still fail.

Option-text canonicalization is likewise structural and source-backed. For example, `O1: Go left. ($trust+=1; jump O1)` becomes `Go left.` because the label, jump metadata, target, and command already have separate Story IR fields. Text without a final structural jump wrapper is unchanged, including ordinary colons and parenthetical prose.

Source content is serialized as explicitly delimited untrusted data. Text such as `ignore previous instructions` remains story data and cannot change the system prompt or output contract.

### 6.3 Source Units and Chunking

The Source Unitizer creates stable units without splitting a dialogue, option, command, or structural declaration. It preserves exact offsets into the original source.

When the input does not fit one model context:

1. Prefer scene, branch, heading, and blank-line boundaries.
2. Assign each authoritative source unit to exactly one chunk.
3. Supply small read-only adjacent context where required; context units cannot be emitted by that chunk.
4. Convert and audit content chunk by chunk.
5. Merge partial documents using explicit labels and source references.
6. Run global deterministic graph validation.
7. Run a global relationship audit over the merged branch projection and source-unit inventory.

Chunk audits protect content fidelity. The global audit protects option-to-branch relationships without requiring the entire raw script to fit into a single request.

If one indivisible source unit alone exceeds the model context, conversion fails with that unit's source position and asks the user to split it. The service never truncates an oversized unit.

### 6.4 Deterministic Correctness Checks

The validator rejects a candidate when any of these is true:

- a source reference does not exist or its offsets do not match the referenced unit;
- a plot-bearing source unit is omitted;
- a source unit is duplicated without an explicitly allowed shared structural reference;
- dialogue, narration, option, character, event, or command content lacks provenance;
- variable name, operator, or value differs from the source;
- a command `source` cannot be parsed with the supported numeric-command grammar;
- parser or LLM noise appears as story content;
- a label is duplicated or invalid;
- a target is missing, ambiguous, or unresolved;
- a node is unintentionally unreachable;
- an automatic jump cycle contains no user-visible progress or choice;
- the document violates size, identifier-length, numeric, or schema safety limits.

### 6.5 Noise Definition

Noise is any output that is not supported by source evidence and is not an allowed structural repair. It includes:

- fabricated dialogue, narration, characters, events, choices, transitions, or variables;
- markdown, code fences, explanations, headings added by the model, or prompt text;
- branch declarations, `Jump` markers, command metadata, or option-label syntax stored as visible dialogue, narration, or option text;
- duplicate output derived from the same authoritative source unit;
- content assigned to the wrong speaker or branch;
- dropped source content hidden by a structurally valid graph;
- semantically changed wording or commands.

### 6.6 Auditor Contract

The Auditor returns only:

```typescript
interface StoryAudit {
  verdict: 'pass' | 'fail';
  issues: Array<{
    type:
      | 'omission'
      | 'added_content'
      | 'meaning_change'
      | 'wrong_speaker'
      | 'wrong_branch'
      | 'duplicate_content'
      | 'command_mutation'
      | 'untraceable_content';
    severity: 'minor' | 'major' | 'critical';
    sourceRefs: SourceRef[];
    outputPath?: string;
    evidence: string;
  }>;
}
```

Only whitespace, matched quote wrappers, line endings, and structural punctuation normalization may be `minor` and pass. Any major or critical issue fails the audit.

### 6.7 Retry Policy

- Maximum three conversion attempts for a failing chunk or affected chunk set.
- Deterministic validator and Auditor issues are returned as structured retry feedback.
- Auditor hidden reasoning and raw provider output are never fed to the Converter.
- Each audit is a fresh request with no Converter conversation history.
- A third failed attempt terminates the import and performs no database write.
- No fallback imports partial content or flattens branches.

---

## 7. Dynamic Table Compilation

### 7.1 Columns

The compiler calculates the maximum option count across all nodes and creates:

```text
Label
Type
Name
Content
If
Commands
Fg
Fg1
Cg
Option0
Option0_Next
Option0_Commands
...
OptionN
OptionN_Next
OptionN_Commands
Voice
Bg
```

There is no business-level maximum `N`. Existing request, model, database, and resource safety limits still apply.

`OptionN_Commands` is required because variable effects belong to the selected option. It also handles multiple choices that target the same node but apply different commands.

The compiler maps Story IR as follows:

- `dialogue` maps to table Type `1`; narration, scene, and system nodes map to Type `2`.
- `speaker` and `content` map to `Name` and `Content`.
- Numeric node commands are serialized into `Commands` without changing variable, operator, or value.
- Node `next` is serialized as `Jump <label>` in `Commands` after numeric node commands.
- Option text, target, and numeric commands map to the matching `OptionN`, `OptionN_Next`, and `OptionN_Commands` fields.

### 7.2 Determinism

- Options retain their source order.
- Dynamic option columns are sorted by numeric index, not lexical name.
- A missing option slot emits empty cells for that row.
- The compiler does not parse or reinterpret model text.
- Table compilation completes in memory before the first write.
- A write failure cleans up the library and all rows/fields created by that attempt; no half-created library is presented as successful.

### 7.3 Compatibility

- Existing tables with `Option0..Option2` and no option-command columns continue to load.
- Existing node-level `Commands` continue to execute on node entry.
- New tables prefer `OptionN_Commands` for choice effects.
- No existing library migration is required.
- The underlying generic library tables do not require a new fixed database column for each option; options remain dynamic field definitions.

---

## 8. Player Runtime

### 8.1 Dynamic Discovery

The table adapter discovers option triplets using numeric-name patterns:

```text
Option<number>
Option<number>_Next
Option<number>_Commands
```

It returns an ordered option array and supports the legacy pair when `_Commands` is absent.

### 8.2 Traversal

- Start at `Start` when present, otherwise at the first valid story node.
- Reveal only nodes reached on the active path.
- Pause on any non-empty option array.
- On selection, execute that option's commands once, resolve the target, and enter the target node.
- Execute node commands once per node entry.
- Follow node jump commands rather than falling through physical row order.
- Stop with a visible non-fatal error for unresolved targets or automatic no-progress cycles.
- Do not reveal unselected branch rows.

### 8.3 Variables

- Variables are in-memory numeric values scoped to one playback session.
- An uninitialized variable has value `0`.
- Supported operations are `=`, `+=`, `-=`, `*=`, and `/=`.
- Division by zero, non-finite results, invalid numeric input, or unknown commands stop playback with a clear error.
- `[name]` in displayed content resolves to the current numeric value without modifying stored content.
- Missing placeholders resolve to `0`.
- Restart clears revealed nodes, choices, warnings, errors, and all variable state.

### 8.4 Choice UI

- Use native focusable buttons for all options.
- Preserve option text without truncation.
- Use a scrollable option region when the list exceeds available viewport space.
- Keyboard advance remains disabled while waiting for a choice.

---

## 9. Streaming Progress

### 9.1 Service Event

The conversion service emits transport-independent progress events:

```typescript
interface ImportProgressEvent {
  phase:
    | 'source_read'
    | 'direct_import_check'
    | 'chunking'
    | 'conversion'
    | 'structure_validation'
    | 'semantic_audit'
    | 'merge'
    | 'table_compile'
    | 'database_write'
    | 'complete'
    | 'failed';
  attempt?: number;
  chunk?: number;
  totalChunks?: number;
  message: string;
}
```

Events never include full source text, prompts, hidden reasoning, or raw model output.

### 9.2 Entry Points

- Import Modal consumes a streaming import response and shows the current stage, attempt, and chunk count.
- Import Modal accepts arbitrary story text and does not present a canonical or preferred script grammar. Remove the standard-format example loader, expandable format guide, format-specific placeholder copy, and their unused UI state/styles.
- Legacy standard text remains a compatibility input but is not promoted as the format users should author.
- Agent Chat forwards the same service events through its existing SSE activity stream.
- Both entry points call the same conversion, validation, audit, compilation, and import services.
- A final success event includes the created library ID and row count.
- A final failure event includes safe structured issues with source positions and concise messages.
- Converter and Auditor progress text explicitly says that the service is waiting for an LLM response; the UI must not imply that synchronous chunking is still running.

Closing or interrupting the stream must not be reported as success. Database writes begin only after conversion and audit have completed.

### 9.3 Deadlines and Cancellation

- Each Import Script Converter or Auditor call has a 150-second hard deadline. This deadline is local to Story IR conversion and does not change Agent Chat LLM behavior.
- Converter and Auditor calls disable MiniMax-M3 thinking (`thinking: { type: 'disabled' }`) because these calls require bounded schema transformation rather than open-ended reasoning. Agent Chat keeps its existing thinking behavior.
- A deadline failure aborts the upstream request and terminates the import immediately. It is not one of the three semantic conversion attempts.
- Cancelling the response stream or aborting the incoming request aborts the active Converter/Auditor request.
- The NDJSON producer tracks its terminal/closed state and never enqueues into or closes an already cancelled stream.
- Timeout and cancellation paths never begin database writes and never create a partial library.

---

## 10. Security and Privacy

- Treat every source unit as untrusted model data, not an instruction.
- Use server-owned system prompts and schemas; never concatenate source into system instructions.
- Validate JSON without prototype inheritance and reject dangerous keys such as `__proto__`, `prototype`, and `constructor` where applicable.
- Enforce the 64-character label grammar, the existing 10 MB source limit, a 10 MB parsed JSON response limit, configured provider token limits, and finite numeric values.
- Do not impose an independent business cap on node, option, or source-reference counts; the byte and token limits are the physical bounds.
- Re-check authorization immediately before database writes.
- Verify Agent message/attachment ownership server-side.
- Do not log full scripts, prompts, raw model responses, or audit reasoning.
- Sanitize user-visible issue text before rendering.
- Preserve existing upload extension, request-size, UUID, folder ownership, and library creation permission checks.

---

## 11. Failure Semantics

| Failure | Result |
|---|---|
| Invalid or ambiguous source reference | Fail before any model call. |
| Direct-import validation failure | Route original source to LLM conversion. |
| Converter schema failure | Retry affected chunk. |
| Command source is missing, malformed, unsupported, or not present in its cited source unit | Retry affected chunk, then fail closed. |
| Deterministic validation failure | Retry affected chunk(s). |
| Auditor major/critical issue | Retry affected chunk(s). |
| Converter/Auditor exceeds 150 seconds | Abort the upstream request; fail immediately with a concise timeout error; create no library. |
| Client disconnects or cancels response | Abort conversion; emit no later result; create no library. |
| Three failed attempts | Fail import; create no library. |
| Global merge/graph failure | Retry involved chunks, then fail closed. |
| Table compilation failure | Fail before database write. |
| Database write failure | Clean up all data created by the attempt and report failure. |
| Player malformed command or unresolved jump | Stop playback with a visible error; do not crash. |

The system never imports the parseable subset, silently drops options, or converts a broken branch graph into a linear story.

---

## 12. Testing Strategy

Implementation follows failing-test-first development.

### 12.1 Unit Tests

- Story IR schema accepts valid nested/dynamic stories and rejects unknown fields or unsafe values.
- Legacy direct-import qualification rejects surface-valid but semantically broken input.
- Source references detect missing, out-of-range, duplicate, and uncovered units.
- Noise rules reject markdown, explanations, structural markers in content, duplicate dialogue, and untraceable output.
- Validator covers unique labels, entry resolution, arbitrary nested labels, targets, reachability, and no-progress cycles.
- Command parsing covers all five operators, exact source preservation, invalid syntax, division by zero, and non-finite results.
- Provider command canonicalization accepts string-typed redundant numeric values and single-command structural wrappers only when the exact numeric token is valid and cited, rebuilds the canonical command from that token, and rejects ambiguous, malformed, or uncited command sources.
- Dynamic columns cover 0, 1, 3, and 12 options and numeric ordering beyond 9.
- Chunk merger covers cross-chunk targets, duplicated overlap, conflicting labels, and affected-chunk retries.
- Player covers dynamic choices, command timing, interpolation, legacy commands, restart, and malformed data.

### 12.2 Integration Tests

- Import Modal source -> Converter -> Validator -> Auditor -> dynamic table rows.
- Agent tool resolves exact message spans and ignores model-rewritten `sourceText`.
- Mock Converter/Auditor responses exercise pass, retry, and third-attempt failure.
- No database mutation occurs before all model and validation stages pass.
- A database error does not leave a successful or visible partial library.
- Modal and Agent entry points emit consistent progress phases and terminal results.
- Existing linear standard scripts remain direct imports.
- Existing `Option0..Option2` tables remain playable.

### 12.3 End-to-End Acceptance Fixture

The user-provided Chinese nested-branch story is the primary regression fixture. All four paths must converge to `Oend` and display:

| Path | Final `trust` |
|---|---:|
| Left -> honest answer | 2 |
| Left -> walk away | 0 |
| Right -> real name | 4 |
| Right -> fake name | 0 |

Each path renders only its selected branches. `Jump Merge` is structurally repaired to the actual `Oend` merge target without changing dialogue, choices, events, or variable values.

### 12.4 Model Tests

CI uses deterministic mock responses and does not depend on provider randomness. An optional non-CI contract test may call the configured provider to verify JSON-schema adherence, prompt isolation, and representative audit behavior.

### 12.5 Verification Gate

Before completion, run the focused unit/integration suites, all parser and player regressions, lint, TypeScript checks, production build, and the relevant Playwright import/playback flow.

---

## 13. Expected Code Areas

The implementation plan must assign the following code areas to focused tasks:

- `src/lib/services/scriptConversionService.ts`
- new Story IR schema, source-unit, validation, audit, chunking, and table-compiler modules
- `src/lib/services/scriptImportService.ts`
- `src/lib/agent/tools/import-script.ts`
- Agent tool source-reference contract and context plumbing
- `src/app/api/import-script/route.ts`
- `src/components/libraries/ImportScriptModal.tsx`
- `src/components/libraries/utils/tableStructure.ts`
- `src/components/libraries/components/scriptPlayer.ts`
- `src/components/libraries/components/VisualNovelScriptView.tsx`
- focused tests for every module and both entry points

The old parser remains behind the Legacy Adapter. It is not the semantic model for LLM output.

---

## 14. Acceptance Criteria

1. A valid legacy standard script imports without an LLM call only when lossless semantic checks pass.
2. The confirmed broken sample cannot take the direct-import path.
3. Converter output is Story IR JSON; the old standard-text prompt is absent from the new conversion and audit calls.
4. Converter and Auditor use isolated prompts and strict structured output contracts.
5. Untraceable, omitted, duplicated, fabricated, mutated, or misattributed content prevents import.
6. Three failed attempts result in no created library or partial rows.
7. New libraries support dynamic `OptionN`, `OptionN_Next`, and `OptionN_Commands` columns without a business-level option cap.
8. Old three-option libraries play without migration.
9. Nested branches and labels matching `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/` resolve correctly.
10. The player executes numeric choice/node commands, defaults missing variables to zero, interpolates `[variable]`, and resets state on restart.
11. Both Import Modal and Agent Chat stream consistent progress and use the same audited pipeline.
12. Agent Chat imports exact stored user content by reference rather than trusting LLM-copied source text.
13. The four-path acceptance fixture produces final trust values `2`, `0`, `4`, and `0` and only renders selected branches.
14. Provider-specific wrappers, string values, or mismatched redundant fields cannot block a valid cited command or change its meaning: the server extracts exactly one numeric command token and rebuilds `source`, `variable`, `operator`, and numeric `value`, while ambiguous, malformed, or uncited sources still prevent import.
15. A structured option source such as `O1: Go left. ($trust+=1; jump O1)` compiles to display text `Go left.`, target `Jump O1`, and command `$trust+=1`; ordinary option punctuation and parentheses remain unchanged.
16. Import Script contains no standard-format example, format guide, or format-specific input instruction; its text entry remains neutral while legacy formatted scripts continue to import through the same compatibility path.
