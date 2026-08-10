# Keco Build Execution Policy

Follow this policy for every document-to-tables run. The user must be able to inspect the complete effect before any write.

## Preflight Phase

Perform zero writes while resolving scope, reading, planning, or preflighting.

1. Resolve unique project and document IDs.
2. Read the current project structure and complete source.
3. Validate every BuildPlan table name, field definition, enum option, match key, row, and reference.
4. Stop if any proposed table name already exists after trimming and case folding. Do not reuse, modify, merge, overwrite, delete, or silently rename it.
5. Compute one required-reference dependency order for both table creation and row upserts. Each target table must exist before its source table is created, and target rows and their UUIDs must exist before dependent source rows are upserted. Stop if a required reference cannot satisfy both conditions; record the dependency cycle, missing target row, or unresolved target as a blocker before preview.
6. Stop if the plan has blockers, duplicate keys, unresolved references, unsupported required content, or unavailable write permission.

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
- create tables with all non-reference P0 fields and eligible references
- add remaining optional reference fields
- upsert rows in dependency order with required references
- resolve and write remaining optional references
- read back and verify
```

End with a direct request to confirm this exact plan. Do not treat approval given before the preview as confirmation. If the user changes the plan, regenerate the preview and request confirmation again.

## Execution Order

After explicit confirmation, execute four stages:

1. Create every new table in the preflighted dependency order. Include all non-reference P0 fields, including array and enum fields, plus each reference field whose target table ID is already known. A required reference must be included in this `keco:create_table` call so its `required` value is preserved. Record returned table and field IDs by BuildPlan key.
2. After all target table IDs exist, add any remaining optional reference fields. `keco:add_table_field` rejects required fields on an existing table, so never downgrade a required reference to optional. A required reference that cannot be included during table creation is a preflight blocker and must not reach execution.
3. Upsert rows in the preflighted required-reference dependency order, so target rows and their UUIDs exist before dependent source rows. Each row's `values` must include all non-reference values and all required reference values in the same `keco:upsert_table_rows` call; otherwise row validation rejects the empty required field. Include optional reference values too when their targets are already resolved. For each new table with planned rows, the first `keco:upsert_table_rows` call must set `reuseEmpty: true` to populate the empty row created by `keco:create_table`; set it to `false` for later batches. Record returned row IDs and query by match-field values when a response does not contain all required IDs.
4. Populate only the remaining optional cross-table references with returned or queried stable row IDs. Use `keco:bulk_update_table_rows` for multiple existing rows and `keco:update_table_row` for one row.

Stop on the first failed write. Do not continue with another field, row, table, or relationship. Report the failed tool, stable error code, completed IDs, and unattempted stages. Do not call delete tools for rollback.

## Verification

After all writes succeed:

1. Read project structure again and compare each created table and field with the BuildPlan.
2. Page through `keco:query_table_rows` until every planned stable key is observed.
3. Compare row counts, match values, representative scalar values, and every planned reference.
4. Report a verification mismatch as partial completion, not success.

## Execution State And Evidence

Keep mutable state in an `ExecutionCheckpoint` separate from the confirmed `BuildPlan`. It owns the plan revision, current stage, returned table/field/row IDs, completed writes, blocked boundary, and resume point.

Keep tool responses and read-back evidence in a `VerificationReport` separate from both the plan and checkpoint. It owns attempted operations, exact failures, verified schemas, stable keys, row counts, reference results, and incomplete work.

When execution pauses, render this checkpoint in the user's language instead of dumping its machine object:

```text
Status: execution paused
Blocked at: failed operation or gate
Completed: verified work retained so far
Writes performed: none or exact partial scope
Why: specific failure
User action: one concrete action without a secret
Resume from: exact operation or stage
Checkpoint: non-secret plan, source, and returned IDs
Revalidation: checks required before resume
```

## Safe Resume

Keep the confirmed BuildPlan and returned execution IDs in the conversation result. On retry:

1. Re-read project structure and the affected rows.
2. Resume only when the recorded table IDs exist and their schemas and stable keys exactly match the confirmed BuildPlan.
3. Reuse only those exact recorded identities; a same-name table without the recorded ID is a collision.
4. If any identity, schema, or key differs, stop and produce a new BuildPlan, preview, and confirmation.

When project identity, confirmed plan revision, schema, and stable keys are unchanged, resume at the recorded operation and do not repeat the confirmation or settled questions. If one changed, ask only the decision invalidated by that change.

Never infer that an existing table is safe merely because its name or fields look compatible.
