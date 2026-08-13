# Script Dialogue And Source Document Synchronization

Date: 2026-08-13
Status: Approved design

## Summary

Synchronize dialogue edits in the Script workspace back to the source document that generated the derived script library. Editing, inserting, deleting, or reordering a dialogue card updates both the derived table rows and the corresponding source-document paragraphs. Action text is synchronized as its own paragraph, while speech is written as `Speaker: dialogue content` using the full-width Chinese colon (`：`) in Chinese content.

The existing `libraries.source_document_id` remains the library-level association. A new persistent row-to-document-block mapping provides the missing per-dialogue association. New generated conversations create these mappings during import. Existing conversations lazily backfill mappings by matching normalized source text in document order before their first synchronized edit.

## Goals

- Synchronize action, speaker, and dialogue changes to their corresponding source-document paragraphs.
- Insert a new dialogue at the matching position between the surrounding source sentences.
- Delete only the source paragraphs associated with the deleted dialogue card.
- Reorder a card's associated action and speech paragraphs when the card is dragged.
- Keep table rows, document state, and mapping records atomic.
- Reject synchronization when the source document or target paragraph has changed concurrently.
- Support existing derived conversations through conservative, order-aware mapping backfill.
- Apply undo and redo to both the table and source document.

## Non-Goals

- Synchronizing ordinary script libraries that have no source document.
- Reconstructing or rewriting the entire source document from the dialogue table.
- Guessing a source location when an existing dialogue cannot be matched uniquely.
- Changing the visual layout of the Script dialogue editor.

## Existing Model And Gap

Derived script libraries already store:

- `libraries.source_document_id`, linking the entire library to its source document;
- `libraries.document_export_type = 'script'`, identifying conversation output;
- action and speech as one or two `library_assets` rows.

The source document stores stable `BlockAnchor` identifiers for top-level headings and paragraphs. However, conversation generation currently strips these anchors before Story IR conversion, and compiled table rows do not persist Story IR source references. The system therefore knows which document produced a library but not which paragraph produced each dialogue row.

## Association Model

Add a mapping table owned by the derived script library. Each record associates one Script asset row with one source-document block and stores the last synchronized representation required for conflict detection.

The mapping records include, at minimum:

- script library ID;
- asset row ID;
- source document ID;
- source block ID;
- semantic role: `action` or `speech`;
- last synchronized normalized source text;
- creation and update timestamps.

The source document ID must match the library's `source_document_id`. Each asset row may have at most one active mapping. Each mapped source block may belong to at most one asset row in a library. Database constraints and the synchronization function validate these relationships.

A dialogue card may therefore have:

- one action-row to action-block mapping;
- one speech-row to speech-block mapping;
- either mapping alone for single-row or partially populated legacy cards.

## New Conversation Generation

Document-derived generation must retain block lineage instead of discarding it before conversion. The import pipeline creates a source representation that preserves each top-level block ID while still presenting clean text to Story conversion. Story IR source offsets are resolved back to the contributing block IDs before table compilation.

When an IR node maps unambiguously to a source paragraph, the created action or speech asset receives a mapping in the same import transaction. A generated node spanning multiple source paragraphs is mapped only when one paragraph is the unique owner of its visible content. Ambiguous lineage remains unmapped and follows the same guarded behavior as legacy data.

Generation must not expose BlockAnchor markup to the model or store the anchor markup as dialogue content.

## Legacy Mapping Backfill

Before the first synchronized mutation of an unmapped existing dialogue, the server attempts a conservative mapping pass for that library.

Matching uses source-document paragraph order and normalized visible text:

- action rows match their normalized action content;
- speech rows match normalized `Speaker：dialogue` content, accepting equivalent ASCII or full-width colon forms during matching;
- already mapped neighboring cards constrain the candidate interval;
- candidates must preserve the Script dialogue order;
- repeated text is accepted only when ordering and neighboring mappings leave one possible source block.

The pass may persist every unambiguous mapping and leave other rows unmapped. Editing a mapped card proceeds normally. Editing an unmapped card fails without changing either side and shows `Unable to determine the original document position. Regenerate the conversation and try again.`

If the document lacks stable block IDs, the server first normalizes the document through the existing block-identity and collaboration-state mechanisms, then retries matching against the normalized version.

## Synchronized Mutations

All normal Script dialogue mutations for document-derived libraries go through one authenticated server operation. The operation loads the library, rows, mappings, and authoritative document state, prepares the next Markdown/Yjs state, and commits all database changes in one transaction.

### Edit Action

Update the action asset row and replace the mapped action paragraph with the new action text. If the action was previously empty and has no mapping, insert a new paragraph immediately before the card's mapped speech paragraph, or after the preceding mapped card when no speech paragraph exists, then persist its block mapping.

### Edit Speaker Or Speech

Update all affected Script rows and replace the mapped speech paragraph with `Speaker：dialogue content`. A speaker change updates both the action and speech table-row speaker fields as today, but changes the document's speech paragraph only; action prose is not automatically rewritten to include the new speaker name.

If speech was previously empty and has no mapping, insert its paragraph after the card's action paragraph, or after the preceding mapped card when no action paragraph exists.

### Insert Dialogue

Creating an empty dialogue card creates its table rows but does not create empty source paragraphs. When the user first saves action or speech content, insert the new paragraph at the card's logical source position:

- after the preceding card's last mapped paragraph;
- otherwise before the following card's first mapped paragraph;
- at the document end only when neither neighbor has a mapping and the position is unambiguous.

When both action and speech are saved, action precedes speech. Each inserted paragraph receives a new stable block ID and mapping.

### Delete Dialogue

