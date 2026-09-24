# User-Visible Storage Accounting Design

**Date:** 2026-09-24
**Status:** Approved design

## Goal

Account Storage and storage quota checks count only content that the user can
currently see and use in the project. Physical objects left behind without a
current Assets, Table, Document, map, or character record are operational
orphans and do not consume the user's displayed or enforced quota.

For `battle-poc`, the empty Assets workspace therefore reports `0 B`; its 29
unreferenced historical objects remain available to operators for later cleanup
but do not contribute to user storage.

## Scope

Implement the rule in one shared database eligibility query and use it for:

- project Table, Document, and Assets physical-byte aggregation;
- account and project displayed totals;
- remaining and overage calculations;
- upload reservation and finalization quota checks.

Keep the existing physical registry and reconciliation inventory unchanged.
Do not add a second ledger, change the frontend layout, automatically delete
objects, or redesign upload workflows.

## Eligibility Rules

A registered active physical object counts when it has a current user-visible
owner:

- **Table:** a current persisted Table cell references the object's path.
- **Document:** a current Document owns the object.
- **Assets:** a current native asset, map, or character record owns the object.

An object that is attributed to a project only by its historical path, or that
falls back to Assets because no current owner exists, does not count. In
particular, `library_media` objects that are no longer referenced by a Table do
not become chargeable Assets automatically.

Logical Table and Document content accounting is unchanged. Active upload
reservations continue to reserve bytes until completion or release.

## Implementation

Add a forward-only migration after the deployed storage migrations. It defines
the shared current-visible-file predicate, updates the versioned Account
Storage read functions to aggregate only eligible files, and updates quota
checks to use the same eligible physical total plus active reservations.

The existing `project_storage_files` rows and Storage objects remain intact.
They continue to support reconciliation and a future explicit cleanup task,
but raw physical inventory is not exposed as user usage.

## Consistency And Failure Behavior

- The same object is counted at most once through its canonical registry row.
- A file stops counting when its last current business owner disappears.
- A file starts counting when a current owner is created or restored.
- Missing or malformed historical ownership is treated as unreferenced and is
  excluded from user usage; it remains visible to operational reconciliation.
- Authentication and project ownership rules remain unchanged.

## Verification

Database behavior tests must prove:

- an empty Assets workspace with historical fallback files reports `0 B`;
- those files do not affect account used, remaining, overage, or quota checks;
- current native Assets, Table media, Document media, map assets, and character
  assets still count exactly once;
- removing the current owner makes the bytes stop counting without deleting the
  physical object;
- restoring a current owner makes the bytes count again;
- active reservations still prevent concurrent uploads from exceeding quota.

After local tests pass, perform read-only production checks through the
available MCP or management API for `battle-poc` and representative projects
containing Table, Document, native Assets, map, and character content. No
production write or cleanup is part of verification.
