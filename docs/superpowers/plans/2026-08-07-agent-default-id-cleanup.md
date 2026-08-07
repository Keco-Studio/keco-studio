# Agent Default ID Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically remove an unused, automatically initialized `ID` field before Agent row imports while preserving deliberate or populated ID fields.

**Architecture:** Put the conservative field-shape and emptiness predicate in a pure Agent module, then wrap the existing permission-checked field deletion service in a small cleanup function. Pre-execute tools clean before semantic field resolution and reload the schema after deletion; the post-preview `update_row` workflow keeps preview read-only and performs the same current-state check immediately before its confirmed import write. A prompt rule prevents the model from turning invented ID content into an apparently explicit user value.

**Tech Stack:** TypeScript 5.9, Jest 30 with ts-jest, Zod, Supabase client services.

---

## File Structure

- Create `src/lib/agent/default-id-field.ts`: pure detection of the disposable default field.
- Create `src/lib/agent/default-id-cleanup.ts`: permission-checked deletion orchestration.
- Create `tests/unit/agent/default-id-field.test.ts`: predicate boundary coverage.
- Create `tests/unit/agent/default-id-cleanup.test.ts`: deletion success, no-op, and failure behavior.
- Create `tests/unit/agent/default-id-write-wiring.test.ts`: regression guard that every Agent row-write entry point runs cleanup before field resolution.
- Modify `src/lib/agent/property-value-validation.ts`: prevent row-name merge from selecting a default-shaped ID field.
- Modify `tests/unit/agent/property-value-validation.test.ts`: cover the row-name merge guard.
- Modify `src/lib/agent/tools/create-asset.ts`: clean and refresh the schema before create/reuse writes.
- Modify `src/lib/agent/tools/update-asset.ts`: clean and refresh the schema after target validation and before update resolution.
- Modify `src/lib/agent/workflows/update-row.ts`: preserve the read-only preview and clean against fresh state immediately before confirmed import.
- Modify `src/lib/agent/prompts.ts`: tell the model to omit unused default ID values instead of inventing them.
- Modify `tests/unit/agent/system-prompt.test.ts`: lock in the prompt rule.

### Task 1: Detect Only an Unused Default ID Field

**Files:**
- Create: `src/lib/agent/default-id-field.ts`
- Create: `tests/unit/agent/default-id-field.test.ts`

- [ ] **Step 1: Write the failing predicate tests**

Create `tests/unit/agent/default-id-field.test.ts`:

```ts
import {
  findUnusedDefaultIdField,
  isDefaultIdFieldShape,
} from '@/lib/agent/default-id-field';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const defaultId: PropertyConfig = {
  id: 'id-field',
  key: 'id-field',
  name: 'ID',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 0,
};
const typeField: PropertyConfig = {
  id: 'type-field',
  key: 'type-field',
  name: 'Cat Type',
  valueType: 'string',
  dataType: 'string',
  required: false,
  orderIndex: 1,
};
const row = (idValue: unknown): AssetRow => ({
  id: 'row-1',
  libraryId: 'library-1',
  name: '',
  propertyValues: { 'id-field': idValue },
});

describe('isDefaultIdFieldShape', () => {
  it('recognizes only the optional first string field named ID', () => {
    expect(isDefaultIdFieldShape(defaultId)).toBe(true);
    expect(isDefaultIdFieldShape({ ...defaultId, name: 'Identifier' })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, dataType: 'int' })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, required: true })).toBe(false);
    expect(isDefaultIdFieldShape({ ...defaultId, orderIndex: 1 })).toBe(false);
  });
});

describe('findUnusedDefaultIdField', () => {
  it('returns an empty default ID when another business field exists', () => {
    expect(findUnusedDefaultIdField([defaultId, typeField], [row('')], { 'Cat Type': 'Sick Cat' }))
      .toBe(defaultId);
  });

  it('preserves a populated ID field', () => {
    expect(findUnusedDefaultIdField([defaultId, typeField], [row('CAT-001')], { 'Cat Type': 'Sick Cat' }))
      .toBeUndefined();
  });

  it.each([
    { ID: 'CAT-001' },
    { 'id-field': 'CAT-001' },
    { item: { ID: 'CAT-001' } },
  ])('preserves ID when the incoming values explicitly contain it: %p', (values) => {
    expect(findUnusedDefaultIdField([defaultId, typeField], [row('')], values))
      .toBeUndefined();
  });

  it('preserves the only field in a table', () => {
    expect(findUnusedDefaultIdField([defaultId], [row('')], {})).toBeUndefined();
  });

  it('preserves fields that do not have the default shape', () => {
    expect(findUnusedDefaultIdField(
      [{ ...defaultId, name: 'Identifier' }, typeField],
      [row('')],
      { 'Cat Type': 'Sick Cat' }
    )).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/agent/default-id-field.test.ts
```

