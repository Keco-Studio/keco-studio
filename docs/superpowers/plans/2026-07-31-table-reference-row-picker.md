# Table Reference Row Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show whole-row table content in Insert reference (multi-select, no headers), insert one chip per selected row with a joined-values label, and remove hover tooltips from all resource reference chips.

**Architecture:** Add a pure `joinTableRowDisplayValues` helper shared by the picker and live resolver. Change the Table tab to a checkbox multi-select list of joined cell text (no Display field). Extend confirm/insert to apply an ordered `ResourceReferenceTarget[]` with spaces between chips. Resolve table labels from all library fields for the asset. Strip Ant Design `Tooltip` from `ResourceReferenceEditor`.

**Tech Stack:** Next.js, React, TypeScript, Ant Design, MDXEditor/Lexical, Supabase, Jest, Playwright.

## Global Constraints

- Chip / picker row text joins non-empty cell values with ` · `; never include field labels or table headers.
- All-empty row → `(empty)`.
- Keep MDX `displayFieldId` (auto first field by `orderIndex` then `id`); it must not drive the visible label.
- Replace mode (`initialTarget`) stays single-select.
- Document tab selection UX unchanged except shared tooltip removal.
- Agent `insert_resource_reference` stays single-target; editor resolve labels follow whole-row rules for table chips.

---

## File Map

- Create: `src/lib/documents/tableRowDisplayLabel.ts` — join helper
- Create: `src/components/documents/ResourceReferenceTableRowList.tsx` — checkbox multi-select row list
- Modify: `src/lib/documents/resourceReferenceService.ts` — whole-row resolve + fetch all fields/values
- Modify: `src/components/documents/ResourceReferenceEditor.tsx` — remove Tooltip
- Modify: `src/components/documents/ResourceReferencePickerModal.tsx` — multi-select table UX
- Modify: `src/components/documents/ResourceReferencePickerModal.module.css` — wider modal, checkbox rows
- Modify: `src/components/documents/resourceReferencePickerConfirm.ts` — multi-target confirm
- Modify: `src/components/documents/useResourceReferencePickerController.ts` — multi-target API
- Modify: `src/components/documents/ResourceReferenceInsertButton.tsx` — insert many chips + spaces
- Modify: `src/components/documents/MdxDocumentEditor.tsx` — only if prop wiring needs adjustment
- Test: `tests/unit/documents/table-row-display-label.test.ts`
- Test: `tests/unit/documents/resource-reference-service.test.ts`
- Test: `tests/unit/documents/resource-reference-editor.test.tsx`
- Test: `tests/unit/documents/resource-reference-picker.test.tsx`
- Test: `tests/unit/documents/resource-reference-insert-focus.test.ts`
- Test: `tests/e2e/specs/document-references.spec.ts`

---

### Task 1: Whole-Row Display Label Helper

**Files:**
- Create: `src/lib/documents/tableRowDisplayLabel.ts`
- Test: `tests/unit/documents/table-row-display-label.test.ts`

**Interfaces:**
- Produces: `joinTableRowDisplayValues(fields: readonly { id: string }[], values: Record<string, unknown>): string`

- [ ] **Step 1: Write the failing test**

```ts
import { joinTableRowDisplayValues } from '@/lib/documents/tableRowDisplayLabel';

const fields = [
  { id: 'f1' },
  { id: 'f2' },
  { id: 'f3' },
];

describe('joinTableRowDisplayValues', () => {
  it('joins non-empty cell values in field order with a middle dot', () => {
    expect(joinTableRowDisplayValues(fields, {
      f1: '小麦',
      f2: 10001,
      f3: '',
    })).toBe('小麦 · 10001');
  });

  it('returns (empty) when every cell is blank', () => {
    expect(joinTableRowDisplayValues(fields, { f1: '  ', f2: null })).toBe('(empty)');
  });

  it('does not include field ids or labels', () => {
    const label = joinTableRowDisplayValues([{ id: 'status' }], { status: 'Active' });
    expect(label).toBe('Active');
    expect(label).not.toContain('status');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/documents/table-row-display-label.test.ts --runInBand`

Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
import { cellDisplayString } from '@/lib/utils/assetEmptiness';

