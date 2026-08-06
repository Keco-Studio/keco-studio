# Remove Table Sections Design

## Problem

Keco tables currently group fields into named sections. A section appears as a
tab above the table and as a tab in the Predefine schema editor. Selecting a
section hides fields that belong to other sections. Section state also leaks
into table types, persistence services, import/export formats, Agent context,
and MCP tool contracts.

The product no longer needs field grouping. Tables should expose one ordered,
flat field list without section names, tabs, or section management actions.

## Scope

Remove the table-field section concept from all product-facing code and
contracts:

- The library table renders every field in one ordered set of columns.
- The Predefine page remains the schema editor, but renders one field list.
  Adding, editing, deleting, reordering, validating, and publishing fields all
  remain supported.
- Import, export, Agent, and MCP contracts no longer accept or return section
  names or section identifiers.
- Active-section selection, browser persistence, events, find/replace focus,
  rename, creation, and deletion behavior are removed.

This does not remove table rows, cell values, field definitions, the Predefine
feature itself, document headings, sidebar regions, page layout sections, or
React Email's `Section` component.

## Data Compatibility

The database `library_field_definitions.section` and `section_id` columns remain
temporarily because they are non-null and participate in existing constraints
and deployed RPCs. They become private compatibility details and must not
appear in product domain types or external responses.

A migration normalizes every library to one internal compatibility group. For
each library it:

1. Orders legacy sections by the minimum field `order_index` used by the
   current application.
2. Orders fields within each legacy section by `order_index`, using field ID as
   a deterministic tie-breaker.
3. Assigns consecutive global `order_index` values to the resulting flat list.
4. Assigns one fixed internal section name and one library-specific internal
   section ID to every field in that library.

The migration updates field-definition metadata only. Field IDs do not change,
so `library_asset_values`, formulas, references, and existing cell data remain
attached to the same fields.

New code always writes the internal compatibility values through a shared
persistence helper or database RPC implementation. Reads discard those values
at the service boundary.

## Application Design

### Domain and services

`PropertyConfig` becomes a field-only model with no `sectionId`.
Schema-loading services return an ordered property list instead of
`{ sections, properties }`. Field creation calculates the next order across the
whole library. Section CRUD services and their component props are deleted.

Library creation, version restoration, document-derived table creation, and
script import continue writing the compatibility columns internally while
exposing only flat fields to callers.

### Library table

Delete `SectionTabs`, `useLibrarySectionEditing`, section confirmation UI,
active-section local storage, section events, and section grouping utilities.
The table header, filtering, selection, resizing, find/replace, script-column
detection, and body all consume the same ordered property list.

The table displays all fields at once. Existing horizontal scrolling continues
to handle wide tables.

### Predefine

Predefine remains accessible at its current route and keeps its existing title
and publish flow. Its schema state changes from `SectionConfig[]` to
`FieldConfig[]`. The tab bar, new-section form, section naming, section deletion,
and TopBar section-state events are removed. The field forms render in one
sortable list.

### Import and export

Imports flatten any legacy section-aware input in its source order before
persisting fields. Current inputs that do not include sections are unchanged.

JSON export omits the top-level `sections` array and each property's
`sectionId`. XLSX export uses one field-header row instead of a section-header
row plus a field-header row. CSV remains a flat table.

### Agent and MCP

Remove active-section data from page context and selection serialization. Agent
schema tools and prompts describe tables as ordered fields only.

MCP `create_table` and `add_table_field` inputs no longer advertise or accept
`section` or `sectionId`. MCP read and write results omit section metadata. SQL
RPCs still populate compatibility columns internally without exposing them as
tool concepts.

## Errors and Permissions

Existing field validation, table permissions, and RPC authorization remain
unchanged. Removing section operations also removes section-specific errors
such as invalid, missing, ambiguous, or last-section deletion failures.

The migration must be transactional. Any normalization failure aborts the
whole migration rather than leaving a library partially flattened.

## Testing

- A database behavior test creates multiple legacy sections and proves the
  migration preserves section order, field order, field IDs, and cell values.
- Table structure tests prove all ordered fields are rendered without grouping
  or active-section filtering.
- Predefine tests prove a flat schema can add, edit, reorder, delete, validate,
  save, and reload fields.
- Import/export tests prove legacy section-aware inputs flatten in source order
  and new JSON/XLSX outputs contain no section metadata or section header row.
- Agent and MCP contract tests prove section arguments and response fields are
  absent while field creation and schema reads still work.
- Focused static checks ensure table product code no longer contains section
  components, section state keys, or section-facing types.
- Existing table editing, formula, reference, script, and document-derived
  table tests continue to pass.

## Rollout

Ship the normalization migration and application changes together. The
application remains compatible with a database that retains the two internal
columns, but it assumes all deployed application code uses the new flat
contracts. Removing the compatibility columns is explicitly deferred to a
separate database cleanup after all deployed RPC versions have stopped using
them.