Expected: FAIL because `@/lib/agent/default-id-field` does not exist.

- [ ] **Step 3: Implement the pure predicate**

Create `src/lib/agent/default-id-field.ts`:

```ts
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function incomingFieldKeys(values: Record<string, unknown> | undefined): string[] {
  if (!values) return [];
  const keys = Object.keys(values);
  if (isPlainObject(values.item)) keys.push(...Object.keys(values.item));
  return keys;
}

export function isDefaultIdFieldShape(field: PropertyConfig): boolean {
  return field.name === 'ID'
    && field.dataType === 'string'
    && field.orderIndex === 0
    && field.required !== true;
}

export function findUnusedDefaultIdField(
  properties: PropertyConfig[],
  assets: AssetRow[],
  incomingValues: Record<string, unknown> | undefined
): PropertyConfig | undefined {
  if (properties.length < 2) return undefined;

  const field = properties.find(isDefaultIdFieldShape);
  if (!field) return undefined;

  const explicit = incomingFieldKeys(incomingValues).some(
    (key) => key === field.id || key.trim().toLowerCase() === 'id'
  );
  if (explicit) return undefined;

  const populated = assets.some(
    (asset) => !isEmptyValue(asset.propertyValues?.[field.id])
  );
  return populated ? undefined : field;
}
```

- [ ] **Step 4: Run the predicate tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/agent/default-id-field.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the predicate**

```bash
git add src/lib/agent/default-id-field.ts tests/unit/agent/default-id-field.test.ts
git commit -m "test: define unused default ID detection"
```

### Task 2: Prevent Row Names from Filling Default ID

**Files:**
- Modify: `tests/unit/agent/property-value-validation.test.ts`
- Modify: `src/lib/agent/property-value-validation.ts`

- [ ] **Step 1: Write the failing name-merge regression test**

Add inside `describe('mergeAssetNameIntoPropertyValues', ...)` in `tests/unit/agent/property-value-validation.test.ts`:

```ts
  it('does not fill a default-shaped ID field from the internal asset name', () => {
    const defaultIdField: PropertyConfig = {
      id: 'id-field',
      key: 'id-field',
      name: 'ID',
      valueType: 'string',
      dataType: 'string',
      required: false,
      orderIndex: 0,
    };

    const out = mergeAssetNameIntoPropertyValues(
      { 'float-id': 0.75 },
      [defaultIdField, discountField],
      'Agile Cat'
    );

    expect(out).toEqual({ 'float-id': 0.75 });
  });
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/agent/property-value-validation.test.ts
```

Expected: FAIL because `mergeAssetNameIntoPropertyValues` adds `'id-field': 'Agile Cat'`.

- [ ] **Step 3: Exclude the default ID shape from primary-label selection**

Add this import to `src/lib/agent/property-value-validation.ts`:

```ts
import { isDefaultIdFieldShape } from './default-id-field';
```

Replace the `stringFields` declaration in `findPrimaryLabelField` with:

```ts
  const stringFields = sorted.filter(
    (field) => field.dataType === 'string' && !isDefaultIdFieldShape(field)
  );
```

