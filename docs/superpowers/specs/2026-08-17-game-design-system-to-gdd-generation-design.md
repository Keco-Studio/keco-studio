# Game Design System to GDD Generation

**Date:** 2026-08-17  
**Status:** Proposed design

## Goal

Allow a user to generate a project GDD Document from a selected, pinned Game
Design System version without requiring the user to upload an existing GDD or
fill in a separate project brief.

The generated document is a reviewable draft. It must distinguish verified
project facts from AI-derived assumptions because a Game Design System describes
reusable design constraints, not the complete facts of one specific game.

## Product Boundary

The Game Design System remains the upstream design contract:

- structured rules constrain the Agent's design decisions;
- the human-readable system document supplies reusable design context;
- the selected concrete version is the only version used for generation.

The GDD is a downstream project artifact:

- it describes one concrete game;
- it is saved as a project Document;
- it can later drive Keco Tables, Script, Map, and other project workflows.

The existing design-upload flow remains a document-to-table workflow. It is not
reused as the GDD generation entry point and no existing GDD upload is required.

## User Flow

1. The user opens a Game Design System and selects a concrete version.
2. The user selects a target project that they can modify.
3. The user starts `Generate GDD Draft` without entering additional content.
4. The server resolves the selected version and the target project's readable
   context, then creates a durable generation job.
5. The worker generates and validates a structured GDD payload.
6. The server renders the payload to Markdown and creates a new project Document.
7. The result opens in the Document workspace for review and editing.

Selecting a target project is required because the output is a project Document;
no additional brief, file upload, or free-form prompt is required.

## Automatic Inputs

The generation request contains:

- `projectId`;
- `designSystemId`;
- `versionId`;
- the selected version's validated structured rules;
- the selected version's human-readable design document;
- the target project's name and bounded readable Documents/Tables, when present;
- a deterministic instruction that project facts outrank generated assumptions.

The request never uses the system's mutable `current_version_id` after the user
has selected a version. A project remains pinned to the version used by this
job even if a newer system version is later published.

Project context is resolved server-side from authorized resources. Client labels
are not treated as content. Context is bounded and source snapshots record the
resource ID, update time, content hash, excerpt, byte count, and truncation
state.

## Generation Contract

The model returns JSON only:

```ts
type GeneratedGdd = {
  title: string;
  overview: string;
  designIntent: string;
  playerFantasy: string;
  coreLoop: string;
  decisionStructure: string;
  gameplaySystems: string;
  contentModel: string;
  progressionEconomy: string;
  difficultyBalance: string;
  narrativeWorld: string;
  experiencePresentation: string;
  productionTables: Array<{
    table: string;
    purpose: string;
    fields: string[];
  }>;
  assumptions: string[];
  appliedRuleIds: string[];
};
```

The server validates bounded fields, verifies that `appliedRuleIds` belong to
the injected rule set, and rejects malformed or oversized output. The Markdown
renderer deterministically creates the GDD Document from the validated payload.
The model does not write arbitrary Markdown directly into the project.

## Assumptions and Truthfulness

When project context does not establish a fact, the generated GDD must state the
assumption explicitly in an `Assumptions to Confirm` section. It must not present
invented world lore, characters, numbers, platforms, or production commitments
as verified project facts.

The document should label information internally as:

- `Project evidence`: taken from authorized project Documents/Tables;
- `System guidance`: derived from the bound Game Design System;
- `AI proposal`: generated to complete the draft;
- `Assumption`: requires user confirmation.

## Document Persistence

Every successful run creates a new Document rather than overwriting an existing
Document. The Document metadata records:

- source: `game_design_system_generation`;
- design system ID and pinned version ID;
- generation job ID;
- source snapshot metadata;
- applied rule IDs and omitted rule IDs;
- created-by user and timestamps.

The default title is `Game Design Document - Draft` with a collision-safe suffix.
The user can rename and edit the result using the existing Document workflow.

## Validation and Failure Handling

The job is durable and independent of the request lifecycle. Its phases are:

```text
Resolve project context
  -> Generate GDD JSON
  -> Validate schema and rule evidence
  -> Render Markdown
  -> Create project Document
```

Retryable model or network failures use the existing leased-worker retry policy.
Authorization failures, missing projects, missing bindings, invalid versions, and
schema failures do not create a partial Document. A failed job preserves its
resolved input and error for retry or inspection.

## Permissions

- The caller must have project write permission to create the Document.
- The caller must be allowed to read the pinned Game Design System version.
- A viewer may read existing generated Documents but cannot start generation.
- The Agent receives only sanitized structured rules, never raw provenance or
  arbitrary source Markdown as policy instructions.

## Alternatives

### Chat-only generation

Let users type “generate a GDD” in Agent chat and rely on prompt routing.
This is the smallest change, but it provides weak progress, validation, and
traceability. It is useful as a later convenience entry point, not as the
canonical workflow.

### Dedicated durable GDD generation (recommended)

Add a project-scoped generation action backed by a durable job and a structured
output contract. This provides reliable persistence, retries, source evidence,
rule evidence, and a consistent Document result without adding user fields.

### Generate a GDD template only

Render the Game Design System's sections as an empty template. This avoids model
assumptions but does not fulfill the goal of producing a useful first draft.

## Success Criteria

- A user can generate a GDD draft with no uploaded GDD and no manually entered
  project brief.
- The generated Document is tied to the exact Game Design System version used.
- The result contains the core GDD sections and an explicit assumptions section.
- The Agent applies only the pinned, validated rules and records rule evidence.
- A failed generation never leaves a partial or misleading project Document.
- The generated Document can be edited and used as input to later Keco workflows.

## Open Product Decision

The generation action should be named `Generate GDD Draft` while the output may
contain AI proposals and assumptions. If product wants the stronger label
`Generate GDD`, the same assumption and evidence sections must remain mandatory.
