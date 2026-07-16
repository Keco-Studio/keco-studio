# Agent Project Document Integration Design

**Date:** 2026-07-16
**Status:** Approved design
**Scope:** Connect Keco Assistant to project `documents` for discovery, exact and semantic reads, content operations, metadata CRUD, and permanent deletion

## Goal

Keco Assistant must treat project documents as first-class project data. A user
can ask about the document currently open in the UI, explicitly target another
document in the same project, search across document content, and create, read,
edit, rename, move, or delete documents through the existing Agent tool loop.

The implementation reuses the current document domain boundaries:

- `documentService` for document metadata CRUD;
- `documentStateGateway` for the latest logical collaborative content;
- `propose_document_edit` and the existing preview/confirmation resume path for
  guarded content replacement;
- the existing Agent tool registry, permissions, SSE events, confirmation card,
  and embedding pipeline.

No second document persistence or permission layer is introduced.

## Current Gap

The repository already contains `create_document`, `read_document`, and
`propose_document_edit`, but the Agent cannot reliably discover or target living
project documents:

- `list_project_structure` returns folders and libraries but not documents;
- `NavigationContext` knows `currentDocumentId`, but `ChatPanel`, the Agent route,
  conversation context, and system prompt do not carry it;
- existing conversations omit live navigation fields on later turns;
- document tools generally require a UUID that the model cannot discover;
- rename, move, and delete tools do not exist;
- `design_document` embeddings represent uploaded chat messages, not rows in the
  project `documents` table;
- Auto mode currently has no way to require confirmation for one irreversible
  tool.

This is why the Agent can report folder and library counts while failing to find
a document that is visibly open in the application.

## Product Decisions

### Project-bound, dynamically targeted documents

The conversation remains bound to its original project. This is the security
boundary and prevents navigation or prompt input from retargeting a conversation
to another project.

The document target is not frozen. Every Agent turn may carry the currently open
`currentDocumentId`. The server verifies that the ID belongs to the bound project
before adding it to `ToolContext` and the model's page context. An explicitly
named or identified document overrides the current page default.

Target resolution order is:

1. explicit document ID;
2. explicit exact document name, optionally qualified by folder;
3. verified current document from the live page context;
4. no target, in which case the Agent lists candidates or asks the user.

The current document is a default, not an exclusive scope. A user viewing
document A can read or modify document B in the same project.

### Ambiguous names

Document names are not assumed unique. If an exact name resolves to multiple
documents, the resolver returns candidates containing name, folder path,
updated time, and ID. No write runs until the user selects one. The Agent never
chooses by recency, folder proximity, or row order.

The same safeguard applies before creating a document with an existing exact
name. The Agent reports existing candidates and requires explicit confirmation
that a duplicate is intended.

### Permanent deletion

This phase reuses `deleteDocument`; it does not add a recycle bin or soft-delete
schema. Deletion is permanent and remains available only to users with document
write permission.

Deletion always requires confirmation, including in Auto mode. The preview phase
resolves the document to a stable ID and displays its name and folder. The apply
phase revalidates the project, actor permission, and exact ID before invoking
`deleteDocument`.

## Architecture

### Live document context

Extend the following types with `currentDocumentId` and server-derived
`currentDocumentName` where appropriate:

- `ChatPanel` navigation context;
- `useAgentChat` request body;
- `/api/agent-chat` request parsing;
- `ToolContext`;
- page-context augmentation;
- system prompt context.

New conversations keep the existing project/folder/table scope snapshot. Every
turn, including turns in an existing conversation, may additionally send the
live `currentDocumentId`. The server ignores client-supplied document names and
loads the verified document summary itself. A missing, inaccessible, or
cross-project ID is omitted from the context rather than trusted.

This change is additive. Existing table and folder scope behavior remains
frozen and unchanged.

### Document resolver

Add a shared Agent document resolver, following the existing library resolver
pattern. It consumes the caller-scoped Supabase client, bound project ID, and a
selector containing optional document ID, document name, and folder qualifier.

The resolver returns a discriminated result:

- one resolved document summary;
- not found;
- ambiguous, with safe candidate metadata;
- invalid current-document context;
- project or permission failure.

All document tools use this resolver. Individual tools do not duplicate name or
folder lookup logic.

### Agent tools

Keep tools atomic and register them through the existing tool registry:

- `list_documents`: list or filter project documents by name and folder without
  loading content;
- `create_document`: retain the existing implementation and add duplicate-name
  preflight behavior;