export function joinTableRowDisplayValues(
  fields: readonly { id: string }[],
  values: Record<string, unknown>
): string {
  const parts = fields
    .map((field) => cellDisplayString(values[field.id]))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : '(empty)';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/documents/table-row-display-label.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/tableRowDisplayLabel.ts tests/unit/documents/table-row-display-label.test.ts
git commit -m "$(cat <<'EOF'
feat(documents): add whole-row table reference display label helper

EOF
)"
```

---

### Task 2: Resolve Table Chips With Whole-Row Labels

**Files:**
- Modify: `src/lib/documents/resourceReferenceService.ts` (`fetchRequestedValues`, `resolveTableReferences`)
- Modify: `tests/unit/documents/resource-reference-service.test.ts`

**Interfaces:**
- Consumes: `joinTableRowDisplayValues`
- Produces: resolved table `label` = whole-row join; `contextLabel` = `` `${library.name} / ${asset.name}` `` (no field)

- [ ] **Step 1: Update failing expectations in service tests**

In `batch-resolves and deduplicates a current-project table target` and related table cases:

1. Seed **all** library fields that should appear in the join (ordered by `order_index`), plus their values.
2. Expect `label` to be the joined whole-row string (e.g. if only Status=`Active` → still `Active`; if Name=`Ada Lovelace` + Status=`Active` → `Ada Lovelace · Active`).
3. Expect `contextLabel` without the field segment: `Characters / Ada`.
4. Keep unavailable / wrong-project cases unchanged.

Also update the empty-value case: with one empty display field and no other values → `label: '(empty)'`, `contextLabel: 'Characters / Ada'`.

Add an explicit case:

```ts
it('labels table references with all field values in order, not only displayFieldId', async () => {
  const target = tableTarget(); // displayFieldId = FIELD_ID (Status)
  const { client } = makeClient({
    libraries: [{ id: LIBRARY_ID, project_id: PROJECT_ID, name: 'Characters' }],
    library_assets: [{ id: ASSET_ID, library_id: LIBRARY_ID, name: 'Ada' }],
    library_field_definitions: [
      { id: OTHER_FIELD_ID, library_id: LIBRARY_ID, label: 'Name', order_index: 1 },
      { id: FIELD_ID, library_id: LIBRARY_ID, label: 'Status', order_index: 2 },
    ],
    library_asset_values: [
      { asset_id: ASSET_ID, field_id: OTHER_FIELD_ID, value_json: 'Ada Lovelace' },
      { asset_id: ASSET_ID, field_id: FIELD_ID, value_json: 'Active' },
    ],
  });

  const resolved = await resolveResourceReferences(client, PROJECT_ID, [target]);

  expect(resolved.get(resourceReferenceKey(target))).toMatchObject({
    status: 'available',
    label: 'Ada Lovelace · Active',
    contextLabel: 'Characters / Ada',
  });
});
```

- [ ] **Step 2: Run focused service tests and confirm failures**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-service.test.ts --runInBand`

Expected: FAIL on updated label / contextLabel assertions

- [ ] **Step 3: Implement resolve changes**

In `resourceReferenceService.ts`:

1. Replace `fetchRequestedValues` with fetching **all** values for the target asset IDs:

```ts
async function fetchAssetValues(
  client: SupabaseClient,
  assetIds: readonly string[]
): Promise<ValueRow[]> {
  if (assetIds.length === 0) return [];
  return fetchPagedBatches<ValueRow>(assetIds, (batch, from, to) =>
    client
      .from('library_asset_values')
      .select('asset_id, field_id, value_json')
      .in('asset_id', batch)
      .order('asset_id', { ascending: true })
      .order('field_id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<PagedResult<ValueRow>>
  );
}
```

2. In `resolveTableReferences`, load **all** fields for the target libraries (`.in('library_id', libraryIds)`), not only `displayFieldId`s. Sort each library’s fields by `order_index` then `id`.

3. Still require `displayFieldId` to exist on the same library (schema sanity). If missing → leave unresolved (unavailable).

4. Build label:

```ts
const libraryFields = orderedFieldsByLibrary.get(library.id) ?? [];
const rowValues: Record<string, unknown> = {};
for (const field of libraryFields) {
  rowValues[field.id] = values.get(`${asset.id}:${field.id}`);
}
const label = joinTableRowDisplayValues(libraryFields, rowValues);
```

