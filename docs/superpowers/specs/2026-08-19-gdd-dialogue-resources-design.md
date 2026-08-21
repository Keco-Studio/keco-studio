# GDD Dialogue Resources Design

**Date:** 2026-08-19  
**Status:** Approved design  
**Scope:** Generate chapter-level dialogue Documents and derived Script trees from GDD output.

## Goal

When a generated GDD contains dialogue scenes, create one complete dialogue
Document per chapter or task, derive an editable Script/Flow chart for each
Document, and keep both resources referenced from the GDD. A failed Script must
not invalidate the GDD or its source Document and must be recoverable by
automatic or manual retry.

## User Decisions

- Split dialogue by chapter or task.
- Reference both the source dialogue Document and the derived Script tree.
- Generate complete dialogue content, including narration, player choices, and
  branch outcomes.
- Let the GDD model decide which chapters contain meaningful character
  interaction, choices, or dialogue.
- Preserve the GDD and Documents when an individual Script fails.
- Retry failed Scripts automatically in the background and expose manual retry.

## Architecture

The feature uses a two-stage pipeline:

1. The GDD generation worker validates an optional structured dialogue plan.
2. The GDD completion transaction creates the GDD, chapter Documents, and
   durable dialogue-generation jobs in the generated version folder.
3. A dialogue worker claims each queued job, reads the chapter Document, and
   reuses the existing Story IR, `plot_plan`, and Script table import path.
4. The worker records the Script ID and completion state. The GDD reference
   reflects `queued`, `running`, `completed`, or `failed` throughout the flow.

The generation job remains the idempotency boundary for the GDD and its source
Documents. Each chapter's `chapterKey` is unique within that GDD job and is the
idempotency key for its dialogue job. Script import is an independent
transaction so a conversion or database failure affects only that chapter.

## Model Contract

The model may append exactly one `KECO_DIALOGUE_PLAN` marker to the generated
GDD output. The marker is a JSON array with bounded, strict objects:

```json
[
  {
    "chapterKey": "chapter-01",
    "title": "Arrival at the Harbor",
    "content": "# Arrival at the Harbor\n\nCaptain: ...",
    "hasChoices": true,
    "branchSummary": ["Help the captain", "Investigate the warehouse"]
  }
]
```

Contract rules:

- `chapterKey` is required, trimmed, and unique within the plan.
- `title` is required and bounded for use as a Document and Script name.
- `content` is complete importable dialogue Markdown/text, bounded in size, and
  must contain meaningful content.
- `hasChoices` is boolean; `branchSummary` is a bounded string array.
- Unknown keys, duplicate keys, and oversized content reject only the affected
  chapter plan and create a failed dialogue job; they do not prevent the rest
  of the valid GDD from being saved. If the entire marker is malformed JSON,
  no chapter can be identified safely, so the GDD is saved without dialogue
  jobs and records a bounded invalid-plan warning in generation metadata.
- A GDD without the marker remains fully compatible and creates no dialogue
  jobs.

The model is instructed to write content in the existing Script importer's
accepted format. It does not write Script field rows or internal `plot_plan`
IDs. Story IR conversion remains the canonical compiler for the tree view.

## Persistence Model

Add a `dialogue_generation_jobs` table with:

- `id uuid primary key`;
- `gdd_generation_job_id uuid` and `project_id uuid` ownership links;
- `chapter_key`, `title`, and a snapshot of the source content;
- `status` in `queued | running | completed | failed`;
- `attempt_count`, `next_attempt_at`, `last_error`;
- `document_id` for the source chapter Document;
- nullable `script_library_id` for the derived Script;
- lease owner/expiry and timestamps.

The completion RPC creates chapter Documents and jobs in the same transaction
as the GDD. All new resources use the generated GDD version folder. A retry
looks up the folder, Document, and job by the GDD job ID and chapter key rather
than inserting duplicates.

