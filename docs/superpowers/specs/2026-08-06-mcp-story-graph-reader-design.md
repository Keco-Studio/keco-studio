# MCP Story Graph Reader Design

Date: 2026-08-06
Status: Approved

## Summary

Add a read-only `read_story_graph` tool to the remote Keco MCP service. The tool reads a document-derived Script library, reconstructs the same canonical story graph used by the in-application Agent, validates the complete graph, and returns lossless story semantics through snapshot-bound cursor pagination.

The tool is available on both the account-scoped MCP endpoint and legacy project-scoped endpoints. It does not create, edit, or delete graph data.

## Goals

- Read every canonical story node in stable Script row order.
- Return the entry, endings, ordinary successors, choices, commands, Plot groups, Plot edges, validation warnings, and whole-graph summary.
- Support graphs whose complete serialized form would exceed the MCP response limit.
- Ensure pages from different graph versions cannot be combined silently.
- Reuse the existing Agent story-graph parser and validator rather than maintaining an MCP-specific interpretation.
- Preserve the current account and legacy endpoint authorization behavior.

## Non-Goals

- Creating, updating, deleting, or reordering nodes or edges.
- Returning unrelated custom Script table columns.
- Supporting arbitrary tables that do not represent a document-derived Script.
- Repairing invalid or legacy story graphs.
- Returning a presentation layout or node coordinates.
- Selecting a library by name.

## Supported Libraries

The tool accepts a `libraryId` for a library that:

- belongs to the selected project;
- has `document_export_type = 'script'`;
- has a valid version 2 `plot_plan`;
- has a `plot_plan.storyNodeOrder` aligned with the canonical ordered Script rows; and
- contains the required Script fields used by the existing story-graph codec.

Unsupported or invalid libraries fail with a stable diagnostic. Read behavior does not attempt an implicit migration or repair.

## Architecture And Reuse

Register `read_story_graph` through the existing read-tool registration path:

- Account endpoint input: `projectId`, `libraryId`, optional `limit`, and optional `cursor`.
- Legacy endpoint input: `libraryId`, optional `limit`, and optional `cursor`.

Project resolution and role checks continue to use the existing account/legacy MCP context. Viewer, editor, and admin roles may call the tool because it is read-only.

The implementation separates three concerns:

1. A portable pure TypeScript story-graph core owns row decoding, Jump/End parsing, choice decoding, Plot-plan parsing, graph validation, summaries, and warnings.
2. The existing application Agent snapshot reader and MCP operation each own their environment-specific database reads.
3. The Agent and MCP adapters independently shape their public response without duplicating graph semantics.

Refactor the existing `src/lib/story-graph` code only as required to remove Next.js path aliases and incompatible runtime dependencies from the portable core. Both consumers must execute the same codec and validator tests. Do not copy those algorithms into `supabase/functions/mcp`.

The existing visible Plot fragment coalescing behavior in `read-story-graph.ts` becomes a shared pure helper so Agent and MCP return the same Plot grouping and edges.

## Tool Contract

The account-scoped input is:

```json
{
  "projectId": "uuid",
  "libraryId": "uuid",
  "limit": 100,
  "cursor": "opaque optional cursor"
}
```

The legacy input omits `projectId`. `limit` defaults to 100 and accepts 1 through 200. A cursor cannot be reused with another project, library, or limit.

Every successful page returns:

```json
{
  "ok": true,
  "library": {
    "id": "uuid",
    "name": "Script name",
    "snapshotId": "opaque digest"
  },
  "graph": {
    "entryLabel": "Intro",
    "entryPlotNodeId": "Opening",
    "summary": {}
  },
  "items": [
    { "kind": "warning" },
    { "kind": "plot_node" },
    { "kind": "plot_edge" },
    { "kind": "story_node" }
  ],
  "returnedCount": 100,
  "hasMore": true,
  "nextCursor": "opaque cursor"
}
```

`graph` is a bounded whole-graph overview repeated on each page so every response is independently understandable. `items` is one canonical typed stream containing, in order, all validation warnings, all Plot nodes, all Plot edges, and all story nodes. The cursor advances through that stream. Warnings, Plot nodes, and Plot edges therefore remain readable even when their combined metadata cannot fit in one response.

A `warning` item contains a stable warning code and affected label. A `plot_node` item contains its stable ID, title, first and last story labels, and story-node count. Plot membership is reconstructed losslessly from each story node's `plotNodeId`, avoiding an unbounded label array in one item. A `plot_edge` item contains its source and target Plot IDs plus option text and option index. A `story_node` item contains the canonical executable node semantics below.

Each node contains:

- `label`: stable story-node identity;
- `plotNodeId` and `plotTitle`;
- `rowId` and one-based `rowIndex`;
- `nodeType`;
- `speaker`, when non-empty;
- `content`;
- non-control `commands`;
- `terminal`;
- `nextLabel`, when the node has an ordinary successor; and
- `choices`, including `optionIndex`, `text`, `targetLabel`, and choice `commands`.