5. Set `contextLabel: \`${library.name} / ${asset.name}\``.

- [ ] **Step 4: Re-run service tests**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-service.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/documents/resourceReferenceService.ts tests/unit/documents/resource-reference-service.test.ts
git commit -m "$(cat <<'EOF'
feat(documents): resolve table reference chips from whole-row values

EOF
)"
```

---

### Task 3: Remove Reference Chip Hover Tooltips

**Files:**
- Modify: `src/components/documents/ResourceReferenceEditor.tsx`
- Modify: `tests/unit/documents/resource-reference-editor.test.tsx`

**Interfaces:**
- Consumes: unchanged `useResourceReference` / resolved labels
- Produces: markup without `Tooltip` / `data-tooltip`

- [ ] **Step 1: Change editor tests to forbid tooltips**

In the available `$kind` case, replace:

```ts
expect(markup).toContain(`data-tooltip="${accessibleLabel}"`);
```

with:

```ts
expect(markup).not.toContain('data-tooltip=');
expect(markup).toContain(`aria-label="${accessibleLabel}"`);
```

Also assert unavailable and invalid markups have no `data-tooltip=`.

Keep visible label as `resolved.label` / fallback only (not the accessible compound string).

- [ ] **Step 2: Run editor tests — expect FAIL**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-editor.test.tsx --runInBand`

Expected: FAIL because Tooltip still wraps chips

- [ ] **Step 3: Remove Tooltip wrappers**

In `ResourceReferenceEditor.tsx`:

- Delete `Tooltip` import and all `<Tooltip title={...}>` wrappers.
- Keep the same inner `Link` / `span` nodes, including `aria-label={accessibleLabel}` for available chips.
- For unavailable / invalid, keep warning UI; optional `aria-label` with the previous tooltip strings is fine, but no visual tooltip.

- [ ] **Step 4: Re-run editor tests**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-editor.test.tsx --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/documents/ResourceReferenceEditor.tsx tests/unit/documents/resource-reference-editor.test.tsx
git commit -m "$(cat <<'EOF'
fix(documents): remove hover tooltips from resource reference chips

EOF
)"
```

---

### Task 4: Multi-Target Confirm And Insert

**Files:**
- Modify: `src/components/documents/resourceReferencePickerConfirm.ts`
- Modify: `src/components/documents/useResourceReferencePickerController.ts`
- Modify: `src/components/documents/ResourceReferenceInsertButton.tsx`
- Modify: `tests/unit/documents/resource-reference-insert-focus.test.ts`
- Modify: `tests/unit/documents/resource-reference-picker.test.tsx` (controller/insert sections only if signatures break)

**Interfaces:**
- Produces:
  - `PendingReference.apply: (targets: ResourceReferenceTarget[]) => void`
  - `confirmResourceReferenceSelection(pending, targets, restoreFocus)`
  - `ResourceReferencePickerController.confirm: (targets: ResourceReferenceTarget[]) => void`
  - Insert button `onOpen: (apply: (targets: ResourceReferenceTarget[]) => void) => void`

- [ ] **Step 1: Write failing multi-insert focus tests**

Update `resource-reference-insert-focus.test.ts`:

```ts
confirmResourceReferenceSelection(
  { apply },
  [TABLE_TARGET],
  restoreFocus
);
expect(apply).toHaveBeenCalledWith([TABLE_TARGET]);
```

Add:

```ts
it('applies multiple targets after a single focus restore', () => {
  const order: string[] = [];
  const apply = jest.fn(() => order.push('apply'));
  const restoreFocus: RestoreEditorFocus = (after) => {
    order.push('focus');
    after?.();
  };
  confirmResourceReferenceSelection(
    { apply },
    [TABLE_TARGET, { ...TABLE_TARGET, assetId: '33333333-3333-4333-8333-333333333333', fallbackLabel: 'Byron' }],
    restoreFocus
  );
  expect(order).toEqual(['focus', 'apply']);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][0]).toHaveLength(2);
});
```

Update the InsertButton source assertion to require restoring selection once, then looping `insertJsx` for each target with a space between (see Step 3).

- [ ] **Step 2: Run insert-focus tests — expect FAIL**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-insert-focus.test.ts --runInBand`