- [ ] **Step 4: Run both focused test files and verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/agent/default-id-field.test.ts tests/unit/agent/property-value-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the name-merge guard**

```bash
git add src/lib/agent/property-value-validation.ts tests/unit/agent/property-value-validation.test.ts
git commit -m "fix: keep Agent row names out of default ID"
```

### Task 3: Delete the Field Before Every Agent Row Write

**Files:**
- Create: `src/lib/agent/default-id-cleanup.ts`
- Create: `tests/unit/agent/default-id-cleanup.test.ts`
- Create: `tests/unit/agent/default-id-write-wiring.test.ts`
- Modify: `src/lib/agent/tools/create-asset.ts`
- Modify: `src/lib/agent/tools/update-asset.ts`
- Modify: `src/lib/agent/workflows/update-row.ts`

- [ ] **Step 1: Write failing cleanup orchestration tests**

Create `tests/unit/agent/default-id-cleanup.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

const deleteLibraryField = jest.fn();
jest.mock('@/lib/services/libraryAssetsService', () => ({
  deleteLibraryField: (...args: unknown[]) => deleteLibraryField(...args),
}));

import { removeUnusedDefaultIdField } from '@/lib/agent/default-id-cleanup';

const supabase = {} as SupabaseClient;
const idField: PropertyConfig = {
  id: 'id-field', key: 'id-field', name: 'ID', valueType: 'string',
  dataType: 'string', required: false, orderIndex: 0,
};
const businessField: PropertyConfig = {
  id: 'type-field', key: 'type-field', name: 'Cat Type', valueType: 'string',
  dataType: 'string', required: false, orderIndex: 1,
};
const blankRows: AssetRow[] = [{
  id: 'row-1', libraryId: 'library-1', name: '', propertyValues: { 'id-field': '' },
}];

describe('removeUnusedDefaultIdField', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes and returns the removed field id', async () => {
    deleteLibraryField.mockResolvedValue(undefined);
    await expect(removeUnusedDefaultIdField(
      supabase, 'library-1', [idField, businessField], blankRows, { 'Cat Type': 'Sick Cat' }
    )).resolves.toEqual({ removed: true, fieldId: 'id-field' });
    expect(deleteLibraryField).toHaveBeenCalledWith(supabase, 'library-1', 'id-field');
  });

  it('does not call delete when the field is not disposable', async () => {
    await expect(removeUnusedDefaultIdField(
      supabase, 'library-1', [idField], blankRows, {}
    )).resolves.toEqual({ removed: false });
    expect(deleteLibraryField).not.toHaveBeenCalled();
  });

  it('propagates deletion failure so the row write stops', async () => {
    deleteLibraryField.mockRejectedValue(new Error('delete denied'));
    await expect(removeUnusedDefaultIdField(
      supabase, 'library-1', [idField, businessField], blankRows, { 'Cat Type': 'Sick Cat' }
    )).rejects.toThrow('delete denied');
  });
});
```

- [ ] **Step 2: Write the failing three-entry-point wiring test**

Create `tests/unit/agent/default-id-write-wiring.test.ts`:

```ts
import { readFileSync } from 'node:fs';

const preExecuteFiles = [
  'src/lib/agent/tools/create-asset.ts',
  'src/lib/agent/tools/update-asset.ts',
];

describe('Agent default ID cleanup wiring', () => {
  it.each(preExecuteFiles)('%s removes the unused default before semantic field resolution', (file) => {
    const source = readFileSync(file, 'utf8');
    const cleanupIndex = source.indexOf('removeUnusedDefaultIdField(');
    const resolutionIndex = source.indexOf('resolvePropertyValues(', cleanupIndex);
    const refreshIndex = source.lastIndexOf('getLibraryProperties(', resolutionIndex);
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(resolutionIndex).toBeGreaterThan(cleanupIndex);
    expect(refreshIndex).toBeGreaterThan(cleanupIndex);
    expect(source).toContain('if (cleanup.removed)');
    expect(source).toContain('getLibraryProperties(');
  });

  it('keeps update_row preview read-only and removes the field before confirmed import', () => {
    const source = readFileSync('src/lib/agent/workflows/update-row.ts', 'utf8');
    const importIndex = source.indexOf('async function executeImport(');
    const previewSource = source.slice(0, importIndex);
    const importSource = source.slice(importIndex);
    const cleanupIndex = importSource.indexOf('removeUnusedDefaultIdField(');
    const writeIndex = importSource.indexOf('updateAssetService(');

    expect(importIndex).toBeGreaterThan(-1);
    expect(previewSource).not.toContain('removeUnusedDefaultIdField(');
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(writeIndex).toBeGreaterThan(cleanupIndex);
  });
});
```

