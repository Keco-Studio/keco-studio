# Keco Build Execution Policy

Follow this policy for every document-to-tables run. The user must be able to inspect the complete effect before any write.

## Preflight Phase

Perform zero writes while resolving scope, reading, planning, or preflighting.

1. Resolve unique project and document IDs.
2. Read the current project structure and complete source.
3. Validate every BuildPlan table name, field definition, enum option, match key, row, and reference.
4. Stop if any proposed table name already exists after trimming and case folding. Do not reuse, modify, merge, overwrite, delete, or silently rename it.
5. Stop if the plan has blockers, duplicate keys, unresolved references, unsupported required content, or unavailable write permission.

## Required Preview

Show all of these sections in this order:

```text
Source
- project name and stable projectId
- document name and stable documentId

New tables
- table name, purpose, match field
- fields with type and enum/reference details
- planned row count

Relationships
- source table.field -> target table
- planned reference count

Assumptions and warnings
- every item, or "None"

Execution
- create tables/scalar fields
- add reference fields
- upsert scalar rows
- resolve and write references
- read back and verify
```

End with a direct request to confirm this exact plan. Do not treat approval given before the preview as confirmation. If the user changes the plan, regenerate the preview and request confirmation again.

## Execution Order

After explicit confirmation, execute four stages:

1. Create every new table with its scalar and enum fields. Record returned table and field IDs by BuildPlan key.
2. Add reference fields after all target table IDs exist. Added fields must be optional because `keco:add_table_field` rejects required fields on an existing table.
3. Upsert scalar rows with the confirmed `matchField`. Record returned row IDs; query by match-field values when a response does not contain all required IDs.
4. Populate cross-table references with returned or queried stable row IDs. Use `keco:bulk_update_table_rows` for multiple existing rows and `keco:update_table_row` for one row.

Stop on the first failed write. Do not continue with another field, row, table, or relationship. Report the failed tool, stable error code, completed IDs, and unattempted stages. Do not call delete tools for rollback.

## Verification

After all writes succeed:

1. Read project structure again and compare each created table and field with the BuildPlan.
2. Page through `keco:query_table_rows` until every planned stable key is observed.
3. Compare row counts, match values, representative scalar values, and every planned reference.
4. Report a verification mismatch as partial completion, not success.

## Safe Resume

Keep the confirmed BuildPlan and returned execution IDs in the conversation result. On retry:

1. Re-read project structure and the affected rows.
2. Resume only when the recorded table IDs exist and their schemas and stable keys exactly match the confirmed BuildPlan.
3. Reuse only those exact recorded identities; a same-name table without the recorded ID is a collision.
4. If any identity, schema, or key differs, stop and produce a new BuildPlan, preview, and confirmation.

Never infer that an existing table is safe merely because its name or fields look compatible.
