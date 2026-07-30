# MCP Image Fields and Add-Field Tool Design

## Problem

The MCP image upload flow can produce verified image metadata and
`update_table_row` can persist that metadata into an image field. However,
MCP clients cannot currently create an image field: `create_table` excludes
the `image` data type, and there is no tool for adding a field to an existing
table.

## Goals

- Allow `create_table` to define `image` fields.
- Add an `add_table_field` write tool for existing tables.
- Preserve account and legacy endpoint behavior, including live write-access
  checks on every call.
- Keep field creation atomic and project-scoped.
- Make image fields usable with the existing signed upload and
  `update_table_row` flow.

## Non-Goals

- Renaming, deleting, or reordering existing fields.
- Adding `file`, `audio`, `media`, `multimedia`, or `formula` field support.
- Uploading binary data through MCP JSON.
- Adding required fields to tables that already contain rows.

## Tool Contract

`create_table.fields[].dataType` accepts `image` in addition to the existing
safe field types.

The new `add_table_field` tool accepts:

```json
{
  "projectId": "required on the account endpoint",
  "tableId": "table UUID",
  "field": {
    "label": "Icon",
    "dataType": "image",
    "section": "section1",
    "sectionId": "optional stable section identifier",
    "description": "optional description",
    "required": false
  }
}
```

The legacy project endpoint omits `projectId`, matching all other project
tools. The field shape reuses the strict `create_table` field schema. For this
tool, `required: true` is rejected because every existing table has at least
an initial row and the new field has no value for those rows.

On success, the tool returns the created field metadata: `field_id`,
`table_id`, `label`, `data_type`, `section`, `section_id`, `order_index`,
`required`, `description`, `enum_options`, `reference_table_ids`, and
`created_at`.

## Database Behavior

A new `mcp_add_table_field` security-definer RPC will:

1. Resolve the authenticated actor through `mcp_require_writer`.
2. Lock and verify that the target table belongs to the selected project.
3. Reject case-insensitive duplicate labels within the table.
4. Validate supported types and type-specific enum/reference options.
5. Resolve the section using the same defaults as `mcp_create_table`.
6. Append the field after the highest `order_index` in that section.
7. Insert the field and update the table, project, and optional folder
   timestamps atomically.

The migration will also replace `mcp_create_table` with the same implementation
except that its supported-type allowlist includes `image`. Existing grants and
revocations remain explicit.

## Errors and Permissions

- Viewer and revoked access returns the existing stable write-forbidden error.
- Missing or cross-project tables return the existing not-found error mapping.
- Duplicate labels, unsupported definitions, and required additions return
  field-validation failures.
- Reference fields continue to require every referenced table to belong to the
  same project.
- Account calls resolve project access immediately before each operation.

## Registration and Documentation

`add_table_field` is registered as a non-destructive write tool and included in
the server write-operation classifier, capability probes, account/legacy tool
expectations, and MCP documentation. No new resource template is needed.

## Testing

- MCP schema tests prove that `create_table` accepts `image` and
  `add_table_field` is advertised with the correct account/legacy project
  selector behavior.
- Tool handler tests prove the RPC call shape and live account authorization.
- Database behavior tests prove image-field creation on an existing table,
  ordering, duplicate rejection, required-field rejection, viewer denial, and
  cross-project reference rejection.
- Existing image upload and image-value persistence tests remain unchanged and
  must continue to pass.
