# Project Logical Storage Accounting Design

**Date:** 2026-09-18
**Status:** Approved

## Goal

Make Account storage usage represent every user-visible file that can exist in a
project. The total includes physical Supabase Storage objects and logical files
stored in Postgres, beginning with documents and library tables.

This release is accounting and presentation only. It must not add quota checks
to document or table writes, and logical bytes must not change the existing
physical-upload quota decision.

## Product Rules

- A document is one logical file whose content size is the UTF-8 byte length of
  its Markdown body.
- A library is one logical table file whose content size is the UTF-8 byte
  length of a deterministic JSON representation of its editable content.
- A library's representation includes its name, description, field definitions,
  asset row names, row order, and cell `value_json` values.
- Database identifiers, timestamps, ownership metadata, derived job state,
  version history, collaborative editing updates, embeddings, and audit data do
  not count toward a logical file's size.
- Uploaded attachments and generated media remain independent physical files.
  Their bytes must not be duplicated inside document or table logical sizes.
- Owned project logical files count toward the signed-in owner's displayed
  usage. Shared project logical files are visible but count only toward the
  project owner's displayed usage.
- Account and project totals must equal the sum of the file rows visible through
  their corresponding accounting ledgers, apart from charged physical files in
  an explicit pending-cleanup state.
- Remaining storage is never negative in the API. When usage exceeds the
  allowance, `remainingBytes` is zero and `overageBytes` reports the excess.

## Scope

### Included

- Physical objects already registered by `project_storage_files`.
- Document Markdown bodies.
- Library tables composed from `libraries`, `library_field_definitions`,
  `library_assets`, and `library_asset_values`.
- Account summary, project summary, and project file-list presentation.
- Backfill/rebuild and reconciliation support for logical files.
- Regression fixes for over-quota summaries and source availability.

### Excluded

- Blocking document or table writes because of quota.
- Charging logical bytes to the existing physical upload reservation predicate.
- Version snapshots, Yjs updates, generated-job records, simulations, chat or
  agent history, audit events, and other internal implementation records.
- Combining uploaded attachments into a parent document or table row.

## Architecture

### Separate Physical And Logical Counters

`account_storage_quotas.used_bytes` remains the authoritative physical byte
counter used by upload reservations. Add `logical_used_bytes bigint not null
default 0` for logical content. Account display usage is:

```text
displayed used bytes = physical used_bytes + logical_used_bytes
```

The upload reservation and finalization functions continue to compare the
allowance only with physical `used_bytes` and `reserved_bytes`. This preserves
current behavior until unified quota enforcement is explicitly implemented.

### Logical File Registry

Create `project_storage_logical_files` with one row per logical file:

- `source_kind`: `document_content` or `library_table`;
- `source_entity_id`: document or library UUID;
- `project_id` and copied billing `owner_id`;
- display name and MIME type;
- deterministic `size_bytes`;
- created and updated timestamps;
- unique `(source_kind, source_entity_id)` identity.

The registry is private with RLS enabled and no direct authenticated table
access. Account readers use security-definer summary/file-list RPCs.

### Deterministic Sizing

Document size is `octet_length(coalesce(documents.content, ''))`. Empty
documents remain visible as zero-byte logical files.

Library size is the UTF-8 byte length of a canonical JSONB value. Arrays are
ordered by stable semantic order and UUID tie-breakers. JSON object keys are
fixed by the database function. The representation contains:

```json
{
  "name": "Characters",
  "description": "Playable cast",
  "fields": [],
  "rows": [
    { "name": "Hero", "rowIndex": 0, "values": [] }
  ]
}
```

Field entries include section, label, data type, enum options, required flag,
order, description, formula, and reference-library configuration when present.
Cell entries contain their field identity and `value_json`. Physical media
metadata inside a cell may contribute its small JSON reference, while the
referenced object's binary bytes remain counted only in the physical registry.

### Synchronization

Database trigger functions own synchronization so browser, MCP, import, worker,
and service-role writes cannot bypass accounting.

- Document changes upsert or delete the matching logical registry row.
- Changes to a library, field definition, asset row, or cell value recompute the
  affected library row.
- Registry insert/update/delete triggers adjust `logical_used_bytes` under the
  same advisory-lock discipline used by physical accounting.
- These triggers never reject a write because of quota in this release.
- A service rebuild function reconstructs both physical and logical cached
  counters from their registries.

The migration backfills all existing documents and libraries before rebuilding
account counters. It replaces the document-only accounting trigger without
double-counting bytes already introduced by the prior document migration.

## Read APIs And UI

`account_storage_summary()` returns:

- `physicalUsedBytes`;
- `logicalUsedBytes`;
- `usedBytes` as their sum;
- `remainingBytes = max(quota - used - reserved, 0)`;
- `overageBytes = max(used + reserved - quota, 0)`;
- owned/shared project totals including both ledgers.

`account_storage_project_files()` returns physical and logical rows through one
sortable, searchable, paginated result. Logical rows use source kinds
`document_content` and `library_table`. Document rows open the document editor;
table rows open the library table. Physical source availability continues to be
derived rather than hard-coded.

The Account section shows total, physical, and logical usage without claiming
that logical content currently participates in upload enforcement. An exceeded
allowance remains displayable and shows the overage instead of failing the API.

## Reconciliation

The reconciliation command reads both registries and computes physical and
logical expected totals separately. Its report distinguishes:

- physical inventory parity failures;
- physical cached-counter drift;
- logical cached-counter drift.

Safe repair calls the database rebuild function only after physical inventory
parity is clean. Re-running report mode after a repair must return zero counter
mismatches.

## Migration Safety

- Add a new forward-only migration; do not rewrite migrations that may already
  exist in local or remote history.
- Use `create or replace` for RPC evolution and explicit revoke/grant statements.
- Backfill and counter rebuild run inside the migration transaction.
- Existing physical usage and quota values must be preserved.
- The migration must work whether accounts currently have document content,
  empty documents, empty libraries, or usage above the displayed allowance.
- Local reset and real-Postgres behavior tests validate trigger propagation,
  deletion, ownership, summary totals, pagination, and permissions.

## Verification

- Storage migration contract and real-Postgres behavior tests.
- Account service/API/UI tests for separate totals and overage responses.
- Reconciliation tests proving document and library bytes are included.
- TypeScript application and API type checks.
- Account storage browser test.
- Migration-history validation and a local Supabase reset when the environment
  permits destructive local verification.
- Repository Chinese-text gate and existing storage-write scanner.
- Unified review of the complete diff before push.
