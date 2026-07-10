# Import Script Minimal Story Plan Design

**Date:** 2026-07-11  
**Status:** Proposed; design direction approved, written spec pending review  
**Scope:** Replace the MiniMax-facing Story IR contract with deterministic source segmentation, a flat relationship plan, mandatory MiniMax semantic audit, and server-owned StoryDocument hydration  
**Supersedes:** The Converter, Auditor, source-reference, retry, and chunking design in `2026-07-10-import-script-story-ir-design.md`. Existing table compilation and playback requirements remain in force.

---

## 1. Problem

The current Import Script path asks MiniMax-M3 to generate a deeply nested Story IR document. Every node, option, command, and structural repair repeats complete source references containing `sourceId`, `unitId`, `start`, and `end`. Commands also repeat values that already exist in source text.

Real provider probes show that this contract is not stable on MiniMax-M3 even when tool calling and a strict JSON Schema are enabled:

- required `sourceRefs` are sometimes omitted;
- collection values may be emitted as nested arrays or provider-specific `item` objects;
- objects may contain linked shapes such as `{ item, next }`;
- numeric values may be emitted as strings;
- valid semantic extraction may still fail exact evidence checks after normal presentation cleanup.

The existing integration test does not exercise this boundary. It supplies a hand-built correct StoryDocument through a mocked LLM client, then verifies compilation and playback. It proves that a correct IR can be played, but not that MiniMax can produce the IR from user text.

The result is a pipeline that is strict about unstable provider serialization while still leaving gaps in global branch validation, semantic chunking, duplicate detection, and automatic-cycle rejection.

---

## 2. Decisions

### 2.1 Provider

MiniMax-M3 remains the only LLM provider for this feature. This design does not add a fallback provider or a second vendor.

Converter and Auditor are separate MiniMax requests with independent system prompts and no shared conversation history.

### 2.2 Responsibility Boundary

The server owns exact data. MiniMax owns semantic classification and relationship decisions.

The server is responsible for:

- preserving source bytes and offsets;
- segmenting lines into exact display and structural atoms;
- parsing explicit labels, jumps, and numeric commands;
- hydrating the final StoryDocument;
- applying role mappings;
- validating identifiers, coverage, commands, reachability, branches, merges, and cycles;
- compiling the table;
- controlling retries, deadlines, cancellation, and database writes.

MiniMax is responsible for:

- classifying source segments as dialogue, narration, scene, or system content;
- grouping exact source segments into ordered story nodes;
- connecting nodes with unconditional transitions and choices;
- associating server-parsed commands with the correct node or choice;
- auditing every final candidate against the original source and compiled table projection.

MiniMax never authors visible story text, source offsets, numeric command values, or database rows.

### 2.3 Mandatory Audit

Every import candidate requires a MiniMax Auditor pass before database writes, including candidates produced entirely by the deterministic structured parser.

No direct-import path bypasses semantic audit.

### 2.4 Compatibility

- Existing script libraries remain unchanged.
- Existing dynamic option columns and player behavior remain compatible.
- The current table compiler may continue consuming a server-hydrated StoryDocument.
- No database migration is required.

---

## 3. Architecture

```text
Exact source text
       |
       v
Source unitization and deterministic segmentation
       |
       +-- explicit structure parser produces candidate plan
       |
       +-- otherwise MiniMax Converter produces candidate plan
       |
       v
Server plan validation and StoryDocument hydration
       |
       v
Deterministic story and graph validation
       |
       v
In-memory table compilation and playback projection
       |
       v
Mandatory MiniMax Auditor
       |
       +-- pass --> authorization check --> database write
       |
       +-- fail --> one repair attempt --> validate and audit again
                           |
                           +-- pass --> database write
                           +-- fail --> terminate without writes
```

The database is not touched until segmentation, conversion, hydration, deterministic validation, table compilation, and semantic audit all complete successfully.

---

## 4. Source Model

### 4.1 Source Units

The source unitizer preserves the existing server-owned source identifier and exact character offsets. Empty lines may be retained as boundaries but are not sent as story content.

```typescript
interface SourceUnit {
  id: string;
  sourceId: string;
  text: string;
  start: number;
  end: number;
}
```

MiniMax receives stable unit and segment IDs. It does not receive responsibility for reproducing offsets.

### 4.2 Source Segments

The deterministic segmenter derives exact, immutable source segments.