Expected: FAIL on new signatures / missing multi apply

- [ ] **Step 3: Implement confirm + insert button**

`resourceReferencePickerConfirm.ts`:

```ts
export function confirmResourceReferenceSelection(
  pending: PendingReference | null,
  targets: ResourceReferenceTarget[],
  restoreFocus: RestoreEditorFocus
): PendingReference | null {
  if (!pending || targets.length === 0) return null;
  const { apply } = pending;
  restoreFocus(() => apply(targets));
  return null;
}
```

`useResourceReferencePickerController.ts`: mirror `confirm(targets: ResourceReferenceTarget[])`.

`ResourceReferenceInsertButton.tsx`:

```ts
onOpen((targets) => {
  restoreRangeSelection(activeEditor, selection);
  targets.forEach((target, index) => {
    if (index > 0) {
      activeEditor?.update(() => {
        const current = $getSelection();
        if ($isRangeSelection(current)) current.insertText(' ');
      });
    }
    insertJsx({
      kind: 'text',
      name: 'ResourceReference',
      props: resourceReferenceAttributes(target),
    });
  });
});
```

Import `$getSelection` / `$isRangeSelection` from `lexical`. If `activeEditor` is null, still call `insertJsx` for the first target only when length===1; for multi, no-op safely when editor missing.

- [ ] **Step 4: Re-run insert-focus tests**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-insert-focus.test.ts --runInBand`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/documents/resourceReferencePickerConfirm.ts \
  src/components/documents/useResourceReferencePickerController.ts \
  src/components/documents/ResourceReferenceInsertButton.tsx \
  tests/unit/documents/resource-reference-insert-focus.test.ts
git commit -m "$(cat <<'EOF'
feat(documents): support inserting multiple resource reference chips

EOF
)"
```

---

### Task 5: Table Tab Multi-Select Whole-Row Picker

**Files:**
- Create: `src/components/documents/ResourceReferenceTableRowList.tsx`
- Modify: `src/components/documents/ResourceReferencePickerModal.tsx`
- Modify: `src/components/documents/ResourceReferencePickerModal.module.css`
- Modify: `tests/unit/documents/resource-reference-picker.test.tsx`
- Modify: `tests/e2e/specs/document-references.spec.ts`

**Interfaces:**
- Consumes: `joinTableRowDisplayValues`, multi-target confirm API
- Produces: `onConfirm(targets: ResourceReferenceTarget[])` where table confirm may be length ≥ 1; document confirm is length 1

- [ ] **Step 1: Rewrite picker unit tests for the new Table UX**

Mock `ResourceReferenceTableRowList` similarly to today’s `ResourceReferenceResultList` mock: capture `ariaLabel`, `items`, `selectedIds`, `onToggle`, render clickable options with `aria-selected` / checkbox state.

Update helpers:

```ts
async function selectTableRows(libraryId = LIBRARY_A, assetIndexes: number[] = [0]) {
  await act(async () => ui.selects.get('Table')?.onChange(libraryId));
  await waitFor(() => (ui.rows.get('Table rows')?.length ?? 0) > Math.max(...assetIndexes));
  for (const index of assetIndexes) {
    await act(async () => ui.rows.get('Table rows')?.[index].props.onClick());
  }
}
```

Replace the main table test:

1. No `Display field` select (`expect(ui.selects.get('Display field')).toBeUndefined()`).
2. Row accessible text / title shows joined values (e.g. Ada row with Status Active + empty Notes → `Active`).
3. Multi-select Ada + Byron → Insert calls `onConfirm` with **array** of two targets:
   - `displayFieldId` = first field (`FIELD_STATUS`)
   - `fallbackLabel` = joined values (`Active`, `Pending`)
4. Validate `resolveResourceReferences` called with both targets; if any unavailable → no confirm (extend mock to return mixed map).
5. Replace-mode with `initialTarget`: only one row can be selected (toggling another replaces selection); `okText` still `Replace`; `onConfirm` length 1.
6. Search still filters; selection for filtered-out rows remains until library change.
7. Document tab tests: `onConfirm` now receives `[rangeTarget]` (wrap previous single object in array).

