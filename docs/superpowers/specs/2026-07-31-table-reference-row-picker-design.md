# Table Reference Row Picker Design

**Date:** 2026-07-31
**Status:** Proposed for written-spec review
**Scope:** Document toolbar Insert reference — Table tab UX, multi-row insert, chip label + hover tooltip

## Goal

Make table referencing feel like picking rows from a visible table:

1. The Insert reference Table tab shows each row’s **full cell content** (no column headers).
2. Users **multi-select rows** via checkbox / row click, then Insert once.
3. Inserted chips use a **whole-row text summary** as the label (values only, no field names).
4. **No dark hover Tooltip** on resource reference chips (table **and** document kinds).

Document-tab selection UX is unchanged except for the shared tooltip removal.

## Product Decisions

- Table picker lists rows with all cell values joined for display; **no table header row**.
- Selection is multi-select. Empty selection disables Insert.
- Remove the Display field control from the Table tab. Users select whole rows only.
- One Insert inserts one `ResourceReference` chip per selected row, in the order shown in the filtered list, at the current editor caret (sequential inline inserts, separated by a single space).
- Chip visible label and stored `fallbackLabel` are the row’s cell values joined with ` · ` (middle dot), skipping empty cells. If every cell is empty, use `(empty)`.
- Do **not** include field labels / column headers in the chip label or picker row text.
- Keep existing MDX shape (`kind="table-row"` + `libraryId` + `assetId` + `displayFieldId` + `fallbackLabel`). Auto-set `displayFieldId` to the library’s first field by stable field order for schema compatibility; it is no longer a user choice and must not drive the visible label.
- Live resolve for table-row chips must also show the whole-row joined summary (not the single `displayFieldId` cell), so labels stay consistent after reload.
- Navigation `href` stays row-scoped (`/{projectId}/{libraryId}?asset={assetId}`).
- Remove Ant Design `Tooltip` wrappers from `ResourceReferenceEditor` for available, unavailable, and invalid states. Keep `aria-label` (and context where useful) for accessibility without a visual tooltip.
- Document tab: still single range/block selection; only the chip tooltip behavior changes.
- Agent `insert_resource_reference` remains single-target; this change is toolbar picker UX. Agent may still pass `displayFieldName` / `displayFieldId`, but resolved/visible table labels follow the whole-row rule when rendering in the document editor.

## Non-goals

- Changing Document-tab selection UI or multi-document insert.
- Replacing `displayFieldId` in the sanctioned MDX schema in this change.
- Multi-select across different tables in one Insert.
- Redesigning chip chrome (icon, link color) beyond label text and tooltip removal.
- Export / plain-text serialization format beyond using the updated `fallbackLabel`.

## UX

### Table tab

```
Insert reference
[ Table | Document ]

[ Choose a table ▾ ]          // e.g. pokemon
[ Search rows … ]             // optional filter over joined cell text + row name

☑ Wheat · 10001 · 20001 · 1 · 2
☐ Millet · 10002 · 20002 · 1 · 9
☑ Rice · 10003 · 20003 · 2 · 6
…

[ Cancel ]  [ Insert ]
```

- Clicking the row or checkbox toggles selection.
- Search filters rows; selection is preserved for rows that leave the filtered view.
- Modal width may increase as needed so joined row text remains readable (roughly 720–880px).

### After insert

Inline chips show the joined row summary (or live-resolved equivalent). Hover does not open a dark tooltip for table or document chips.

## Architecture

### Label helper

Add a pure helper (e.g. `joinTableRowDisplayValues(fields, values)`) used by:

- picker row rendering and `fallbackLabel` at confirm time;
- `resolveTableReferences` when building `label`.

Join non-empty `cellDisplayString` values in field order with ` · `.

### Picker state

`ResourceReferencePickerModal` Table tab:

- Replace single `selectedAssetId` + `selectedFieldId` with `selectedAssetIds: string[]` (or `Set`).
- Drop Display field `Select`.
- Replace `ResourceReferenceResultList` for tables with a checkbox row list that renders joined cell content (no headers). Document tab may keep the existing list/preview components.
- Confirm builds `ResourceReferenceTarget[]` and validates each target is still available before insert.

### Confirm / insert path

Extend confirm plumbing so Insert can apply multiple targets:

- `onConfirm: (targets: ResourceReferenceTarget[]) => void` (or overload that accepts one-or-many).
- `confirmResourceReferenceSelection` / controller restore focus once, then apply each target in order (space-separated inserts).
- Replace-mode (`initialTarget`) stays single-target: selecting multiple rows while replacing is out of scope; if replace is open, selection remains single-select **or** Insert replaces with the first selected row only. Prefer **single-select while replacing** to avoid ambiguity.

### Resolve path

In `resolveTableReferences`, after validating library/asset (and that `displayFieldId` still exists on the library for schema sanity), set:

- `label` = whole-row joined summary from all library fields’ values for that asset;
- `contextLabel` may remain `library / asset` (without field) for `aria-label` composition, since tooltips are gone.

If the asset/library is missing, behavior stays `Reference unavailable`.

### Chip render

`ResourceReferenceEditor`: remove `Tooltip` usage. Available chips remain links with `aria-label`; unavailable/invalid remain warning spans with `aria-label` or static accessible text.

## Error handling

- Unchanged load errors for sources/rows.
- Confirm validates every selected table target; if any is unavailable, show the existing unavailable error and do not insert a partial set.
- Replace path: require exactly one selected row.

## Testing

- Unit: joined-row label helper (empty cells, all empty → `(empty)`, field order).
- Unit: picker multi-select + Insert builds one target per row with joined `fallbackLabel` and auto `displayFieldId`.
- Unit: replace mode stays single-select / single target.
- Unit: `ResourceReferenceEditor` markup has no Tooltip title for available table and document chips.
- Unit/resolve: table resolve `label` is whole-row join, not single display field.
- Update existing picker/editor tests that assume Display field UI or hover tooltip titles.
- E2E smoke (if present): Insert reference Table path still inserts chips; skip Display field steps.

## Self-review notes

- No TBD placeholders.
- Compatible with existing MDX attributes while changing visible label semantics.
- Scope is one implementation plan: picker UX + multi-insert + resolve label + tooltip removal.