```typescript
type SourceSegmentKind =
  | 'speaker'
  | 'dialogue'
  | 'stage_direction'
  | 'narration'
  | 'scene_heading'
  | 'choice_text'
  | 'branch_marker'
  | 'command'
  | 'jump_hint'
  | 'structural';

interface SourceSegment {
  id: string;
  unitId: string;
  kind: SourceSegmentKind;
  text: string;
  start: number;
  end: number;
  display: boolean;
  required: boolean;
}
```

Segment text is always sliced from the authoritative source. Safe removal of matched structural wrappers is performed by the server and recorded through the segment span.

The segmenter recognizes, where present:

- `Speaker: dialogue` and full-width-colon variants;
- a speaker followed by a parenthetical performance cue;
- complete narration and background lines;
- headings and branch declarations;
- explicit option labels and display text;
- explicit branch labels and merge markers;
- `Jump` targets and aliases;
- numeric commands using `=`, `+=`, `-=`, `*=`, and `/=`.

When a line cannot be safely split, its complete text remains one narration-capable segment. The server does not guess substrings.

### 4.3 Commands

Numeric commands are parsed before any model request.

```typescript
interface SourceCommand {
  id: string;
  segmentId: string;
  source: string;
  variable: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: number;
}
```

MiniMax only returns command IDs. It cannot change the variable, operator, value, or source spelling.

---

## 5. MiniMax Relationship Plan

### 5.1 Flat Contract

The MiniMax-facing plan uses flat collections, no recursive definitions, no source-reference objects, and no optional fields.

```typescript
interface StoryRelationshipPlan {
  version: 2;
  entryNodeId: string;
  nodes: PlannedNode[];
  choices: PlannedChoice[];
}

interface PlannedNode {
  id: string;
  type: 'dialogue' | 'narration' | 'scene' | 'system';
  speakerSegmentId: string;
  contentSegmentIds: string[];
  commandIds: string[];
  nextNodeId: string;
}

interface PlannedChoice {
  id: string;
  fromNodeId: string;
  textSegmentIds: string[];
  targetNodeId: string;
  commandIds: string[];
}
```

Empty strings and empty arrays represent absent values. `null`, omitted required fields, provider wrappers, unknown keys, and unknown IDs are rejected.

### 5.2 Plan Rules

- Node and choice IDs match a short ASCII identifier grammar and are unique.
- Node array order is display order, not implicit control flow.
- Every transition is explicit. An empty `nextNodeId` means terminal.
- A node with choices has an empty `nextNodeId`.
- A dialogue node has exactly one speaker segment.
- Non-dialogue nodes have an empty `speakerSegmentId`.
- Visible content comes only from `contentSegmentIds` or `textSegmentIds`.
- Commands come only from server-provided command IDs.
- Choice text must use source choice segments and cannot use branch dialogue as a substitute.
- The plan cannot introduce labels, dialogue, narration, characters, events, choices, or commands unsupported by source segments.

### 5.3 Explicit Structured Input

The deterministic parser attempts to build the same relationship plan for scripts with explicit labels, options, commands, branches, jumps, and merges.

This path avoids a Converter call when the graph is unambiguous, but it does not bypass hydration, deterministic validation, table compilation, or MiniMax audit.

If the deterministic candidate fails validation or audit, the original source segments, candidate, and structured issues are sent to the Converter for the single repair attempt.

---

## 6. Hydration and Deterministic Validation

### 6.1 Hydration

The server resolves plan IDs to exact source segments and constructs the internal StoryDocument.

Hydration performs:

- exact content assembly from source segments;
- server-owned source-reference construction;
- speaker extraction and role mapping;
- numeric command attachment;
- stable table labels;
- explicit terminal-node generation when independent branches need a shared stop;
- explicit transition generation so physical table order cannot reveal sibling branches.

Hydration never calls an LLM.

### 6.2 Coverage Validation

- Every required display segment is used exactly once.
- Structural segments may be consumed as graph evidence without becoming visible content.
- A segment cannot be used by incompatible fields.
- Speaker, dialogue, choice, and command segments must be used according to their kinds.
- Duplicate visible output is rejected deterministically.
- Omitted required content is rejected deterministically.

### 6.3 Graph Validation

