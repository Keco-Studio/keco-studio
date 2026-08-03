# Keco MCP Contract

Use fully qualified `keco:<tool>` names. The plugin MCP server name is `keco`, uses Streamable HTTP, and authenticates through the normal Keco OAuth flow.

The plugin uses the account endpoint. Include the stable `projectId` returned by `keco:list_projects` in every project operation. Never pass a project name where an ID is required.

## Read Tools

| Tool | Required input | Workflow use |
|---|---|---|
| `keco:list_projects` | none | Page accessible projects; disambiguate duplicate names |
| `keco:list_project_structure` | `projectId` | Read folders, table schemas, and bounded document summaries before planning and after execution |
| `keco:list_documents` | `projectId` | Page document metadata and resolve the source `documentId` |
| `keco:read_document` | `projectId`, `documentId` | Read `full`, `outline`, `heading`, or `lines` Markdown |
| `keco:query_table_rows` | `projectId`, `tableId` | Page rows, select semantic fields, or read one exact 1-based `rowIndex` |

Continue paginated reads while `hasMore` is true using the returned opaque cursor. Do not combine `cursor` with `rowIndex`. If a full document response is truncated, read `outline`, then every relevant `heading` or `lines` range needed to cover the plan; `lines` mode requires the 1-based `lineStart` and `lineEnd` inputs.

## Write Tools

| Tool | Required input | Workflow use |
|---|---|---|
| `keco:create_table` | `projectId`, `name`, `fields` | Atomically create one new table, its 1-100 initial fields, and an empty row |
| `keco:add_table_field` | `projectId`, `tableId`, `field` | Add one optional reference field after target table IDs exist |
| `keco:upsert_table_rows` | `projectId`, `tableId`, `matchField`, `rows` | Atomically create or update 1-100 rows by a stable scalar match field |
| `keco:update_table_row` | `projectId`, `tableId`, one of `rowId`/`rowIndex`, `values` | Populate references for one existing row |
| `keco:bulk_update_table_rows` | `projectId`, `tableId`, `rows` | Atomically populate references for 1-100 existing rows |

`create_table.fields[]` and `add_table_field.field` use semantic labels and these P0 `dataType` values: `string`, `string_array`, `int`, `int_array`, `float`, `float_array`, `boolean`, `enum`, `date`, and `reference`. An enum requires `enumOptions`. A reference requires existing target UUIDs in `referenceTableIds`.

`upsert_table_rows.rows[]` has the shape `{ "values": { "Field Label": value } }`. Use no more than 100 rows per call. The match field must be a stable `string`, `int`, `float`, `boolean`, `enum`, or `date` field.

For `update_table_row`, provide exactly one of `rowId` or `rowIndex`. When using a row index discovered earlier, also provide `expectedRowId` to fail closed if row order changed. For bulk updates, apply the same stable selector rule to each row.

## Excluded Tools

Do not call `edit_table_field`, `delete_table_field`, `delete_table_row`, `update_table`, `reorder_table_fields`, `delete_table`, image tools, or document write tools in P0. Do not call `create_table_row`; stable-key upserts are the required row path.

MCP error results and stable error codes are authoritative. Stop the write sequence immediately and report them without rewriting the outcome as success.
