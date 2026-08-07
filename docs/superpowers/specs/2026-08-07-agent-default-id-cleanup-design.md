# Agent Default ID Cleanup Design

## Problem

When a user creates a table manually, Keco initializes it with an optional string field named `ID` and three blank rows. During an Agent-driven data import, `create_asset` requires an internal row name and `prepareAgentPropertyValues` copies that name into the first string field when no explicit primary label value is supplied. The default `ID` field is therefore treated as a primary label and receives invented values.

For imports into manually created tables, the Agent should remove an unused default `ID` field before writing business data. A deliberate or populated ID field must be preserved.

## Scope

The change applies only to Agent row writes into an existing table. It does not change manual table initialization, UI-driven cell editing, table creation through `setup_library`, or populated ID fields.

## Approach

Add a shared Agent-side cleanup function and cover all three row-write entry points so the Agent cannot bypass cleanup by choosing a different write tool during an import. `create_asset` and `update_asset` use pre-execute confirmation, so they clean before resolving the target table schema. `update_row` uses a read-only post-preview contract, so it rechecks and cleans in `executeImport()` after confirmation and immediately before persisting the row. The function reuses the existing permission-checked `deleteLibraryField` service.

An `ID` field is disposable only when all of these conditions are true:

1. Its label is exactly `ID`.
2. Its data type is `string`.
3. It is the first field (`orderIndex === 0`).
4. It is not required.
5. The table has at least one other field.
6. Every existing row has an empty value for that field.
7. The incoming `propertyValues` does not explicitly contain `ID` or the field UUID.

If any condition is false, cleanup is a no-op.

## Data Flow

For `create_asset` and `update_asset`:

1. Resolve the target library.
2. Load its current fields and rows.
3. Evaluate the disposable-default predicate against the incoming semantic values.
4. Delete the field when the predicate succeeds.
5. Reload the fields after deletion.
6. Resolve and validate the incoming property values against the refreshed schema.
7. Perform the existing row write.

For `update_row`, `execute()` remains non-mutating and builds its preview through the existing read path. After confirmation, `executeImport()` reloads the current fields and rows, reevaluates the disposable-default predicate, deletes the field if it is still unused, and only then persists the previewed business-field values.

Cleanup must finish before field-name resolution in the pre-execute tools and before the persisted write in `update_row`. This prevents a deleted field UUID from entering a write payload while preserving the preview tool's read-only contract.

The existing row-name merge remains available for real primary label fields, but `findPrimaryLabelField` must not select a disposable default `ID` field. This provides a second guard against invented ID values if cleanup cannot run or deletion fails.

## Failure Handling

Deletion is part of the requested import operation. If deletion is required but fails, the write stops and returns the deletion error; the Agent must not continue and write data against the stale schema.

No rollback is needed after a successful deletion because the field is proven empty before deletion. Existing rows and other fields are not modified by cleanup.

## Tests

Unit tests will cover the predicate and write integration:

- Delete an empty default-shaped `ID` field when business fields exist and the import omits `ID`.
- Preserve `ID` when any row contains a non-empty ID value.
- Preserve `ID` when the incoming payload explicitly includes `ID` or its field UUID.
- Preserve an `ID` field that is required, not a string, or not first.
- Preserve the only field in a table.
- Preserve renamed fields.
- Stop the row write when deletion fails.
- Resolve and write business fields against the refreshed schema after deletion.
- Never merge an internal Agent row name into a disposable default `ID` field.

Focused Agent unit tests will run first, followed by the broader Agent unit-test suite and TypeScript checking if available in the repository scripts.