- The entry node exists exactly once.
- All node and choice IDs are unique.
- Every `nextNodeId`, `fromNodeId`, and `targetNodeId` resolves.
- Every node is reachable from the entry.
- Choice targets remain on separate paths until an explicit or generated merge.
- A branch cannot fall through into a sibling branch.
- Independent branch endings terminate safely.
- Automatic transitions cannot form a cycle with no visible progress or choice.
- Explicit source merges resolve to exactly one node.
- Unresolved jump aliases are errors, not guessed labels.

### 6.4 Table Projection Validation

The StoryDocument is compiled entirely in memory before audit. The server produces a compact projection containing:

- row label, type, speaker, and content;
- node commands and jump target;
- option text, target, and commands;
- reachable path summaries;
- variable-command summaries.

This projection is included in the mandatory semantic audit. The Auditor does not need database field IDs or raw persistence objects.

---

## 7. Mandatory MiniMax Audit

### 7.1 Inputs

The Auditor receives:

- authoritative source units and segments;
- server-parsed commands;
- the hydrated StoryDocument semantic projection;
- the compiled table projection;
- deterministic warnings, if any.

The Auditor does not receive Converter reasoning, prior Auditor reasoning, hidden chain-of-thought, or database credentials.

### 7.2 Audit Scope

Every audit checks:

- background, narration, stage directions, and dialogue preservation;
- speaker attribution;
- option text and option placement;
- option-to-branch relationships;
- nested choices, merges, and independent endings;
- prevention of unselected-branch playback;
- node and option command placement;
- command variable, operator, and value fidelity;
- variable interpolation source text;
- duplicate, omitted, added, or meaning-changed content;
- equivalence between StoryDocument semantics and compiled table semantics.

### 7.3 Flat Audit Contract

```typescript
interface StoryAuditResult {
  verdict: 'pass' | 'fail';
  issues: StoryAuditIssue[];
}

interface StoryAuditIssue {
  code:
    | 'omission'
    | 'duplicate_content'
    | 'added_content'
    | 'meaning_change'
    | 'wrong_speaker'
    | 'wrong_branch'
    | 'invalid_merge'
    | 'branch_leak'
    | 'command_mutation'
    | 'wrong_command_owner'
    | 'table_mismatch';
  severity: 'minor' | 'major' | 'critical';
  unitIds: string[];
  nodeIds: string[];
  message: string;
}
```

The audit schema contains no offsets, nested source references, repair objects, or recursive definitions.

Only a `pass` verdict with no major or critical issues permits a write. Minor presentation issues may pass only when they concern whitespace or matched structural wrappers and do not change visible wording.

---

## 8. Retry, Deadlines, and Failure Handling

### 8.1 Attempts

There are at most two candidate attempts.

Natural or mixed input:

1. Converter attempt 1.
2. Deterministic validation and mandatory audit.
3. If rejected, Converter attempt 2 receives structured deterministic and audit issues.
4. Deterministic validation and mandatory audit run again.
5. A second rejection terminates the import.

Explicit structured input:

1. Deterministic parser candidate.
2. Deterministic validation and mandatory audit.
3. If rejected, Converter receives the original source, candidate, and structured issues for one repair attempt.
4. Deterministic validation and mandatory audit run again.
5. A second rejection terminates the import.

### 8.2 Deadlines

- Each Converter or Auditor request has a 60-second hard deadline.
- At most four LLM calls occur in the natural-input worst case.
- The request remains within the 300-second API Route budget with time reserved for parsing, compilation, and writes.
- Deadline expiration aborts the upstream request immediately.
- Cancellation aborts the active model request and prevents later writes.

### 8.3 User Errors

User-visible failures are concise and source-oriented. They include phase, attempt, issue code, and source line or unit IDs where available.

Raw Zod errors, raw model responses, prompts, full source text, and Auditor evidence are not returned directly to the UI.

No failure path imports a partial graph or falls back to a linear table.

---

## 9. Long Source Policy

The current character-count chunking and array-concatenation merge are removed from the new path.

The first implementation milestone processes one complete relationship graph within a configured model-safe source limit. Sources above that limit fail before model conversion with a clear request to split the story. They do not use unsafe line-based chunking.

Long-story support is a later design phase with this required shape:

1. Build a global structural skeleton containing headings, choices, explicit labels, jumps, and branch boundaries.
2. Partition by complete branch or scene blocks, never arbitrary character count.
3. Provide the skeleton and adjacent read-only context to each block conversion.
4. Hydrate and validate every block.
5. Merge by stable skeleton IDs.
6. Run full deterministic validation and one mandatory global MiniMax audit.

