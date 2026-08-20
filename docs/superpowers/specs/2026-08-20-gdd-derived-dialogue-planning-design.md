# Streaming GDD-Derived Dialogue Planning

**Date:** 2026-08-20  
**Status:** Approved design

## Problem

The current GDD generator asks one model response to write the GDD and append a
`KECO_DIALOGUE_PLAN` marker when dialogue is relevant. A valid GDD can describe
concrete NPC scenes and player branches while omitting that marker. In that
case, table resources may still be created, but no dialogue Document or Script
job is created. Waiting until the whole GDD is complete before planning every
conversation also needlessly serializes work.

Natural language entered while creating a Game Design System and the optional
GDD creative brief are also the wrong place to decide whether dialogue
resources exist. They express intent. The concrete GDD content as it is written
is the authoritative basis for downstream dialogue resources.

## Goal

Derive dialogue resources from concrete scenes as they appear in the GDD stream.
Start a dialogue-generation task as soon as a complete scene event is received,
while the GDD continues streaming. Generate a dialogue Document only when the
GDD contains a concrete scene that calls for spoken lines or player choices. Do
not generate dialogue from abstract feature statements such as "supports NPC
interaction" or "contains branching dialogue."

## Decision

Use a structured scene event embedded in the GDD stream. The event is emitted
immediately after the prose that establishes one concrete scene. A dialogue
planner receives that event plus the already generated GDD context for the
scene, and returns one strict dialogue plan. Multiple scene planners run in
parallel, with a maximum of three active tasks.

The alternatives are rejected for the following reasons:

- strengthening the first-pass prompt still allows a useful GDD to omit its
  dialogue marker;
- scanning for terms such as `NPC`, `dialogue`, or `choice` would make keywords,
  rather than the concrete GDD content, the decision boundary.

## Eligibility Boundary

A GDD passage is eligible when it identifies a concrete playable event, such as
a chapter, task, meeting, confrontation, or choice scene, and provides enough
context to write its interaction. Useful context includes participants, scene
purpose, conflict, information exchanged, player decision, or consequences.

The planner must return no plan for:

- genre or feature declarations;
- statements that the game supports NPC interaction, dialogue, or branches;
- generic dialogue-system rules;
- examples that are explicitly illustrative rather than project content;
- table rows or table guidance without a concrete scene in the GDD narrative.

The presence or absence of a creative brief does not affect eligibility.

## Data Flow

```text
Game Design System + project sources + optional creative brief
  -> stream GDD Markdown
  -> emit a complete KECO_DIALOGUE_SCENE event after a concrete scene
  -> start its dialogue planner (max 3 active; later scenes are queued)
  -> continue streaming GDD and collect table plans
  -> finish queued/in-flight dialogue planners
  -> validate GDD, tables, and dialogue plans
  -> persist GDD, table resources, and eligible dialogue resources atomically
  -> add each dialogue Document to the project's Script workspace
  -> existing dialogue worker converts each dialogue Document into a Script
```

The GDD generation pass owns scene detection at the point where the scene is
written, but it does not write complete dialogue in the GDD stream. The table
plan and dialogue plan remain separate outputs: a GDD may produce neither,
either, or both. Dialogue planning is overlapped with the remaining GDD
generation instead of being a serial post-pass.

## Scene Event Protocol

The model must emit exactly one machine-readable HTML-comment event immediately
after each eligible scene. The comment syntax can be detected across arbitrary
stream chunks without changing visible Markdown:

```text
<!-- KECO_DIALOGUE_SCENE {"chapterKey":"arrival","title":"Arrival","scene":"...","participants":["Guide","Hero"],"choices":["Ask about the train","Leave"],"consequences":"..."} -->
```

`scene` is the concrete prose context needed to write the interaction. The
event is not a keyword flag and must not be emitted for abstract system
capabilities, generic examples, or table-only content. `chapterKey` is the
deduplication key; repeated events for the same key are ignored or treated as a
validation error, never started twice.

The event is removed from the final visible GDD Markdown. The stream parser
maintains a bounded carry buffer so markers split across chunks are recognized.
An incomplete event at end-of-stream is a validation error rather than a silent
dialogue omission.

## Dialogue Planner Contract

The planner returns JSON only:

```ts
type DialoguePlan = {
  chapterKey: string;
  title: string;
  content: string;
  hasChoices: boolean;
  branchSummary: string[];
};

type DialoguePlanningResult = DialoguePlan;
```

