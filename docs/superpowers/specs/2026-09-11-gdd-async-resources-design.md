# GDD-first asynchronous resources

**Date:** 2026-09-11

**Status:** Approved for implementation

## Goal

Generate and persist the complete GDD from the user's full brief without waiting for derived tables, dialogue, or map work. Derived resources must continue independently after the document is readable.

## Scope

The existing `gdd_generation_jobs` row remains the parent job. A new `resource_mode` selects `async` or legacy `inline` behavior. In async mode, the parent critical path ends after document validation and persistence. Resource plans are durably queued only after a document ID exists.

## Data flow

```text
GDD request
  -> parent generation job
  -> complete GDD markdown
  -> validate and persist document
  -> parent completed + output_document_id
  -> resource jobs: tables / dialogue / maps
  -> independent workers and statuses
```

The parent job never transitions from `completed` back to `failed` because a resource job failed. Resource errors are stored on the resource job and exposed in the parent read model.

## Resource jobs

Each resource job has a stable parent job/document/project identity, a `kind`, a JSON payload, `pending|running|completed|failed` status, bounded attempts, lease fields, and an error string. The unique key `(gdd_generation_job_id, kind)` makes enqueueing idempotent.

Table and dialogue jobs contain the validated plans already produced by the GDD review step. Map jobs contain the compiled map briefs and style contracts. No resource worker regenerates the parent GDD.

## Compatibility

Contract v2 requests default to `resourceMode: async`; `resourceMode: inline` retains current behavior for migration and controlled rollback. Contract v1 remains unchanged. Existing jobs and map artifacts remain readable.

## Completion semantics

`completed` means the GDD document was persisted and can be read by `read_document`. Resource summaries are advisory and independently terminal. A map resource may be waiting for user payment confirmation; this does not block the GDD.

## Error handling

Parent generation errors retain current retry and lease semantics. Resource workers use separate retries and bounded error messages. A resource failure is never converted into a parent `GDD_GENERATION_FAILED` result. Polling a parent also schedules expired parent or resource work without resubmitting the request.

## Acceptance criteria

1. A full brief can produce a readable GDD while resource jobs are pending.
2. Map compiler, table materialization, or dialogue planning failures do not remove or fail the GDD document.
3. Resource jobs can be retried independently.
4. Service restarts do not lose queued resource work.
5. Existing inline jobs, map artifact records, and public job DTOs remain compatible.
