# Document Text Range References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select an arbitrary cross-paragraph range in the document reference picker and insert a live-updating inline reference.

**Architecture:** Add a backward-compatible `document-range` target containing stable boundary block IDs, UTF-16 offsets, and short boundary contexts. Convert modal DOM selections into targets, then resolve them against the latest ordered document blocks with deterministic contextual re-anchoring.

**Tech Stack:** Next.js 16, React 19, TypeScript, MDXEditor/Lexical, Supabase, Jest, Playwright.

---

## File Map

- `src/lib/documents/documentRangeReference.ts`: pure boundary capture and live range resolution helpers.
- `src/lib/documents/resourceReferenceTypes.ts`: `document-range` schema, attributes, validation, and keys.
- `src/lib/documents/documentBlockIdentity.ts`: ordered preview block data.
- `src/lib/documents/resourceReferenceService.ts`: live range resolution and picker source loading.
- `src/components/documents/DocumentReferencePreview.tsx`: read-only preview and browser selection capture.
- `src/components/documents/ResourceReferencePickerModal.tsx`: document-range picker state and confirmation.
- Unit and Playwright tests cover schema, range algorithms, picker behavior, persistence, refresh, and navigation.

### Task 1: Define And Resolve Range Boundaries

**Files:**
- Create: `src/lib/documents/documentRangeReference.ts`
- Test: `tests/unit/documents/document-range-reference.test.ts`

- [ ] Write failing tests for same-block and cross-block extraction, backward selection normalization, edits before/inside the selection, inserted intermediate blocks, deleted boundary blocks, and ambiguous contexts.
- [ ] Run `npm run test:unit -- tests/unit/documents/document-range-reference.test.ts --runInBand` and confirm failure because the helper does not exist.
- [ ] Implement pure helpers that normalize whitespace, capture bounded before/after contexts, locate a boundary by exact context nearest its previous offset, and extract the current ordered range.
- [ ] Re-run the focused test and confirm all cases pass.

### Task 2: Extend The Sanctioned Reference Schema

**Files:**
- Modify: `src/lib/documents/resourceReferenceTypes.ts`
- Modify: `src/lib/documents/sanctionedMdxDescriptors.tsx`
- Modify: `src/lib/documents/sanctionedMdx.test.ts`

- [ ] Add failing round-trip and rejection tests for exact `document-range` properties, UUIDs, non-negative integer offsets, bounded contexts, and distinct keys for distinct ranges.
- [ ] Run `npm run test:unit -- src/lib/documents/sanctionedMdx.test.ts --runInBand` and confirm the new target is rejected.
- [ ] Add `DocumentRangeReferenceTarget`, exact parsing/serialization, key generation, and descriptor properties while leaving existing kinds unchanged.
- [ ] Re-run the focused schema tests and confirm they pass.

### Task 3: Resolve Live Range Labels

**Files:**
- Modify: `src/lib/documents/resourceReferenceService.ts`
- Modify: `src/components/documents/ResourceReferenceEditor.tsx`
- Test: `tests/unit/documents/resource-reference-service.test.ts`
- Test: `tests/unit/documents/resource-reference-editor.test.tsx`

- [ ] Add failing service tests for current range labels, context labels, start-block navigation, source edits, and unavailable boundaries.
- [ ] Run the focused service/editor tests and confirm failure for the unsupported kind.
- [ ] Reuse one source-document read per document, resolve block and range targets from the same ordered block list, and render the document icon for both document kinds.
- [ ] Re-run focused tests and confirm backward compatibility and live range cases pass.

### Task 4: Add Full-Document Preview Selection

**Files:**
- Create: `src/components/documents/DocumentReferencePreview.tsx`
- Modify: `src/components/documents/ResourceReferencePickerModal.tsx`
- Modify: `src/components/documents/ResourceReferencePickerModal.module.css`
- Test: `tests/unit/documents/resource-reference-picker.test.tsx`

- [ ] Add failing picker tests that render ordered blocks, capture a cross-block DOM selection, normalize backward selection, clear selection on document change, and enable confirmation only for nonblank preview selections.
- [ ] Run `npm run test:unit -- tests/unit/documents/resource-reference-picker.test.tsx --runInBand` and confirm failure because the preview interaction is absent.
- [ ] Implement the read-only preview with block data attributes and `selectionchange`/pointer completion handling; replace document block radio selection with the captured `document-range` target.
- [ ] Re-run picker tests and confirm table references and existing loading/error behavior still pass.

### Task 5: Verify Persistence, Refresh, And Navigation

**Files:**
- Modify: `tests/e2e/specs/document-references.spec.ts`

- [ ] Add a browser test that selects from the middle of one paragraph through the middle of another, inserts the reference, verifies durable MDX range attributes, edits source text inside the range, waits for the label to refresh, and checks navigation to the starting block.
- [ ] Run focused unit tests, `npm run typecheck`, and the document reference Playwright spec when its Supabase environment is available.
- [ ] Inspect the final diff to ensure unrelated dirty-worktree changes are untouched.