Delete the action and speech asset rows, their mapping records, and the mapped source paragraphs. Empty, unmapped rows require no document deletion. The operation rejects the deletion when a mapped paragraph no longer matches its last synchronized content.

### Undo And Redo

History entries retain enough information to invert synchronized mutations, including deleted paragraph content, block placement, and mappings. Undo and redo call the same server synchronization boundary. They do not use the current table-only generic asset mutation path for a document-derived script.

### Reorder

Dragging a dialogue card moves its table rows and its mapped document paragraphs in the same transaction. The card's action and speech paragraphs move as one ordered group, with action before speech. Headings, narration, notes, and any other blocks not mapped to that card are never included in the moved group.

The document operation removes only the dragged card's mapped blocks, then inserts them at the target dialogue boundary:

- dragging before a card inserts the moved group immediately before that card's first mapped block;
- dragging after a card inserts the moved group immediately after that card's last mapped block;
- non-dialogue blocks remain as existing document nodes and are not attached to either neighboring card.

For example, moving dialogue `B` before `A` in `[A, narration, B]` produces `[B, A, narration]`: only `B` moves. The narration node is not moved with `A` or `B`.

Reordering is rejected when the dragged card or target card lacks a unique mapping, when any affected mapped block changed, or when the current table order no longer matches the client's expected order. Mapping block IDs remain stable after a successful move. Undo and redo move the same mapped group back through the synchronized mutation service.

## Atomicity And Concurrency

The server mutation accepts the document state token observed by the client and the expected text for every affected mapped block. It rejects the operation when:

- the document epoch or revision changed;
- the collaboration update tail changed;
- an affected block no longer exists;
- an affected block's normalized text differs from the mapping snapshot;
- the library, row, mapping, and source document relationships are inconsistent;
- the caller lacks editor permission for either resource.

The transaction updates library assets and values, mapping rows, the document Yjs snapshot/Markdown projection, collaboration revision, version backup, and ancestor timestamps together. No client-side sequence may report success after only one side commits.

A rejected conflict leaves both table and document unchanged and displays `The source document changed. Refresh and try again.` The client then invalidates both document and library queries so a refresh loads authoritative state.

## Permissions And Security

- Admins and editors with access to the project may synchronize derived conversations.
- Viewers remain read-only and cannot invoke mutation functions.
- The server derives project, document, and library relationships from stored records rather than trusting client IDs.
- The database function validates that mapped rows belong to the library and mapped blocks belong to its source document.
- The function uses an explicit search path, authenticated actor identity, restricted execute grants, and the existing document version/audit behavior.

## Client Integration

`useScriptDialogueEditor` selects the synchronized mutation service when the loaded library has both `source_document_id` and `document_export_type = 'script'`. Ordinary libraries retain existing generic table mutations.

Successful responses return updated asset rows, mappings, and the new document token. React Query updates the dialogue cache immediately and invalidates source-document state in the background. A conflict or mapping failure does not update the optimistic cache and keeps the dialogue draft available for retry or copying.

The action and speech inputs may still save separately. Each save is independently atomic. If saving action succeeds and saving speech later conflicts, the action remains a valid completed mutation while the unsaved speech draft stays visible.

## Error Handling

- Concurrent document edit: reject, refresh both resources, and retain the unsaved dialogue draft.
- Missing or ambiguous legacy mapping: reject only that card and recommend regeneration.
- Invalid mapping integrity: reject and log a structured server error without exposing internal IDs.
- Permission loss: return forbidden and refresh workspace membership.
- Transaction failure: roll back all table, mapping, and document writes.
- Post-success cache reconciliation failure: keep the committed result visible and allow normal query retry.

## Testing

Unit tests cover:

- source block lineage preservation during new conversation generation;
- mapping creation for action and speech rows;
- legacy exact matching, colon normalization, ordered matching, repeated text, partial success, and ambiguity rejection;
- action, speaker, and speech edits and their serialized document text;
- insertion between two mapped sentences and at one-sided boundaries;
- reorder before and after mapped cards while leaving intervening non-dialogue blocks out of the moved group;
- reorder rejection for unmapped cards, stale table order, and changed document blocks;
- empty inserted rows producing no empty document paragraphs;
- deletion of action-only, speech-only, and combined cards;
- undo and redo restoring both resources;
- client cache updates and retained drafts after conflicts.

Database and service tests cover:

- mapping constraints and cross-project/cross-document rejection;
- admin/editor authorization and viewer rejection;
- optimistic document token and expected-block checks;
- atomic rollback after failures at each write stage;
- document version backup and collaboration revision updates;
- concurrent edits producing one winner and one conflict.

End-to-end tests cover generating a conversation, editing action and speech, changing speaker, inserting between two source sentences, deleting the card, opening the source document, and observing the synchronized content. A second-browser test changes the source document before a Script save and verifies that neither the table nor document is overwritten.

## Acceptance Criteria

- Editing action text updates only the associated action paragraph.
- Editing a speaker or dialogue updates the associated paragraph as `Speaker：dialogue content`.
- Adding a dialogue between two cards inserts its paragraphs between the corresponding source sentences.
- Deleting a dialogue removes only its associated action and speech paragraphs.
- Dragging a dialogue moves only its associated action and speech paragraphs to the corresponding source-document position.
- Dragging never moves unrelated headings, narration, notes, or other non-dialogue blocks with the card.
- Table rows, mappings, and document changes commit atomically.
- Concurrent source edits stop synchronization and are never overwritten.
- New generated conversations persist per-row source mappings.
- Existing conversations backfill all uniquely matchable mappings and block ambiguous edits.
- Undo and redo keep the table and source document consistent.
- Ordinary unassociated script tables continue to behave as before.
