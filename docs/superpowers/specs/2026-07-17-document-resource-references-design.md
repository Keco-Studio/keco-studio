# Document Resource References Design

**Date:** 2026-07-17
**Status:** Proposed for written-spec review
**Scope:** Current-project table-row and document-block references inside document content

## Goal

Allow an editable project document to insert compact inline references to:

- a specific table row, with one field chosen as its display value; or
- a specific heading or paragraph in another document.

References remain attached to stable resource identifiers, display current source
content, and navigate to the referenced row or document block. A source that is
deleted or no longer readable leaves a visible unavailable reference in the
document instead of silently removing content.

## Product Decisions

- References are inserted in the document body, not in a separate document-level
  relationship panel.
- Version one only references resources in the current project.
- A table reference targets a row and records which field supplies the displayed
  value. It does not target an entire table or an arbitrary cell range.
- A document reference targets a heading or paragraph block, not an arbitrary text
  range.
- References render as compact inline labels that can sit within a paragraph.
- Display text is live. Renames and source edits refresh the label. Stored fallback
  text is used only while loading and for export fallback, not as the authoritative
  current value.
- Deleted, hidden, or otherwise unreadable targets render as `Reference unavailable`.
- Reverse-reference browsing and cross-project references are out of scope.

## Architecture

### Content-owned reference node

Add a sanctioned inline MDX node named `ResourceReference`. It is part of the
document's authoritative Yjs content and therefore participates in the existing
collaboration, versioning, import/export, and Agent mutation boundaries.

The semantic target is a discriminated union:

```ts
type TableRowReferenceTarget = {
  kind: 'table-row';
  libraryId: string;
  assetId: string;
  displayFieldId: string;
  fallbackLabel: string;
};

type DocumentBlockReferenceTarget = {
  kind: 'document-block';
  documentId: string;
  blockId: string;
  blockType: 'heading' | 'paragraph';
  fallbackLabel: string;
};

type ResourceReferenceTarget =
  | TableRowReferenceTarget
  | DocumentBlockReferenceTarget;
```

The serialized node contains only the fixed string properties applicable to its
kind. It does not contain executable expressions, caller-supplied navigation URLs,
event handlers, or arbitrary JSX properties. Navigation URLs are derived from
validated identifiers by application code.

No separate reference-relationship table is introduced. Keeping the reference in
the document avoids a dual-write problem between collaborative Yjs updates and a
second relational record. Reverse-reference indexing may be derived later if a
product use case requires it.

### Stable document block identity

Every referencable heading and paragraph has a stable UUID `blockId` stored as
editor-node metadata in the Yjs state and preserved in the Markdown/MDX snapshot
through a sanctioned, non-editable anchor representation.

Block identity follows these rules:

- Editing text or moving a whole block preserves its ID.
- A newly created block receives a new ID.
- Splitting a block keeps the original ID on the leading block and creates a new ID
  for the trailing block.
- Merging blocks keeps the destination block's ID; references to a removed source
  block become unavailable.
- Deleting a block removes its ID and makes references to it unavailable.
- Copying a block creates new IDs in the copy to prevent two targets sharing one ID.

The shared document codec owns normalization. It adds missing IDs, rejects duplicate
or malformed IDs, and is used by editor initialization, imports, Agent replacements,
version restore, compaction, and headless conversion. Existing documents receive
IDs when they pass through this codec before becoming selectable as a reference
source. This is a schema normalization, not a user-visible content edit.

### Batch resolver

Add one project-scoped batch resolver that accepts deduplicated semantic targets
collected from the open document and returns:

```ts
type ResolvedResourceReference = {
  key: string;
  status: 'available' | 'unavailable';
  label: string;
  contextLabel?: string;
  href?: string;
};
```

For table targets, the resolver verifies that the library, row, and display field
belong together and belong to the current project. The label is the selected field's
current display value. The context identifies the table and row so identical values
remain understandable.

For document targets, the resolver reads the latest authoritative document state,
finds the `blockId`, and returns the current heading text or a concise single-line
paragraph excerpt. The context identifies the document and, for paragraphs nested
under a heading, its nearest heading when available.

All reads use the caller-scoped Supabase client and existing project RLS. Missing,
cross-project, mismatched, or unreadable data produces the same `unavailable` result
without disclosing which security condition occurred.

The client deduplicates references and resolves them in one request. Existing
project document broadcasts and table data invalidation refresh the relevant query
cache so visible labels update without editing the referencing document.

## User Experience

### Insertion

The document toolbar adds one icon button named `Insert reference`. It opens a
modal with `Table` and `Document` tabs.

The Table tab reuses the established table reference interaction and data rules:

1. Select a table from the current project.
2. Select one row.
3. Select the display field.
4. Confirm to insert one inline reference at the current editor selection.

Rows can be searched using their available display values. Empty rows remain
selectable only when they have a valid row identity; the preview clearly shows the
chosen field is empty. The current document editor selection is retained while the
modal is open.

The Document tab follows this flow:

1. Select another document in the current project. The open document itself is
   excluded to avoid immediate self-reference cycles in version one.
2. Search or browse its headings and paragraph excerpts.
3. Select one block and confirm insertion.

The picker loads current authoritative content and normalizes legacy block IDs
through the document state boundary before returning selectable blocks. It does not
query stale sidebar content snapshots.

### Inline rendering

An available reference renders as a stable-size inline label with a table or
document icon, a concise primary label, and a tooltip with its full context.

- Table example: `Character table / Ada / Status: Active`
- Document example: `World outline / Conflict / The city closes its gates...`