Long-story chunking is not implemented until the single-graph path passes the real provider acceptance gate.

---

## 10. Testing Strategy

### 10.1 Unit Tests

- segment dialogue, speaker cues, narration, headings, options, commands, and jump hints;
- preserve exact source spans and display text;
- parse all supported numeric operators;
- parse explicit nested labels and merge aliases;
- accept valid flat plans and reject wrappers, missing fields, unknown fields, and unknown IDs;
- hydrate exact content and canonical source references;
- reject omitted and duplicated required segments;
- reject wrong segment kinds and command ownership;
- validate reachability, sibling isolation, merges, terminals, and automatic cycles;
- compile dynamic options and option commands without changing existing table behavior;
- parse flat Auditor results and reject malformed audit output.

### 10.2 Integration Tests

- explicit source -> deterministic plan -> hydration -> validation -> audit -> table;
- natural source -> Converter plan -> hydration -> validation -> audit -> table;
- failed audit -> one repair attempt -> second audit;
- second failure -> no database mutation;
- timeout and cancellation -> no database mutation;
- existing table compiler and player regressions remain green;
- table projection matches StoryDocument semantics.

Mock tests must not be reported as proof of provider conversion reliability.

### 10.3 Real MiniMax Contract Tests

Real provider tests are separate from deterministic CI tests and run when MiniMax credentials are available.

The primary fixtures are:

1. The nested trust-variable story with explicit labels, three choice groups, nested branches, merge aliases, and six numeric commands.
2. The natural-language rainy manor story with background, cast, dialogue, stage directions, two branches, and independent endings.

Before release:

- the nested fixture must import and play all four paths correctly;
- final trust values must be `2`, `0`, `4`, and `0`;
- no path may reveal an unselected branch;
- the rainy manor fixture must import successfully five consecutive times;
- the east-room path must reach only the safe ending;
- the west-attic path must reach only the bond ending;
- every successful run must include an Auditor pass;
- no successful run may rely on manual correction or a provider-specific JSON repair added after the fixture result is known.

---

## 11. Rollout

### Phase 1: Deterministic Source Model

- add source segmentation and command extraction;
- broaden explicit structured parsing;
- add the flat plan and audit schemas;
- add deterministic hydration and validation tests.

### Phase 2: MiniMax Conversion and Audit

- implement the flat Converter prompt and tool;
- implement the mandatory flat Auditor prompt and tool;
- implement retry feedback, deadlines, and cancellation;
- add real provider probes without database writes.

### Phase 3: Import and Playback Integration

- compile the hydrated StoryDocument through the existing dynamic table compiler;
- add table projection audit input;
- preserve existing player compatibility;
- verify database rollback and no-write failure semantics.

### Phase 4: Acceptance and Cleanup

- pass deterministic suites and real MiniMax acceptance runs;
- remove the old MiniMax-facing full Story IR contract;
- remove obsolete provider-shape canonicalizers that are no longer used;
- update Import Script documentation and progress messages;
- mark the prior Story IR Converter design as superseded.

Long-story semantic chunking requires a separate approved design after Phase 4.

---

## 12. Acceptance Criteria

1. MiniMax-M3 is the only LLM provider used by Import Script.
2. Every candidate, including deterministic structured parses, receives a MiniMax Auditor pass before database writes.
3. MiniMax never outputs full source references, offsets, structural repair objects, visible story text, or numeric command values.
4. Converter and Auditor use flat, non-recursive contracts with required fields.
5. Visible content and commands are hydrated only from server-owned source segments.
6. Required source content cannot be omitted, duplicated, paraphrased, or assigned to an incompatible field.
7. All graph targets resolve, all nodes are reachable, branches do not leak, merges are unambiguous, and automatic no-progress cycles are rejected.
8. A failed validation or audit receives at most one repair attempt.
9. A second failure, timeout, cancellation, or compilation error creates no library or partial rows.
10. The nested trust fixture produces `2`, `0`, `4`, and `0` on its four paths without revealing sibling branches.
11. The rainy manor fixture passes five consecutive real MiniMax imports and preserves its two independent endings.
12. Every real acceptance success includes a mandatory Auditor pass.
13. Existing libraries, dynamic option columns, option commands, variable interpolation, restart behavior, and playback remain compatible.
14. Oversized stories fail explicitly until semantic long-story chunking has its own approved design.