- `read_document`: accept a document selector and read the latest logical state;
- `propose_document_edit`: accept a document selector and deterministic content
  operations, then reuse the current preview and apply boundary;
- `rename_document`: resolve the target and call `updateDocumentName`;
- `move_document`: resolve the target/folder and call `moveDocument`;
- `delete_document`: post-preview permanent deletion with mandatory confirmation.

`list_project_structure` also includes lightweight document summaries grouped by
folder so general project exploration exposes documents without a separate tool
round trip. It must not include document bodies.

### Content reads

`read_document` supports bounded reads:

- complete document when it fits the Agent result budget;
- outline/headings;
- a named heading section;
- a line range.

All modes read through `documentStateGateway`, not directly from
`documents.content`, so uncompacted durable Yjs updates are included. Returned
data includes document ID, name, folder, state token, selected Markdown, and
range metadata. If a complete read exceeds the result budget, the tool returns
an outline and explicit range guidance rather than silently truncating content.

### Deterministic content operations

Extend `propose_document_edit` without replacing its safety boundary. It accepts
one of these operations:

- `replace_all`: provide a complete replacement document;
- `replace_text`: replace one exact text or section span;
- `insert_before`: insert relative to one exact anchor;
- `insert_after`: insert relative to one exact anchor;
- `append`: append content to the document;
- `delete_text`: remove one exact text or section span.

For non-`replace_all` operations, the server reads the latest state and constructs
the proposed full Markdown deterministically. An anchor must occur exactly once.
Zero or multiple matches fail without mutation. The generated full document then
uses the existing sanctioned MDX validation, base hash, update-tail snapshot,
state token, diff preview, `pre_agent` backup, transactional replacement, and
Realtime reset broadcast.

This lets the model make precise changes to long documents without copying the
entire body into a tool argument.

### Confirmation policy

Replace the implicit boolean-only decision with an additive tool policy:

```ts
type ConfirmationPolicy = 'mode' | 'always';
```

`mode` preserves current Auto/Confirm behavior and is the default. `always`
forces the existing pending-action confirmation path regardless of conversation
mode. Only `delete_document` uses `always` in this phase.

The existing `confirmationMode` continues to define whether confirmation occurs
before execution or after a non-mutating preview. `delete_document` uses
`post_preview` so the confirmation card is based on a resolved stable ID.

## Data Flow

### Read current document

1. The client sends the live `currentDocumentId` with the user turn.
2. The Agent route derives the bound project from conversation state.
3. The server verifies the current document belongs to that project and adds it
   to `ToolContext`.
4. Page context tells the model that the document is a default target, not a
   locked scope.
5. `read_document` resolves the default and reads the latest logical content
   through `documentStateGateway`.

### Read or modify another document

1. The user explicitly supplies a name or ID.
2. The resolver ignores the current-page default and searches the bound project.
3. One match proceeds; multiple matches return candidates and stop.
4. Reads return bounded current content. Writes generate a validated proposal
   against the latest token and update tail.
5. Auto mode applies ordinary document writes immediately. Confirm mode suspends
   at the existing preview or pre-execute boundary.

### Delete a document

1. `delete_document.execute` performs only lookup and returns a preview with the
   stable document ID, name, and folder.
2. `confirmationPolicy: 'always'` stores a pending action in every mode.
3. On approval, `executeImport` verifies the preview payload, rechecks project
   membership and role, confirms the exact ID still exists, and calls
   `deleteDocument`.
4. The UI invalidates document/sidebar queries and the document embedding chunks
   are removed.

## Project Document Semantic Index

Add `project_document` as a distinct `agent_embedding_chunks.source_type`.
Do not reinterpret or overwrite the existing `design_document` source type,
which remains attached to uploaded chat messages.

Document chunks include:

- project and document IDs;
- document name and folder metadata;
- heading or line-range metadata;
- content hash;
- document update time and state token when available.

Extend `semantic_search` with a `project_document` scope and include it in `all`.
Results always identify the source document and location. Semantic snippets are
discovery context only. Before any write, the Agent resolves the document and
re-reads the latest logical state.

Index refresh uses the existing asynchronous indexing conventions:

- create and Agent edit schedule a document reindex;
- rename and move refresh metadata;
- delete removes all chunks for that document;
- successful collaborative compaction or durable editor flush schedules a
  debounced reindex through an authenticated server route;
- the admin project reindex endpoint backfills all project documents.

An indexing failure is logged and does not roll back a successful document
mutation. Exact list/read operations remain available while the index is stale
or unavailable.

