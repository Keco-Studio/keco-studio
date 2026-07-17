# Library Table Rich Clipboard Design

**Date:** 2026-07-17
**Status:** Approved for implementation
**Scope:** Preserve table structure when copying project table cells into an in-app document.

## Goal

When a user copies selected cells from a project library table and pastes them into a
Keco Studio document, the document editor must create a table instead of inserting
tab-separated plain text.

## Current Behavior and Root Cause

`useClipboardOperations` serializes copied and cut cells as TSV and writes only
`text/plain` through `navigator.clipboard.writeText`. The document editor already enables
MDXEditor's table plugin, but it cannot infer a table node from that plain-text clipboard
payload.

## Decisions

- The copied selection remains the sole source of rows and columns.
- Copying cells does not automatically prepend project property names.
- If the copied matrix already contains a column-name row, that row is preserved as part
  of the pasted table.
- Pasting creates a native document table. Users with document edit permission can edit
  its cells normally; viewers remain read-only.
- The pasted table is an independent snapshot. Later edits in either the source library
  table or the document table do not update the other side.
- The system clipboard receives both `text/plain` TSV and `text/html` table representations.
- Plain-text TSV remains unchanged so spreadsheet and text-editor workflows keep working.
- Browsers without `ClipboardItem` or `navigator.clipboard.write` fall back to the existing
  `navigator.clipboard.writeText` behavior.
- Copy and cut use the same serialization and clipboard-writing path.

## Design

Add a framework-light clipboard serialization helper in the library table domain. It accepts
the existing two-dimensional cell matrix and returns:

- TSV generated with the current null-to-empty and tab/newline rules;
- an HTML `<table>` containing one `<tr>` per matrix row and one `<td>` per cell.

HTML text is escaped for `&`, `<`, `>`, double quotes, and single quotes before insertion.
The helper does not interpret the first row or generate `<th>` elements because the source
selection does not implicitly include column headers.

Add a clipboard writer that creates one `ClipboardItem` with `text/plain` and `text/html`
blobs when the rich Clipboard API is available. If rich writing is unavailable or rejects,
it attempts `writeText` with the TSV payload. A total clipboard failure keeps the existing
non-blocking error handling and must not prevent internal copy/cut state from being recorded.

`useClipboardOperations` will use these helpers for both copy and cut while retaining its
current session-storage signature, internal matrix, selection feedback, and paste behavior.
The stored signature remains the exact TSV string.

## Data Flow

```text
selected project cells
  -> existing ordered matrix
  -> serialize as TSV + escaped HTML table
  -> ClipboardItem(text/plain, text/html)
  -> MDXEditor consumes text/html
  -> tablePlugin creates a document table
```

Consumers that do not accept HTML continue to consume the TSV representation.
The clipboard payload contains values only and carries no source-row identifiers or live
binding metadata.

## Testing

Unit tests will prove that:

- a matrix without column names produces an HTML table with only the selected rows;
- a matrix containing a column-name row preserves it as the first table row;
- null values become empty cells and numeric values remain visible;
- HTML-sensitive cell content is escaped without changing the TSV representation;
- rich clipboard writing supplies both MIME types;
- unsupported or rejected rich clipboard writes fall back to `writeText`;
- copy and cut are both wired through the shared rich clipboard path.

Focused unit tests, type checking, and linting of the changed files form the implementation
verification gate.

## Non-Goals

- Automatically adding project column names.
- Changing which cell data types can currently be copied.
- Changing project-table-to-project-table paste semantics.
- Adding custom clipboard MIME types.
- Intercepting all tab-separated pastes inside the document editor.
- One-way refresh, live references, or bidirectional synchronization between source and
  pasted tables.
