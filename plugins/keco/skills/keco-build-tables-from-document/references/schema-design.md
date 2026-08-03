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
      dataType: 'string' | 'string_array' | 'int' | 'int_array' |
        'float' | 'float_array' | 'boolean' | 'enum' | 'date' | 'reference';
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

`key` values are plan-local stable identifiers. They are not Keco UUIDs. Keep Keco table, field, and row IDs returned by MCP in a separate execution map keyed by these values.

## Table Selection

- Create a table for a repeated entity with multiple attributes or relationships.
- Keep a scalar attribute on its owning entity instead of making a one-column table.
- Create an association table when a many-to-many relationship has its own attributes.
- Choose one canonical relationship direction unless the document explicitly requires both directions.
- Preserve a short source-evidence locator for every table, field, row, and relationship.

## Field Selection

Use only MCP-supported P0 field types:

| Source value | `dataType` |
|---|---|
| short or long text, identifier | `string` |
| repeated text values | `string_array` |
| whole number | `int` |
| repeated whole numbers | `int_array` |
| decimal number | `float` |
| repeated decimal numbers | `float_array` |
| true/false | `boolean` |
| one value from a closed vocabulary | `enum` |
| calendar date | `date` |
| relationship to another planned table | `reference` |

Provide `enumOptions` only for `enum`. Normalize whitespace and case, preserve user-facing spelling, and list each distinct option once. Provide `targetTableKey` only for `reference`; convert it to `referenceTableIds` after the target table exists.

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