- [ ] **Step 3: Run both new test files and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/agent/default-id-cleanup.test.ts tests/unit/agent/default-id-write-wiring.test.ts
```

Expected: FAIL because `default-id-cleanup.ts` and all three cleanup calls are absent.

- [ ] **Step 4: Implement permission-checked cleanup**

Create `src/lib/agent/default-id-cleanup.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteLibraryField } from '@/lib/services/libraryAssetsService';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { findUnusedDefaultIdField } from './default-id-field';

export async function removeUnusedDefaultIdField(
  supabase: SupabaseClient,
  libraryId: string,
  properties: PropertyConfig[],
  assets: AssetRow[],
  incomingValues: Record<string, unknown> | undefined
): Promise<{ removed: false } | { removed: true; fieldId: string }> {
  const field = findUnusedDefaultIdField(properties, assets, incomingValues);
  if (!field) return { removed: false };

  await deleteLibraryField(supabase, libraryId, field.id);
  return { removed: true, fieldId: field.id };
}
```

- [ ] **Step 5: Wire cleanup into `create_asset`**

In `src/lib/agent/tools/create-asset.ts`, import `getLibraryAssets` and `getLibraryProperties` from `../data-access`, import `removeUnusedDefaultIdField`, and remove `getLibraryProperties` from `./_shared`. Replace the existing parallel property/resolution block and the later duplicate asset load with:

```ts
  let [properties, assets] = await Promise.all([
    getLibraryProperties(ctx.supabase, library.id, ctx),
    getLibraryAssets(ctx.supabase, library.id, ctx),
  ]);
  let cleanup: Awaited<ReturnType<typeof removeUnusedDefaultIdField>>;
  try {
    cleanup = await removeUnusedDefaultIdField(
      ctx.supabase,
      library.id,
      properties,
      assets,
      propertyValues
    );
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message || 'Failed to remove unused default ID field.',
    };
  }
  if (cleanup.removed) {
    properties = await getLibraryProperties(ctx.supabase, library.id, ctx);
  }

  const { resolved, unresolved, availableFields } = await resolvePropertyValues(
    ctx.supabase,
    library.id,
    propertyValues
  );
```

Keep the existing `const emptyRow = findFirstEmptyUiRowAsset(assets);` in the write block, but remove its preceding `const assets = await getLibraryAssets(...)` because the rows are already loaded.

- [ ] **Step 6: Wire cleanup into `update_asset`**

In `src/lib/agent/tools/update-asset.ts`, import `getLibraryAssets` and `getLibraryProperties` from `../data-access`, import `removeUnusedDefaultIdField`, and remove `getLibraryProperties` from `./_shared`. After validating `assetRow.library_id` and the explicit-empty payload, replace the existing parallel property/resolution block with:

```ts
  let [properties, assets] = await Promise.all([
    getLibraryProperties(ctx.supabase, library.id, ctx),
    getLibraryAssets(ctx.supabase, library.id, ctx),
  ]);
  const cleanup = await removeUnusedDefaultIdField(
    ctx.supabase,
    library.id,
    properties,
    assets,
    propertyValues
  );
  if (cleanup.removed) {
    properties = await getLibraryProperties(ctx.supabase, library.id, ctx);
  }

  const { resolved, unresolved, availableFields } = await resolvePropertyValues(
    ctx.supabase,
    library.id,
    propertyValues
  );