`chapterKey` is a stable scene slug. `content` is the complete importable
dialogue script for that concrete scene. `hasChoices` and `branchSummary` must
agree with the scene described by the GDD. A job with no scene events has no
planner calls and no dialogue plans.

The existing dialogue-plan schema, deterministic resource IDs, persistence RPC,
Dialogue Documents, dialogue jobs, and Script conversion worker remain in use.

## Isolation

The scene planner input contains the event and the GDD text already generated
for that scene. It does not receive a separate copy of:

- the Game Design System creation description;
- the GDD creative brief;
- user-supplied keyword flags;
- the original project source excerpts;
- table-plan JSON removed from the GDD body.

This makes the GDD content emitted up to the scene event the sole semantic basis
for dialogue eligibility. The planner prompt states the eligibility boundary
directly but does not prescribe specific characters, chapters, or dialogue
based on keywords.

## Concurrency, Cancellation, and Failure Handling

At most three dialogue planner tasks run at once. Additional scene events are
queued in encounter order. The GDD stream continues while tasks run. When the
GDD stream ends, the worker drains the queue and awaits all active tasks before
validation and persistence.

If the GDD generation is cancelled or fails, the worker aborts queued and active
dialogue planner calls using the request `AbortSignal`. No dialogue Document,
table, or GDD output is persisted from that job. A provider failure in one
scene is retryable under the existing GDD job policy; it must not be converted
to an empty dialogue result.

Each planner response is parsed as one strict JSON object and normalized through
the existing dialogue-plan schema. Duplicate chapter keys, missing content,
inconsistent field types, oversized values, or non-object roots are invalid.

On invalid output, that scene performs one bounded repair pass using the
invalid response, validation error, and the same scene event. If repair also
fails, the GDD job follows its existing failure or retry policy. It must not
silently save a completed GDD with that dialogue omitted when its planner
contract could not be evaluated.

No scene event is a successful empty result and persists the GDD without
dialogue resources. Table planning remains unaffected by dialogue tasks.

## Compatibility

One additive migration is required to add generated dialogue Documents to
`script_workspace_documents`, because the Script sidebar uses that membership
as the root of its Document/Script tree. The migration also backfills existing
dialogue jobs and is idempotent for retries. The completed-job persistence
contract already accepts dialogue resources, creates their Documents and jobs,
and links them from the generated GDD. Existing completed jobs are not
re-planned. Retried jobs use their frozen GDD generation input and the new
planner behavior.

## Testing

Unit tests must prove:

1. An abstract statement that NPC interaction and branch choices are supported
   emits no scene event and creates no dialogue task.
2. A concrete NPC meeting, interaction purpose, and choice consequences emit one
   scene event and start one dialogue task before the GDD stream ends.
3. A concrete dialogue scene starts a task when the creative brief is absent,
   and the planner request contains no creation description or keyword flag.
4. Four eligible scenes execute with at most three active planner tasks, and the
   fourth starts after one of the first three completes.
5. Markers split across stream chunks are parsed once and removed from visible
   Markdown; duplicate chapter keys do not start twice.
6. GDD cancellation aborts active planners and persists no resources.
7. Invalid planner JSON receives one repair attempt; a second invalid result is
   surfaced as a generation validation failure.
8. A GDD with no scene events completes normally and creates no dialogue
   resources.
9. A GDD can produce table plans and dialogue plans independently in the same
   generation job.
10. Existing worker persistence tests still create stable dialogue Documents,
    jobs, references, and Scripts for non-empty plans.
11. Generated and previously persisted dialogue Documents are members of the
    same project's Script workspace, so their derived Scripts appear in the
    Script tree.

Focused generator and worker tests, TypeScript checks, ESLint for changed files,
and `git diff --check` are required before completion.

## Success Criteria

- Dialogue resource creation is triggered exclusively by concrete scene events
  emitted from the GDD content being generated.
- Abstract dialogue mechanics alone never create dialogue Documents.
- Concrete dialogue scenes begin editable Dialogue Document generation before
  the complete GDD finishes, without requiring Creative brief input.
- Table generation does not substitute for or suppress dialogue generation.
- Planner failures are visible and retryable rather than silently dropping
  expected dialogue resources, while the whole job remains atomic.
