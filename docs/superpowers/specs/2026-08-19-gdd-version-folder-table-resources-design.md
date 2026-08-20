# GDD Version Folders and Independent Table Resources

## Goal

Every newly generated GDD is isolated in a project-owned version folder. Any
tables proposed by the generation are created as independent Keco table
resources in that folder, and the GDD document contains references to those
tables rather than embedding table definitions as document content.

## Scope

This applies to the project GDD generation workflow and its durable worker. It
does not change Game Design System generation or existing manually-created
documents/tables. Existing generation jobs remain readable and retryable.

## Architecture

The generation job is the idempotency boundary. The completion RPC acquires a
project advisory lock, creates or reuses a deterministic folder for the job,
creates or reuses independent tables keyed by the job, rewrites the generated
Markdown with table references, and creates or updates the GDD document in the
same transaction. The job stores the folder ID and table IDs as output metadata
so polling and retries can expose the complete result.

The model contract changes only at the persistence boundary: generated table
plans are normalized into `{ table, purpose, fields }`; a GDD renderer emits a
`Keco Tables` section containing resource links/IDs. No table rows are inferred
or created from prose. For v2 direct Markdown generation, the worker extracts a
strict optional table-plan block; if absent, the GDD is saved without tables.

## Data Flow

1. A job is created with the project and pinned design-system version.
2. The worker generates/validates the GDD and table plan.
3. Completion RPC checks the job lease and project write access.
4. The RPC creates a unique folder named from the project name, generation date,
   and job sequence; retries find it by `gdd_generation_job_id`.
5. Each table plan creates one table with fields in order. A table marker binds
   the row to the job, so retries reuse it instead of duplicating it.
6. The GDD document is stored in the same folder and includes table IDs/names.
7. The job is marked completed with document ID, folder ID, table IDs, and names.

## Naming and References

- Folder: `<project name> GDD <YYYY-MM-DD> v<sequence>`; collisions append a
  numeric suffix.
- GDD: `<project name> gdd`; collisions use the existing numeric suffix rule.
- Tables: generated table name from the plan, with a job suffix only when the
  folder already contains that name.
- Markdown reference: `- [<table name>](/<project-id>/<table-id>) - <purpose>`.
  The table ID is authoritative; names are display text only.

## Failure and Compatibility

The completion transaction rolls back all newly-created resources if table or
document persistence fails. A retry can safely re-enter the transaction because
all generated resources are looked up by job ID. Existing completed documents
remain where they are; any job completed after this migration receives the
version-folder behavior, including a job with no generated table plan.

## Testing

- Unit tests normalize and render independent table plans and stable references.
- Migration tests assert the completion RPC creates/reuses a folder, creates
  tables before the document, stores output IDs, and scopes all resources to the
  project.
- Worker/service tests assert table IDs flow into metadata and retry completion
  is idempotent.