```

This placement ensures an invalid asset target cannot trigger schema deletion.

- [ ] **Step 7: Wire cleanup into `update_row`**

In `src/lib/agent/workflows/update-row.ts`, import `removeUnusedDefaultIdField`. Keep `execute()` unchanged so its post-preview contract remains non-mutating. At the beginning of the existing `try` block in `executeImport()`, add:

```ts
  const [properties, assets] = await Promise.all([
    getLibraryProperties(ctx.supabase, preview.libraryId, ctx),
    getLibraryAssets(ctx.supabase, preview.libraryId, ctx),
  ]);
  await removeUnusedDefaultIdField(
    ctx.supabase,
    preview.libraryId,
    properties,
    assets,
    preview.resolvedValues
  );
```

This placement ensures an invalid row number or cancelled preview cannot trigger schema deletion. The cleanup predicate is reevaluated from fresh fields and rows, and any deletion failure is caught by the existing import error path before `updateAssetService` runs.

- [ ] **Step 8: Run the cleanup and wiring tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/agent/default-id-cleanup.test.ts tests/unit/agent/default-id-write-wiring.test.ts tests/unit/agent/property-value-validation.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run TypeScript checking for integration errors**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 10: Commit the deterministic cleanup path**

```bash
git add src/lib/agent/default-id-cleanup.ts src/lib/agent/tools/create-asset.ts src/lib/agent/tools/update-asset.ts src/lib/agent/workflows/update-row.ts tests/unit/agent/default-id-cleanup.test.ts tests/unit/agent/default-id-write-wiring.test.ts
git commit -m "fix: remove unused default ID before Agent writes"
```

### Task 4: Prevent the Model from Inventing Explicit ID Values

**Files:**
- Modify: `tests/unit/agent/system-prompt.test.ts`
- Modify: `src/lib/agent/prompts.ts`

- [ ] **Step 1: Write the failing prompt contract test**

Add to `tests/unit/agent/system-prompt.test.ts`:

```ts
  it('forbids invented values for an unused default ID column', () => {
    const prompt = buildSystemPrompt({ projectId: 'project-1', userRole: 'editor' });
    expect(prompt).toContain('DEFAULT ID CLEANUP');
    expect(prompt).toMatch(/omit ID from propertyValues/i);
    expect(prompt).toMatch(/never invent an ID/i);
  });
```

- [ ] **Step 2: Run the prompt test and verify RED**

Run:

```bash
npx jest --runInBand tests/unit/agent/system-prompt.test.ts
```

Expected: FAIL because the prompt does not contain the default-ID rule.

- [ ] **Step 3: Add the prompt rule**

Insert after rule `15a` in `src/lib/agent/prompts.ts`:

```ts
15b. DEFAULT ID CLEANUP: A manually created table may contain an empty optional first column named ID. When the user's source data does not explicitly contain an ID field, omit ID from propertyValues; the row-write tool removes that unused default column. Never invent an ID or copy a generated row label into ID. Preserve and write ID only when the user or source data explicitly supplies it.
```

- [ ] **Step 4: Run the prompt and focused regression tests and verify GREEN**

Run:

```bash
npx jest --runInBand tests/unit/agent/system-prompt.test.ts tests/unit/agent/default-id-field.test.ts tests/unit/agent/default-id-cleanup.test.ts tests/unit/agent/default-id-write-wiring.test.ts tests/unit/agent/property-value-validation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the complete Agent unit-test directory**

Run:

```bash
npx jest --runInBand tests/unit/agent
```

Expected: all Agent test suites pass with no unhandled warnings or errors.

- [ ] **Step 6: Run final static verification**

Run:

```bash
npm run typecheck
git diff --check
```

Expected: typecheck exits 0 and `git diff --check` prints no whitespace errors.

- [ ] **Step 7: Commit the prompt guard**

```bash
git add src/lib/agent/prompts.ts tests/unit/agent/system-prompt.test.ts
git commit -m "fix: forbid invented default IDs in Agent imports"
```