The initial GDD reference uses stable Document and dialogue-job identifiers.
While the Script is not ready it displays `Generating` or `Failed - Retry` and
does not link to a nonexistent Script. On successful completion the job stores
the Script ID and the reference becomes a direct Script Flow chart link.

## Worker and State Transitions

The dialogue worker supports the following transitions:

```text
queued -> running -> completed
queued -> running -> failed
failed -> queued       (automatic backoff or manual retry)
```

Claiming is lease-based and project-scoped. Heartbeats extend the lease during
Story IR conversion and database writes. Completion is idempotent for the same
job/chapter key. A worker must not overwrite a newer successful Script or a
Document revision that the user edited after the original GDD generation.

When retrying, the worker reads the current Document content. It never rewrites
the Document from the frozen GDD snapshot, so user edits are preserved.

## GDD References and UI

The GDD renderer emits a `Dialogue Resources` section containing one entry per
valid chapter. Each entry includes the chapter title, source Document link,
Script status, and Script link when available. Reference labels are display
text; UUIDs are authoritative.

The first version reuses existing surfaces:

- GDD document view shows resource links and live status;
- a failed entry exposes `Retry conversation`;
- a completed entry opens the existing Script Flow chart;
- the Script sidebar continues to show the Document -> Script hierarchy.

No separate dialogue editor or new tree editor is introduced.

## API and Service Boundaries

Add service operations for:

- list dialogue jobs for a GDD generation job;
- claim, heartbeat, complete, fail, and retry one dialogue job;
- update the GDD reference metadata after Script completion.

The reference update must use the existing document persistence/codec path so
the Markdown and collaborative Yjs snapshot remain consistent. The existing
Document export and `/api/import-script` Story IR path remain the
source of truth for derived Script creation. Script import receives only the
additional provenance needed to associate the generated library with its
dialogue job; ordinary manual Document -> Script imports are unchanged.

## Error Handling

- Invalid dialogue plan entry: create a bounded failed job and continue with
  other chapters.
- GDD/Document/job persistence failure: roll back the whole GDD completion
  transaction.
- Story conversion, permission, or Script persistence failure: keep GDD and
  Document, record a bounded error, and schedule a retry.
- Exhausted automatic retries: keep the job failed and expose manual retry.
- Missing or deleted source Document: fail closed with an actionable error;
  never create a Script from an unrelated Document.
- Cross-project IDs, stale leases, and duplicate chapter keys are rejected by
  database constraints and service validation.

## Testing

### Contract unit tests

- Parse a valid multi-chapter marker.
- Reject malformed JSON, duplicate `chapterKey`, unknown keys, empty content,
  and size limits.
- Strip the marker from the narrative and render stable dialogue references.
- Preserve behavior for GDD output without a dialogue marker.

### Service and worker tests

- Create Documents and jobs in one completion request.
- Re-run completion and verify folder, Document, and job reuse.
- Claim/heartbeat/complete transitions persist the expected IDs.
- Conversion failure preserves the Document and schedules backoff.
- Manual retry requeues only the selected chapter.
- A user-edited Document is the input used by a later retry.

### Database tests

- Project and GDD-job isolation for all rows.
- RLS and worker lease enforcement.
- Unique chapter key and idempotent retry constraints.
- Transaction rollback when a Document or job insert fails.

### End-to-end tests

- Generate a GDD with two dialogue chapters and verify both Documents share its
  version folder.
- Verify a successful Script appears under the source Document and opens the
  existing Flow chart.
- Simulate one failed Script and one successful Script; verify the GDD remains
  readable, the failed entry offers retry, and retry can complete it.

## Out of Scope

- A standalone dialogue authoring/editor product.
- Direct model generation of Script table rows or internal graph IDs.
- Changes to ordinary manually triggered Document -> Script imports.
- Automatic regeneration of the whole GDD when a chapter Document changes.
- Manual graph layout editing beyond the existing Script workspace.