Empty commands are returned as empty strings where needed for lossless semantics. Fields unrelated to the executable story graph are omitted.

## Pagination And Consistency

The operation loads and validates the complete canonical graph before slicing the requested item page. This ensures whole-graph warnings and summaries are accurate and that a page never exposes a partially validated graph.

The first page computes a deterministic snapshot digest over:

- library identity and update token;
- canonical `plot_plan`;
- ordered field identities, labels, types, and order indexes;
- ordered row identities, row indexes, names, and update tokens; and
- every required Script cell value used to decode the graph.

The opaque signed cursor binds the project, library, snapshot digest, limit, and next item offset. Each later call reloads the graph and recomputes the digest. A mismatch returns `STORY_GRAPH_CONFLICT`; the caller must discard collected pages and restart without a cursor.

The operation follows the existing MCP maximum 1 MiB response limit. Before returning a page, it measures the structured result. If one typed item or the bounded repeated overview cannot fit, it returns `PAYLOAD_TOO_LARGE` rather than truncating content. Normal page-size overflow is handled by returning fewer items and a valid `nextCursor`.

## Data Flow

```text
tools/call read_story_graph
  -> resolve and authorize project
  -> load library metadata and plot_plan
  -> load ordered Script fields, rows, and required values
  -> run shared row codec
  -> run shared graph validator and Plot summarizer
  -> verify or create snapshot-bound cursor
  -> build the canonical warning, Plot-node, Plot-edge, and story-node item stream
  -> slice a response-sized item page
  -> return structured MCP content
```

The operation performs no database writes and has read-only, non-destructive, idempotent, closed-world MCP annotations.

## Errors

Use stable public MCP errors:

- `TABLE_NOT_FOUND`: the selected library does not exist in the project.
- `STORY_GRAPH_UNSUPPORTED_LIBRARY`: the library is not a supported document-derived Script or does not use plot-plan version 2.
- `STORY_GRAPH_INVALID_SNAPSHOT`: rows, fields, values, or Plot membership cannot form a valid canonical graph.
- `STORY_GRAPH_CONFLICT`: the graph changed between pages.
- `FIELD_VALIDATION_FAILED`: non-cursor input arguments are invalid.
- `INVALID_CURSOR`: the signed cursor is malformed, expired, or bound to another project, library, or page limit.
- `PAYLOAD_TOO_LARGE`: a lossless response cannot fit even after page reduction.
- `PROJECT_ACCESS_REVOKED`: current project membership no longer permits reading.
- `INTERNAL_ERROR`: the database operation failed without a safe domain-specific diagnostic.

Errors must not expose database details, raw SQL messages, access tokens, or cursor contents.

## MCP Discovery And Documentation

- Add `read_story_graph` to MCP read-operation telemetry classification.
- Register it for both account and legacy project modes.
- Keep it visible for viewer-only accounts.
- Document the tool, pagination loop, snapshot conflict behavior, and the requirement to obtain `libraryId` from `list_project_structure`.
- Extend the capability probe so production acceptance verifies discovery and a bounded read without recording story content in evidence files.

## Testing

### Shared Core Tests

- Reuse existing row codec and validator fixtures without changing their semantics.
- Verify Jump, End, physical fallthrough, choices, choice commands, Plot membership, unreachable warnings, and path counts.
- Verify Agent and MCP adapters produce equivalent canonical node and Plot semantics from the same fixture.

### MCP Operation Tests

- Read a complete small graph in one page.
- Read a graph across multiple pages with no missing or duplicate labels.
- Page Plot nodes and Plot edges instead of assuming their metadata fits in one response.
- Preserve full content and commands at page boundaries.
- Return the bounded overview and summary on every page, and page all warnings without truncation.
- Reduce page size when the requested page would exceed the response budget.
- Reject an individually oversized node without truncation.
- Reject a cursor for another project, library, limit, or snapshot.
- Return `STORY_GRAPH_CONFLICT` after a field, row, or Plot-plan change.
- Reject non-Script, version 1, malformed, cross-project, and inaccessible libraries.

### Registration And Protocol Tests

- Discover the tool on account and legacy endpoints.
- Discover the tool for viewer-only access.
- Require `projectId` only on the account endpoint.
- Classify calls as read operations for rate limits and telemetry.
- Keep structured responses below the configured maximum response size.

## Acceptance Criteria

- A client can start with `list_project_structure`, call `read_story_graph` with the returned Script `libraryId`, follow cursors until `hasMore` is false, and reconstruct every canonical node and edge without reading raw table rows.
- The assembled story-node labels exactly equal `plot_plan.storyNodeOrder` in order.
- The assembled Plot-node and Plot-edge items exactly represent the canonical visible Plot tree.
- The assembled warning items exactly equal the shared validator output.
- Every ordinary and choice edge target resolves to one returned label.
- The MCP and in-application Agent agree on graph entry, Plot groups, node content, commands, edges, endings, warnings, and summary for the same snapshot.
- No read path mutates project data.
