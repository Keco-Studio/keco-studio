# MCP Table Maintenance P0/P1 Design

## Goal

Extend the Keco MCP write surface from table/row creation and row updates into complete table maintenance: field editing, field deletion, row deletion, table metadata updates, field reorder, table deletion, bulk row updates, and match-field upserts.

## Current State

MCP currently exposes table writes for `create_table`, `add_table_field`, `create_table_row`, and `update_table_row`, plus document and image write tools. The Edge Function validates input with Zod and delegates authoritative writes to PostgreSQL `security definer` RPCs guarded by `mcp_require_writer`. Account-scoped MCP discovers write tools only when the account has at least one writable project, and every account-scoped write resolves live project write access before execution.

The missing surface prevents agents from correcting schema mistakes, deleting stale data, renaming or moving tables, reordering fields, and importing/updating data sets without row-by-row calls.

## Scope

### P0 Tools

1. `edit_table_field`
   - Edits one existing field in a table.
   - Input: `tableId`, `fieldId`, `field`, optional `clearValuesOnTypeChange`.
   - Supports label, data type, description, section, section ID, enum options, reference table IDs, and required flag.
   - Rejects type changes when the field has non-empty values unless `clearValuesOnTypeChange: true`.
   - Clears values for that field only when type changes and explicit clearing is provided.

2. `delete_table_field`
   - Deletes one field and its cell values.
   - Input: `tableId`, `fieldId`, optional `clearValues`.
   - Rejects deletion when the field has non-empty values unless `clearValues: true`.
   - Rejects deleting the last field in the table.

3. `delete_table_row`
   - Deletes one row selected by stable `rowId` or exact one-based `rowIndex`.
   - Input: `tableId`, exactly one of `rowId` or `rowIndex`, optional `expectedRowId`, optional `clearReferences`.
   - Rejects row-index drift when `expectedRowId` is provided and the resolved row differs.
   - Rejects deletion when any reference field points at the row unless `clearReferences: true`.
   - When `clearReferences: true`, removes only references pointing at the deleted row from referencing cells.

4. `update_table`
   - Updates one table's metadata.
   - Input: `tableId`, optional `name`, optional `description`, optional `folderId`.
   - Requires at least one metadata field.
   - Rejects duplicate table names within the target folder.
   - Rejects folders outside the selected project.

### P1 Tools

5. `reorder_table_fields`
   - Reorders and optionally moves fields between sections.
   - Input: `tableId`, `fields: [{ fieldId, section, sectionId }]`.
   - Requires the provided field list to contain every field in the table exactly once.
   - Assigns `order_index` from the provided order and updates section metadata atomically.

6. `delete_table`
   - Deletes a table.
   - Input: `tableId`, `confirmName`, optional `clearReferences`.
   - Requires `confirmName` to match the current table name after trimming.
   - Rejects deletion when any reference cell points to the table's rows unless `clearReferences: true`.
   - When `clearReferences: true`, removes only references pointing at rows in the deleted table from referencing cells before deleting the table.

7. `bulk_update_table_rows`
   - Updates multiple existing rows atomically.
   - Input: `tableId`, `rows`, where each row has exactly one of `rowId` or `rowIndex`, optional `expectedRowId`, and non-empty `values`.
   - Max 100 rows per call.
   - Reuses the same field-label resolution and value validation as `update_table_row`.
   - Any invalid row or value rolls back the whole batch.

8. `upsert_table_rows`
   - Updates existing rows or creates new rows using a stable match field.
   - Input: `tableId`, `matchField`, `rows`, optional `reuseEmpty`.
   - `matchField` can be a field label or field ID.
   - Match field must be one of `string`, `int`, `float`, `boolean`, `enum`, or `date`; it cannot be an array, reference, image, formula, file, multimedia, audio, or media field.
   - Each row must include a non-empty value for the match field.
   - Max 100 rows per call.
   - Duplicate match values in the request or in existing table data are rejected.

## Architecture

Edge Function code remains a thin MCP adapter. It owns tool names, Zod input schemas, annotations, account/project routing, success summaries, and reindex scheduling. It must not implement the authoritative data mutation rules.

PostgreSQL RPCs own all write semantics. New RPCs are added in a forward migration and use `mcp_require_writer`, table-level `FOR UPDATE` locking, existing `mcp_resolve_values` and `mcp_validate_field_value` helpers, and explicit SQL errors. This keeps project-bound and account-scoped MCP behavior identical.

Destructive operations use MCP annotations with `destructiveHint: true`. Non-destructive updates keep `destructiveHint: false`. Every write is admitted through existing MCP telemetry, and every successful table/field/table delete operation schedules table reindex where possible; row-specific updates schedule row reindex when row IDs are returned.

## Data Rules

- Tool inputs use canonical MCP names: `tableId`, `fieldId`, `rowId`, `rowIndex`, `projectId`, `dataType`, `referenceTableIds`.
- MCP supports field types already allowed by `fieldSchema`: `string`, `string_array`, `int`, `int_array`, `float`, `float_array`, `boolean`, `enum`, `date`, `reference`, and `image`.
- Row values are addressed by field labels, matching existing `create_table_row` and `update_table_row`.
- Field editing and field reordering use stable field IDs, not labels.
- All destructive clear/delete behavior must be explicit in tool input.
- The implementation must not introduce soft-delete tables or archive storage in this iteration.

## Error Handling

- PostgreSQL `42501` maps to project access revocation.
- PostgreSQL `P0002` maps to table or row not found depending on the RPC.
- PostgreSQL `PT409` maps to conflict for row/field/table changes that require reread.
- PostgreSQL `22023`, `23503`, and `23505` map to field validation failure.
- The returned MCP error is intentionally stable and non-sensitive. Detailed SQL exception text is not surfaced to MCP clients.

## Testing

- Add Deno tests for tools/list, schema requirements, project-bound calls, account-scoped projectId requirements, live write access, destructive annotations, and RPC parameter mapping.
- Add migration text tests for every new RPC signature, writer guard, reference cleanup logic, grants/revokes, duplicate/confirm guards, and value-clear safeguards.
- Run at minimum:
  - `npm run check:mcp`
  - `npm run test:mcp`
  - targeted Jest migration tests
  - `npm run typecheck`

## Real-Link Validation After Merge

After CI is green and the branch is merged, run a real MCP/OAuth smoke path against the deployed remote MCP endpoint:

1. Confirm write tools are discoverable on an account with editor/admin access.
2. Create or select a disposable project/table.
3. Exercise `update_table`, `edit_table_field`, `reorder_table_fields`, `bulk_update_table_rows`, `upsert_table_rows`, `delete_table_row`, `delete_table_field`, and `delete_table`.
4. Confirm viewer access rejects write calls.
5. Confirm project structure reads reflect the final state.

## Non-Goals

- Do not add UI controls.
- Do not add TDD red/green workflow.
- Do not implement soft delete or trash recovery.
- Do not add broad import/export tools.
- Do not change the existing in-app agent tools.
