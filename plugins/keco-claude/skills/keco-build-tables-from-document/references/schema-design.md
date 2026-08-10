# Keco BuildPlan And Schema Design

Use this reference while converting the source document into a proposal. Do not call write tools during this phase.

## BuildPlan Contract

```ts
type BuildPlan = {
  version: 1;
  source: {
    projectId: string;
    documentId: string;
    documentState?: unknown;
  };
  tables: Array<{
    key: string;
    name: string;
    description?: string;
    sourceEvidence: string[];
    matchField: string;
    fields: Array<{
      key: string;
      label: string;
      dataType:
        | "string"
        | "string_array"
        | "int"
        | "int_array"
        | "float"
        | "float_array"
        | "boolean"
        | "enum"
        | "date"
        | "reference";
      required?: boolean;
      enumOptions?: string[];
      targetTableKey?: string;
      sourceEvidence: string[];
    }>;
    rows: Array<{
      key: string;
      scalarValues: Record<string, unknown>;
      references: Record<string, string[]>;
      sourceEvidence: string[];
    }>;
  }>;
  assumptions: string[];
  warnings: string[];
  blockers: string[];
};
```

## Ownership Boundary

`BuildPlan` is the approved static scope. After confirmation, a changed table, row, relationship, assumption, or acceptance rule requires a new plan revision. The plan must not contain current execution status, returned MCP IDs, write tokens, checkpoints, command output, verification evidence, or read-back results.

Keep returned IDs and mutable progress in the separate `ExecutionCheckpoint` defined by `execution-policy.md`. Keep mutation responses and verified read-back in its `VerificationReport`.

`key` values are plan-local stable identifiers. They are not Keco UUIDs. Keep Keco table, field, and row IDs returned by MCP in a separate execution map keyed by these values.

Use plan-local field keys as the keys in `scalarValues`. Use a source reference field's plan-local key as each `references` key; its string values are target row keys in that field's planned `targetTableKey`. During execution, map field keys to semantic field labels for field definitions and row `values`, and map `targetTableKey` plus target row keys to returned table, row, and display-field UUIDs for reference cells. Never send raw plan-local keys or source reference-field IDs to MCP.

## Table Selection

- Create a table for a repeated entity with multiple attributes or relationships.
- Keep a scalar attribute on its owning entity instead of making a one-column table.
- Create an association table when a many-to-many relationship has its own attributes.
- Choose one canonical relationship direction unless the document explicitly requires both directions.
- Preserve a short source-evidence locator for every table, field, row, and relationship.

## Field Selection

Use only MCP-supported P0 field types:

| Source value                          | `dataType`     |
| ------------------------------------- | -------------- |
| short or long text, identifier        | `string`       |
| repeated text values                  | `string_array` |
| whole number                          | `int`          |
| repeated whole numbers                | `int_array`    |
| decimal number                        | `float`        |
| repeated decimal numbers              | `float_array`  |
| true/false                            | `boolean`      |
| one value from a closed vocabulary    | `enum`         |
| calendar date                         | `date`         |
| relationship to another planned table | `reference`    |

Provide `enumOptions` only for `enum`. Normalize whitespace and case, preserve user-facing spelling, and list each distinct option once. Provide `targetTableKey` only for `reference`; convert it to `referenceTableIds` after the target table exists.

For a required reference, order table creation so the target table ID exists and include the reference field in the source table's `create_table` call. Apply the same dependency order to rows: every referenced target row key must resolve to a UUID before the dependent source row is upserted, and the required reference value must be present in that upsert. If a dependency cycle, missing target row, or unresolved target prevents that order, add a blocker and stop before preview; never downgrade the required reference to optional. Optional references may be included at table creation when their targets exist or added afterward.

Do not plan `image`, formula, audio, local-file, or destructive-maintenance fields in P0. Put unsupported content in `warnings` and omit it from writes.

## Stable Row Matching

Every table requires one scalar `matchField` accepted by `keco:upsert_table_rows`.

1. Prefer a document-defined immutable ID or unique code.
2. Otherwise use a naturally unique name only when uniqueness is explicit and verified inside the plan.
3. Otherwise add a `Key` field with `dataType: string`.
4. Derive fallback keys deterministically from the plan entity name: Unicode-normalize, trim, lowercase, replace non-alphanumeric runs with `-`, and add a stable numeric suffix for collisions in source order.

Block the plan when the selected match values are missing or duplicated.

## Assumptions And Blockers

Put a reversible interpretation in `assumptions`, such as selecting `float` for a percentage. Put anything that can change table identity, cardinality, uniqueness, or a reference target in `blockers`. Resolve every blocker with the user before preview confirmation.