Long text is truncated visually without changing the stored or accessible label.
The label uses an actual internal link so standard browser behaviors such as opening
in a new tab remain available. Activating it in the current tab uses Next.js client
navigation.

An unavailable target renders in place with a warning icon and the text
`Reference unavailable`. Its tooltip explains that the source was deleted or is no
longer accessible. It is not clickable and is not automatically removed.

Editors can select a reference node and either replace its target through the same
picker or remove it with normal Backspace/Delete behavior. Viewers see and can
navigate references but cannot modify them.

### Navigation

A table reference navigates to the existing asset-detail route for its library and
row. The destination includes the selected display field as navigation state so the
field can be focused or highlighted when that route supports it; the reference does
not require a new table page.

A document reference navigates to the target document with its `blockId` fragment.
After the collaborative editor is hydrated, it resolves the block, scrolls it into
view, and applies a temporary highlight. A missing block leaves the document open
and shows a non-blocking `Referenced content is unavailable` message.

## Content Lifecycle

### Collaboration and persistence

Insertion, replacement, and deletion of references are normal editor operations.
They travel through the existing Lexical/Yjs binding and durable update tail; no
side-channel write is performed. Two collaborators inserting references merge with
the same semantics as other inline nodes.

Reference rendering never mutates document content merely because a source label
changed. Current labels come from the resolver, while stable IDs remain in the
content.

### Rename, edit, move, and delete behavior

- Renaming a table or document changes the resolved context label.
- Editing the selected table field changes the reference's primary label.
- Editing or moving a referenced document block changes its label or location while
  preserving the reference.
- Moving a table or document within the same project does not affect the reference.
- Deleting the selected table field, row, table, document, or document block makes
  the reference unavailable.
- Recreating a resource with the same name does not reconnect the reference because
  identifiers are not reused.
- Project permission loss produces the same unavailable state as deletion.

### Import, export, versions, and Agent operations

DOCX and PDF export resolve available references at export time and emit readable
text plus an internal-resource annotation; they never emit raw MDX properties.
Unavailable references export as `[Reference unavailable]`.

Markdown/MDX export retains the sanctioned `ResourceReference` representation so a
round trip within Keco Studio preserves semantic targets. Import validates IDs and
does not allow a file to create a cross-project reference; unresolved imported
references remain unavailable until explicitly replaced.

Document versions store exact reference nodes and block IDs. Restoring a version
restores those identities. References from other documents to blocks absent after a
restore become unavailable; they are not silently retargeted by text similarity.

Agent reads receive resolved, human-readable reference text together with stable
target metadata. Agent edits must preserve existing block IDs for blocks they retain
and must create fresh IDs for genuinely new blocks. The shared codec enforces this
instead of relying on prompt instructions alone.

## Error Handling and Security

- The picker disables confirmation until all required identifiers are selected.
- A target deleted between selection and insertion is inserted only if the resolver
  can still validate it; otherwise the modal stays open with an unavailable error.
- Resolver failures show fallback labels temporarily only for transient network
  errors. Confirmed missing or unauthorized targets show `Reference unavailable`.
- The same-project constraint is checked both when selecting/inserting and whenever
  resolving. Client-provided project IDs are not trusted.
- Resolver responses do not distinguish missing from forbidden resources.
- Sanctioned MDX validation rejects unknown kinds, unknown properties, malformed
  UUIDs, expressions, raw URLs, duplicate block IDs, and executable JSX.
- Viewer and non-member mutation restrictions continue to be enforced by the
  existing document collaboration and RLS boundaries.

## Testing

### Unit tests

- Parse, serialize, validate, and round-trip both reference kinds through Markdown,
  headless Lexical, and Yjs state.
- Reject malformed IDs, unknown properties, expressions, unsafe URLs, duplicate
  block IDs, and cross-project targets.
- Verify block IDs across edit, move, split, merge, copy, delete, import, Agent
  replacement, compaction, and version restore operations.
- Resolve table labels from the chosen field and document labels from the chosen
  block, including empty values and localized text.
- Deduplicate batch requests and map unavailable targets without leaking cause.
- Export available and unavailable references to DOCX, PDF, and Markdown/MDX.

### Database and service tests

- Owner, admin, editor, viewer, and outsider resolution behavior follows project
  membership and RLS.
- Cross-project IDs and mismatched library/row/field tuples are unavailable.
- Source deletion and permission loss do not mutate the referencing document.

### Browser tests

- Insert a table-row reference, reload, edit the source field, observe the latest
  label, and navigate to the correct row.
- Insert heading and paragraph references, edit and move each block, reload, and
  navigate to the highlighted target.
- Delete each supported source target and verify the in-place unavailable state.
- Verify reference insertion and normal text editing merge between two editors.
- Verify a viewer can open references but sees no insertion or replacement controls.
- Verify keyboard insertion/removal, focus restoration after the picker, tooltip
  labels, truncation, and accessible names.

## Rollout and Compatibility

The content schema change is backward compatible: documents without references
remain valid, and missing block IDs are normalized through the shared codec. The
feature should land behind no permanent product flag, but implementation can use a
development flag until codec, collaboration, export, and browser acceptance tests
pass together.

The implementation must preserve existing document collaboration, version history,
import/export, Agent editing, and ordinary external-link behavior.

## Non-Goals

- Cross-project references.
- Referencing an entire table, arbitrary cell range, or arbitrary text selection.
- Multiple targets in one reference node; users may insert multiple references.
- Backlinks or a document-level reference summary.
- Transclusion or embedding the full source content.
- Cascading deletion of references.
- Automatic fuzzy retargeting after a block is deleted or replaced.