Update e2e `insertTableReference`:

```ts
await dialog.getByRole('option', { name: new RegExp(ROW_NAME|TABLE_LABEL) }).click();
// remove Display field steps
await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
```

Assert chip / durable MDX still contains `ResourceReference` and live label becomes whole-row join for that fixture (if fixture has one field, label stays that field’s value).

- [ ] **Step 2: Run picker tests — expect FAIL**

Run: `npm run test:unit -- tests/unit/documents/resource-reference-picker.test.tsx --runInBand`

Expected: FAIL (Display field still present / single onConfirm)

- [ ] **Step 3: Implement table row list + modal**

`ResourceReferenceTableRowList.tsx` (checkbox listbox, `aria-multiselectable={!singleSelect}`):

```ts
export type ResourceReferenceTableRowListProps = {
  ariaLabel: string;
  idPrefix: string;
  items: readonly { id: string; label: string }[];
  selectedIds: ReadonlySet<string>;
  singleSelect: boolean;
  emptyText: string;
  onToggle: (id: string) => void;
};
```

Render each item as `role="option"` with a checkbox (or `aria-checked`) and the joined `label` text only — **no header row**, no secondary description line.

`ResourceReferencePickerModal.tsx` changes:

- `selectedAssetIds: string[]` (or Set in state).
- Drop `selectedFieldId` user control; derive `displayFieldId = tableRows.fields[0]?.id ?? null`.
- Build `targets: ResourceReferenceTarget[]` from selected rows in **filtered list order** (only selected that are still in `filteredRows` for confirm? Spec: preserve selection off-filter; confirm should include all selected for current library, ordered by full `tableRows.rows` order).
- `onConfirm(targets)` after validating every target available; if any fail → existing unavailable error, insert none.
- Replace (`initialTarget`): `singleSelect=true`; initializing selection from `initialTarget.assetId`.
- Modal `width={800}` (or ~720–880).
- CSS: `.rowToolbar` becomes single search input; add `.tableRow` / checkbox spacing; keep scrollable list height.

Document confirm path:

```ts
if (target) onConfirm([target]);
```

- [ ] **Step 4: Re-run picker + related unit tests**

Run:

```bash
npm run test:unit -- \
  tests/unit/documents/resource-reference-picker.test.tsx \
  tests/unit/documents/resource-reference-insert-focus.test.ts \
  tests/unit/documents/document-reference-navigation.test.tsx \
  --runInBand
```

Expected: PASS (fix any remaining single-target wiring in navigation tests if they assert Insert reference copy only).

- [ ] **Step 5: Typecheck and e2e when env available**

Run: `npm run typecheck`

Run (optional / when Supabase e2e env is up):

`npx playwright test tests/e2e/specs/document-references.spec.ts`

- [ ] **Step 6: Commit**

```bash
git add \
  src/components/documents/ResourceReferenceTableRowList.tsx \
  src/components/documents/ResourceReferencePickerModal.tsx \
  src/components/documents/ResourceReferencePickerModal.module.css \
  src/components/documents/MdxDocumentEditor.tsx \
  tests/unit/documents/resource-reference-picker.test.tsx \
  tests/e2e/specs/document-references.spec.ts
git commit -m "$(cat <<'EOF'
feat(documents): multi-select whole-row table references in insert picker

EOF
)"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
| --- | --- |
| Whole-row cell text in picker, no headers | Task 5 |
| Multi-select + one Insert → many chips | Tasks 4–5 |
| Joined `fallbackLabel` / live label with ` · ` | Tasks 1–2, 5 |
| Auto `displayFieldId` = first field | Task 5 |
| No hover Tooltip (table + document) | Task 3 |
| Document tab selection unchanged | Task 5 |
| Replace stays single-select | Task 5 |
| Validate all targets or insert none | Task 5 |
| E2E Display field removal | Task 5 |

## Self-Review

- No TBD / placeholder steps.
- `onConfirm` / `apply` consistently use `ResourceReferenceTarget[]` from Task 4 onward.
- Resolve fetch strategy matches whole-row labeling (all fields + all asset values).
