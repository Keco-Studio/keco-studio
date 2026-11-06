# Document Branch Structure Design

## Goal

Add folder-scoped document relationships to Script while preserving the existing folder/document sidebar and document-internal Branch Structure.

## Confirmed UX

- Clicking a folder expands/collapses its documents in the Script sidebar and selects that folder's `Document Branch Structure` in the main area.
- The folder graph contains document nodes only. A node click opens the corresponding Script document.
- Opening a document keeps the folder expanded and shows that document's existing internal Branch Structure alongside the editor.
- Document connections are directed, can be unnamed or have an optional branch name, and are limited to documents in the same folder for the first release.
- Connections cannot self-link, duplicate, or create a cycle.

## Architecture

Folder-level relations live in `script_document_edges`, separate from document membership and from the existing internal script graph. The folder branch route fetches the folder's Script documents and edges, renders a lightweight SVG graph using the existing flow-chart conventions, and provides a connection dialog. Document routes continue to own internal graph rendering.

## Data Contract

`script_document_edges` stores `project_id`, `folder_id`, `parent_document_id`, `child_document_id`, nullable `branch_name`, and `sort_order`, with a unique parent/child pair. API responses return document metadata and edges for a folder; POST validates project membership, same-folder membership, and acyclicity.

## Error Handling

Invalid documents, cross-folder links, duplicate links, self-links, and cycles return 4xx responses with stable error messages. UI keeps the graph unchanged and shows the existing toast mechanism.

## Testing

Cover graph normalization/cycle detection, API validation and persistence, folder click navigation, and graph node navigation. Existing Script workspace and internal graph tests must remain green.
