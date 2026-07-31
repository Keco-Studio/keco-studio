# Document Text Range References Design

**Date:** 2026-07-28
**Status:** Approved
**Scope:** Arbitrary cross-paragraph text ranges in document-to-document references

## Goal

Allow a user to choose another document in the existing `Insert reference` modal,
drag-select any text in a read-only preview, and insert the selection as the
existing compact inline reference. A selection may start and end in the middle of
different paragraphs. Its displayed text follows later source edits.

## Product Decisions

- The selection happens inside a full-document preview in the modal.
- A selection may span headings and paragraphs.
- The inserted reference remains a single inline link. Newlines and repeated
  whitespace resolve to one space.
- Existing `document-block` references remain valid without migration.
- Clicking a range reference opens the source document at its starting block and
  uses the existing whole-block destination highlight.
- Precise character-level destination highlighting is out of scope.

## Reference Model

Add a `document-range` target alongside `table-row` and `document-block`:

```ts
type DocumentRangeReferenceTarget = {
  kind: 'document-range';
  documentId: string;
  startBlockId: string;
  startOffset: number;
  startBefore: string;
  startAfter: string;
  endBlockId: string;
  endOffset: number;
  endBefore: string;
  endAfter: string;
  fallbackLabel: string;
};
```

Offsets use JavaScript UTF-16 string offsets because DOM `Range` and Lexical text
positions use the same convention. Boundary context stores short normalized text
immediately before and after each boundary. It is data, not executable content.

The resource key includes the document ID, boundary block IDs, offsets, and
boundary context so distinct ranges in the same blocks do not collide in the
provider cache.

## Picker Interaction

After selecting a source document, the modal loads all referencable blocks in
document order and renders them as selectable read-only text. Each DOM block has
its source block ID and type. Browser selection is accepted only when both
boundaries are inside the preview and at least one non-whitespace character is
selected.

The picker canonicalizes backward selections into source order, calculates block
relative offsets, captures boundary context, and previews the normalized inline
label. Changing document or search state clears the captured range. Confirmation
is disabled until a valid range exists and the latest source state validates it.

The previous block-list selection UI is replaced for new document references.
Existing `document-block` targets can still be parsed and resolved, but the picker
creates `document-range` targets.

## Live Resolution

The resolver reads the latest authoritative source document and obtains ordered
block text. It locates both block IDs, then re-anchors each boundary inside its
original block:

1. Find positions whose preceding and following context match.
2. When several positions match, choose the one nearest the stored offset.
3. If no contextual match exists, use the stored offset only when its adjacent
   context is still consistent.
4. If a boundary cannot be located unambiguously, mark the reference unavailable.

The resolved label contains the current text from the start boundary through the
end boundary, including all current blocks between them. Insertions or deletions
before a boundary shift it through contextual re-anchoring. Edits inside the range
appear in the resolved label. Blocks inserted or deleted between the surviving
boundary blocks are included or removed automatically.

If a boundary block is deleted, the block order reverses, or boundary content is
rewritten beyond recognition, the reference becomes `Reference unavailable`
instead of guessing at another passage.

## Compatibility And Security

- `document-block` parsing, keys, resolution, rendering, and navigation remain
  unchanged.
- Sanctioned MDX validation requires the exact property set for
  `document-range`, UUID block/document IDs, non-negative integer offsets,
  bounded context strings, and a nonblank fallback label.
- Resolution remains project-scoped and caller-scoped through existing Supabase
  RLS. Missing, cross-project, and unauthorized sources use the same unavailable
  result.
- Range selection and reference insertion do not mutate the source document.

## Testing

- Unit-test range attribute round trips, exact-property validation, stable keys,
  and malformed offsets/context rejection.
- Unit-test forward and backward DOM selections across blocks and label
  normalization.
- Unit-test re-anchoring after edits before, inside, and between boundaries, plus
  ambiguous/deleted boundary failures.
- Extend resolver tests for current live labels and unavailable ranges.
- Extend picker tests for preview selection and confirmation state.
- Extend Playwright coverage to select text across two paragraphs, persist the
  range reference, edit the source, observe the updated label, and navigate to
  the starting block.

