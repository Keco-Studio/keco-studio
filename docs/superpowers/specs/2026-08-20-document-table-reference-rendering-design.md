# Document Table Reference Rendering Design

## Goal

Replace inline table-row reference chips in document content with a readable table projection. A reference group displays the source table name as a link above the table, then displays the source field headers and one visible row per referenced asset. Document-block and document-range references remain inline chips.

## Root Cause

The existing document toolbar serializes every selected row as an independent inline `<ResourceReference kind="table-row" />`, separated by one space. `resolveTableReferences` already loads the source library, all ordered field definitions, the selected assets, and all cell values, but reduces each result to one joined label before returning it. `ResourceReferenceEditor` consequently has neither the structured row data nor grouping information required to render a table.

The prior change to `src/lib/gdd-generation/tableResources.ts` affects only generated GDD Markdown and does not participate in document-body resource reference rendering. That change and its task-specific documentation must be removed as part of this correction.

## Compatibility Strategy

Keep the sanctioned MDX schema and persisted Yjs content unchanged. Do not introduce a new component kind, group ID, database field, or migration.

Each mounted table-row reference exposes its stable reference key and library ID as data attributes. A client-side grouping hook locates the nearest document block and inspects table-row reference elements in DOM order. A group is one maximal run where:

- every reference targets the same library; and
- only whitespace occurs between adjacent reference elements.

Non-reference text, a different library, or a different document block ends the run. This exactly recognizes the space-separated nodes produced by the existing multi-row insertion path while avoiding accidental merging of references from separate prose or separate blocks.

The first reference in a resolved group renders the full table projection. Other references in that group keep their editor nodes and persisted identifiers but render no duplicate visual content. Removing the first reference promotes the next reference after the registration/layout revision updates. Duplicate references remain duplicate rows because grouping follows DOM occurrences, not only deduplicated resolver keys.

This runtime projection applies to existing and newly inserted references after load without mutating the document merely for presentation.

## Resolver Contract

Extend available table-row `ResolvedResourceReference` results with structured table data:

- source library ID, name, and table-level route;
- ordered field IDs and labels;
- referenced asset ID and name;
- values keyed by field ID.

Retain the existing `key`, `status`, joined `label`, `contextLabel`, and row-level `href` fields for compatibility with exports, navigation tests, and loading/error fallbacks. The resolver must reuse the data it already fetched; this feature adds no database query.

Document reference results do not carry table data.

## Rendering

For a group with at least one available structured table result:

1. Render the table name above the grid as a normal link to `/{projectId}/{libraryId}` without an asset query.
2. Render one column header per ordered field.
3. Render rows in document reference order, not source table order.
4. Render each cell through the existing `cellDisplayString` helper. Missing and null values produce an empty cell.
5. Do not display the table purpose, row IDs, field summary text, or table/row chips.
6. If an occurrence is unavailable while another occurrence supplies the schema, render a full-width `Reference unavailable` row in its position.

The projection uses semantic ARIA table, row, column-header, and cell roles on phrasing elements. This avoids invalid block/table HTML inside MDXEditor's inline Lexical decorator while allowing CSS grid styling to match the editor's native table appearance. The table has stable column tracks, cell borders, restrained header fill, wrapping text, and horizontal overflow on narrow viewports.

Before structured data is available, on resolver errors, or when every occurrence in a run is unavailable, retain the current per-reference fallback/unavailable chip behavior. Document references retain their current rendering and navigation behavior in all states.

## React and Group Lifecycle

`ResourceReferenceProvider` remains the owner of deduplicated data resolution and realtime invalidation. It exposes the current resolved map plus a registration revision needed by the grouping hook. The revision changes when reference occurrences mount or unmount, including duplicate occurrences that share a resolver key.

The grouping hook runs in a layout effect from `ResourceReferenceEditor`, reads the nearest block's marked references, and returns the run containing the current element. A DOM `Range` determines whether content between adjacent marked elements is whitespace-only. The hook recomputes when the target, registration revision, or resolved data changes. It performs no DOM mutation and registers no independent data subscription.

## Error Handling

- Invalid attributes continue to render the existing invalid-reference warning.
- A transient resolver failure continues to show fallback chips.
- An entirely missing or forbidden group continues to show one unavailable state per stored occurrence.
- A partially unavailable group retains its table shape and row order with an unavailable row.
- Realtime library broadcasts reuse the existing query invalidation so headers and cell values refresh in place.

## Testing

### Service tests

- Available table references return table name, table route, ordered fields, asset identity, and all cell values.
- Existing joined label, context, and row route remain unchanged.
- Cross-project or mismatched targets remain unavailable without structured data.

### Grouping tests

- Space-separated same-library references in one document block form one ordered group.
- Non-whitespace prose, different libraries, and different blocks split groups.
- Duplicate keys remain duplicate occurrences.
- Removing the first occurrence allows the next occurrence to become primary.

### Component tests

- One table-row reference renders a linked table name, headers, and one row.
- Multiple grouped references render one table with multiple rows and suppress duplicate projections.
- Missing values are blank and complex values use the established cell display helper.
- A partially unavailable group renders an unavailable row.
- Loading, all-unavailable, invalid, document-block, and document-range references retain their current chip behavior.

### Regression tests

- Existing picker multi-row insertion remains space-separated sanctioned MDX.
- Existing row-level resolution/navigation contracts remain available.
- Relevant document reference and sanctioned-MDX tests continue to pass.

## Scope

In scope: document-body table-row reference resolution, runtime grouping, presentation, and focused regression coverage.

Out of scope: changing source table data, editing referenced cells inside the document, changing document-reference chips, changing export text, persisting presentation-only groups, or modifying generated GDD table-resource sections.