## Permissions And Security

- The conversation's bound project remains authoritative.
- The server validates all current-document and explicit-document selectors
  against that project.
- Reads use caller-scoped access and existing RLS.
- Viewer roles cannot invoke document write tools.
- Document writes reuse `documentService` and the server-only Agent replacement
  command; model-supplied identity or role is never trusted.
- Markdown/MDX is checked by `validateSanctionedMdx` before creation or content
  replacement.
- Semantic search output is never accepted as a mutation payload or concurrency
  base.
- Tool schemas remain closed with `additionalProperties: false`.

## Error Handling

Tools return specific recoverable outcomes for:

- no target and no current document;
- document not found;
- ambiguous exact name;
- folder qualifier not found or ambiguous;
- cross-project or inaccessible document;
- insufficient role;
- duplicate-name creation preflight;
- missing or repeated content anchor;
- invalid sanctioned MDX;
- stale token, hash, or update tail;
- deleted or renamed target between preview and apply;
- embedding service failure.

No ambiguous or stale condition is converted into a best-effort write. For
concurrency failures, the Agent re-reads the document and regenerates a proposal.
For indexing failures, it reports exact data normally and may explain that
semantic search is temporarily incomplete.

## UI Behavior

- The chat panel remains usable while navigating between documents in the same
  project.
- Existing conversations receive the current document context on every turn.
- The scope badge continues to represent the bound project/folder/table scope;
  document context is shown as a live target hint rather than a lock.
- Confirmation cards display document name, folder, and operation summary.
- Content-edit previews reuse the current document diff UI.
- Successful create, rename, move, edit, and delete operations invalidate the
  sidebar and relevant document queries. Agent edits retain the current Realtime
  reset broadcast so an open editor refreshes immediately.

## Testing

### Unit tests

- resolver priority: explicit ID, explicit name, current document, missing target;
- same-name ambiguity with safe candidate metadata;
- current and explicit cross-project rejection;
- live current-document context on new and existing conversation turns;
- list/read/create/rename/move/delete service delegation and permission errors;
- complete, outline, section, and line-range reads;
- deterministic replace, insert, append, and delete operations;
- missing/repeated anchors and sanctioned MDX rejection;
- token, hash, and update-tail conflict rejection;
- Auto/Confirm behavior and mandatory delete confirmation;
- stable-ID deletion preview and apply revalidation;
- project-document chunking, refresh, cleanup, and backfill;
- index failure does not roll back successful content or metadata writes.

### Database and API tests

- source-type migration accepts `project_document` without changing existing
  source semantics;
- embedding rows retain project access constraints;
- existing conversation requests may provide live document context while their
  bound project remains authoritative;
- viewer writes fail and editor/admin writes follow current project roles;
- admin reindex includes project documents.

### End-to-end tests

- open a document and ask to summarize "this document";
- switch to another document in the same conversation and use the new live
  default;
- while viewing document A, explicitly read or edit document B;
- require selection for duplicate names;
- edit content in Auto mode and observe the open editor refresh;
- rename and move a document through the Agent and observe sidebar updates;
- require confirmation for delete in Auto mode;
- delete the confirmed stable target and remove it from the sidebar and search;
- preserve existing library, folder, conversation-history, and table-scope flows.

## Acceptance Criteria

1. `list_project_structure` and `list_documents` expose all readable project
   document summaries without bodies.
2. "This document" resolves to the verified document currently open on that
   turn, including in an existing conversation.
3. An explicit same-project document overrides the current page default.
4. Duplicate names never cause an inferred write.
5. Reads use the latest logical collaborative state and support bounded access
   for long documents.
6. Agent can create, read, precisely edit, rename, move, and permanently delete
   documents through reused services and state gateways.
7. Ordinary writes follow Auto/Confirm mode; permanent deletion always requires
   approval.
8. Content changes retain sanctioned MDX validation, concurrency guards,
   `pre_agent` backup, and Realtime reset behavior.
9. Semantic search covers living project documents through a separate source
   type, while exact reads remain functional during index failure.
10. Existing table and folder Agent behavior remains unchanged.

## Non-Goals

- recycle bin, soft delete, or document restoration after deletion;
- cross-project document operations;
- per-document ACLs;
- comments, suggestions, or track changes;
- replacing the current Yjs collaboration or version-history architecture;
- a generic abstraction that unifies documents, folders, and libraries;
- arbitrary Markdown/MDX execution outside the sanctioned component policy.
