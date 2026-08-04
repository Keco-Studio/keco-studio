# Remove Table Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove table field sections from Keco's product UI and contracts while preserving all existing fields and cell values through private database compatibility columns.

**Architecture:** Normalize every library's field definitions into one internal database group, then expose only one globally ordered field list above the persistence boundary. The table, Predefine editor, imports/exports, Agent, and MCP consume flat field contracts; only persistence helpers and SQL may mention the legacy `section` columns.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Jest 30, Playwright, Supabase Postgres migrations/RPCs, Deno MCP tests, ExcelJS.

---

## File Structure

- `src/lib/library/fieldCompatibility.ts`: the only application helper allowed to construct values for the retained database columns.
- `supabase/migrations/20260804010000_flatten_library_field_sections.sql`: transactional legacy-data normalization and flat MCP RPC replacements.
- `src/lib/types/libraryAssets.ts`: flat `PropertyConfig` domain type; remove `SectionConfig`.
- `src/lib/services/libraryAssetsService.ts`: flat schema reads and whole-table field creation.
- `src/components/libraries/**`: table rendering against one ordered property list; delete section-only components and hooks.
- `src/app/(dashboard)/[projectId]/[libraryId]/predefine/**`: one sortable field editor; retain Predefine itself.
- `src/lib/services/importService.ts` and `src/app/api/export/route.ts`: flatten workbook sources and emit flat exports.
- `src/lib/agent/**` and `src/components/agent/**`: remove section context, schemas, previews, and prompt language.
- `supabase/functions/mcp/**`: remove section input fields and section metadata from MCP results.
- Focused Jest, Deno, database, and Playwright tests verify each boundary before the next boundary changes.

### Task 1: Normalize Legacy Database Data

**Files:**
- Create: `src/lib/library/fieldCompatibility.ts`
- Create: `supabase/migrations/20260804010000_flatten_library_field_sections.sql`
- Create: `tests/unit/database/flatten-library-fields-migration.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.resolve(
  __dirname,
  '../../../supabase/migrations/20260804010000_flatten_library_field_sections.sql'
), 'utf8');

describe('flat library field migration', () => {
  it('normalizes by legacy section order without replacing field ids', () => {
    expect(sql).toMatch(/min\(order_index\).*section_first_order/is);
    expect(sql).toMatch(/row_number\(\).*partition by library_id/is);
    expect(sql).toMatch(/order by.*section_first_order.*order_index.*id/is);
    expect(sql).toMatch(/update public\.library_field_definitions/is);
    expect(sql).not.toMatch(/delete from public\.library_field_definitions/i);
  });

  it('uses one compatibility group per library and two-phase ordering', () => {
    expect(sql).toContain("'__keco_flat_fields__'");
    expect(sql).toMatch(/md5\(library_id::text \|\| '::keco-flat-fields'\)/i);
    expect(sql).toMatch(/order_index\s*=\s*-\(.*flat_order.*\+\s*1\)/is);
    expect(sql).toMatch(/order_index\s*=\s*flat_order/is);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing migration failure**

Run: `npm run test:unit -- --runInBand tests/unit/database/flatten-library-fields-migration.test.ts`

Expected: FAIL because `20260804010000_flatten_library_field_sections.sql` does not exist.

- [ ] **Step 3: Add the application compatibility helper**

```ts
export const INTERNAL_FIELD_GROUP_NAME = '__keco_flat_fields__';

export function getInternalFieldGroupId(libraryId: string): string {
  return `${libraryId}:keco-flat-fields`;
}

export function getInternalFieldGroupColumns(libraryId: string) {
  return {
    section: INTERNAL_FIELD_GROUP_NAME,
    section_id: getInternalFieldGroupId(libraryId),
  } as const;
}
```

- [ ] **Step 4: Add the transactional normalization SQL**

Use a `normalize_library_field_sections(p_library_id uuid default null)` function that locks matching definitions, snapshots legacy group order into a temporary table, assigns unique negative order values, then assigns the common compatibility group and final zero-based order. Invoke it once for all libraries, revoke public execution, grant only `service_role`, and keep the function for the database behavior test and emergency repair.

```sql
create or replace function public.normalize_library_field_sections(
  p_library_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.library_field_definitions
  where p_library_id is null or library_id = p_library_id
  for update;

  create temporary table flat_field_order on commit drop as
  with section_order as (
    select library_id, section_id, min(order_index) as section_first_order
    from public.library_field_definitions
    where p_library_id is null or library_id = p_library_id
    group by library_id, section_id
  )
  select f.id,
         row_number() over (
           partition by f.library_id
           order by s.section_first_order, f.section, f.order_index, f.id
         ) - 1 as flat_order
  from public.library_field_definitions f
  join section_order s using (library_id, section_id)
  where p_library_id is null or f.library_id = p_library_id;

  update public.library_field_definitions f
  set order_index = -(o.flat_order + 1)
  from flat_field_order o
  where f.id = o.id;

  update public.library_field_definitions f
  set section = '__keco_flat_fields__',
      section_id = md5(f.library_id::text || '::keco-flat-fields'),
      order_index = o.flat_order
  from flat_field_order o
  where f.id = o.id;
end;
$$;

select public.normalize_library_field_sections(null);
revoke all on function public.normalize_library_field_sections(uuid) from public, anon, authenticated;
grant execute on function public.normalize_library_field_sections(uuid) to service_role;
```

- [ ] **Step 5: Run focused tests and checks**

Run: `npm run test:unit -- --runInBand tests/unit/database/flatten-library-fields-migration.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the migration boundary**

```bash
git add src/lib/library/fieldCompatibility.ts \
  supabase/migrations/20260804010000_flatten_library_field_sections.sql \
  tests/unit/database/flatten-library-fields-migration.test.ts
git commit -m "feat(database): flatten table field sections"
```

### Task 2: Introduce Flat Domain Types and Schema Services

**Files:**
- Modify: `src/lib/types/libraryAssets.ts`
- Modify: `src/lib/services/libraryAssetsService.ts`
- Modify: `src/components/libraries/utils/tableStructure.ts`
- Modify: `src/components/libraries/hooks/useLibraryTableStructure.ts`
- Modify: `tests/unit/library-table-structure.test.ts`
- Create: `tests/unit/library-schema-flat-static.test.ts`

- [ ] **Step 1: Add table-structure tests for a parallel flat property contract**

Replace the section fixture and grouping assertion with:

```ts
const property = (id: string, name: string, orderIndex: number): FlatPropertyConfig => ({
  id,
  key: id,
  name,
  valueType: 'string',
  dataType: 'string',
  orderIndex,
});

it('orders every table property by global order index', () => {
  expect(orderProperties([
    property('third', 'Third', 2),
    property('first', 'First', 0),
    property('second', 'Second', 1),
  ]).map((item) => item.id)).toEqual(['first', 'second', 'third']);
});
```

Add a static boundary test for the new migration API:

```ts
const serviceSource = readFileSync('src/lib/services/libraryAssetsService.ts', 'utf8');

expect(serviceSource).toMatch(/getFlatLibrarySchema[\s\S]*Promise<FlatPropertyConfig\[\]>/);
expect(serviceSource).toMatch(/addFlatLibraryField/);
```

- [ ] **Step 2: Run both tests and verify they fail on the grouped API**

Run: `npm run test:unit -- --runInBand tests/unit/library-table-structure.test.ts tests/unit/library-schema-flat-static.test.ts`

Expected: FAIL because `FlatPropertyConfig`, `orderProperties`, and the flat service functions do not exist.

- [ ] **Step 3: Add a flat domain type and parallel service API**

Add `FlatPropertyConfig = Omit<PropertyConfig, 'sectionId'>`. Keep the old grouped types and services only until every caller migrates in Tasks 3-8. Add a flat schema reader:

```ts
export async function getFlatLibrarySchema(
  supabase: SupabaseClient,
  libraryId: string
): Promise<FlatPropertyConfig[]> {
  const { data, error } = await supabase
    .from('library_field_definitions')
    .select('*')
    .eq('library_id', libraryId)
    .order('order_index', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapFieldDefinitionToFlatProperty);
}
```

Add `addFlatLibraryField(supabase, libraryId, payload)`, calculate `max(order_index) + 1` across the library, and spread `getInternalFieldGroupColumns(libraryId)` into the insert. The old `addLibraryField` and section CRUD services remain temporarily for unmigrated callers and are deleted in Task 8.

- [ ] **Step 4: Replace grouping with deterministic ordering**

```ts
export function orderProperties(properties: FlatPropertyConfig[]): FlatPropertyConfig[] {
  return [...properties].sort(
    (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id)
  );
}
```

`useLibraryTableStructure(properties)` memoizes `orderProperties(properties)` and feeds that list to script-column detection.

- [ ] **Step 5: Run focused tests and typecheck to expose callers**

Run: `npm run test:unit -- --runInBand tests/unit/library-table-structure.test.ts tests/unit/library-schema-flat-static.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS because the flat API is introduced alongside the old API until callers migrate.

- [ ] **Step 6: Commit the flat domain boundary**

```bash
git add src/lib/types/libraryAssets.ts src/lib/services/libraryAssetsService.ts \
  src/components/libraries/utils/tableStructure.ts \
  src/components/libraries/hooks/useLibraryTableStructure.ts \
  tests/unit/library-table-structure.test.ts tests/unit/library-schema-flat-static.test.ts
git commit -m "refactor(tables): add flat field schema APIs"
```

### Task 3: Remove Section UI from the Library Table

**Files:**
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/page.tsx`
- Modify: `src/components/libraries/LibraryAssetsTable.tsx`
- Modify: `src/components/libraries/components/LibraryTableTopBar.tsx`
- Modify: `src/components/libraries/components/TableHeader.tsx`
- Modify: `src/components/libraries/components/TableCellFindReplace.tsx`
- Modify: `src/components/libraries/hooks/useLibraryTableFindReplaceWiring.ts`
- Modify: `src/components/libraries/components/TextCell.tsx`
- Modify: `src/components/libraries/LibraryAssetsTable.module.css`
- Delete: `src/components/libraries/components/SectionTabs.tsx`
- Delete: `src/components/libraries/hooks/useLibrarySectionEditing.ts`
- Create: `tests/unit/table-sections-removed-static.test.ts`

- [ ] **Step 1: Write the table UI removal test**

```ts
import { existsSync, readFileSync } from 'node:fs';

const table = readFileSync('src/components/libraries/LibraryAssetsTable.tsx', 'utf8');
const page = readFileSync('src/app/(dashboard)/[projectId]/[libraryId]/page.tsx', 'utf8');
const css = readFileSync('src/components/libraries/LibraryAssetsTable.module.css', 'utf8');

it('has no table section controls or active-section state', () => {
  expect(existsSync('src/components/libraries/components/SectionTabs.tsx')).toBe(false);
  expect(existsSync('src/components/libraries/hooks/useLibrarySectionEditing.ts')).toBe(false);
  expect(table).not.toMatch(/activeSection|onAddSection|onUpdateSection|onDeleteSection|sectionDeleteConfirm/);
  expect(page).not.toMatch(/handleAddSection|handleUpdateSection|handleDeleteSection|tableSections/);
  expect(css).not.toMatch(/\.sectionTabs|\.sectionTab|\.addSectionButton/);
});
```

- [ ] **Step 2: Run the test and verify it fails on existing section UI**

Run: `npm run test:unit -- --runInBand tests/unit/table-sections-removed-static.test.ts`

Expected: FAIL on the existing files, props, state, and styles.

- [ ] **Step 3: Render all properties directly**

In `LibraryAssetsTable`, accept `properties` only, remove section callbacks/state/effects/modals, and use:

```ts
const { orderedProperties, scriptColumns, hasScriptColumns } =
  useLibraryTableStructure(properties);
const activeProperties = orderedProperties;
```

Change `onAddProperty` to `(payload: AddColumnFormPayload) => Promise<void>` and pass only that callback to `AddColumnModal`. Remove section props from `LibraryTableTopBar`, `TableHeader`, find/replace wiring, and body/cell comments.

- [ ] **Step 4: Remove route-level section handlers and artifacts**

Change the page query to `getFlatLibrarySchema`, set `const tableProperties = librarySchema ?? []`, update `handleAddProperty(payload)` to call `addFlatLibraryField`, and pass only `properties`, `overrideRows`, and `onAddProperty` to the adapter. Delete `SectionTabs.tsx`, `useLibrarySectionEditing.ts`, delete-confirm markup, imports, icons, and CSS selectors used only by tabs.

- [ ] **Step 5: Run focused UI and regression tests**

Run: `npm run test:unit -- --runInBand tests/unit/table-sections-removed-static.test.ts tests/unit/library-table-structure.test.ts tests/unit/column-value-filter.test.ts tests/unit/table-scalability-static.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: no errors under `src/components/libraries` or the library page.

- [ ] **Step 6: Commit the table UI removal**

```bash
git add 'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx' \
  src/components/libraries tests/unit/table-sections-removed-static.test.ts
git commit -m "refactor(tables): remove section tabs"
```

### Task 4: Flatten the Predefine Schema Editor

**Files:**
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/types.ts`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/hooks/useSchemaData.ts`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/hooks/useSchemaSave.ts`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/FieldForm.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/page.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/page.module.css`
- Modify: `src/components/layout/TopBar.tsx`
- Delete: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/NewSectionForm.tsx`
- Delete: `src/app/(dashboard)/[projectId]/[libraryId]/predefine/components/NewSectionForm.module.css`
- Create: `tests/unit/predefine-flat-schema-static.test.ts`

- [ ] **Step 1: Write a static contract test for retained Predefine behavior**

```ts
const page = readFileSync(predefinePagePath, 'utf8');
const save = readFileSync(predefineSavePath, 'utf8');
const topBar = readFileSync('src/components/layout/TopBar.tsx', 'utf8');

expect(existsSync(newSectionFormPath)).toBe(false);
expect(page).toContain('FieldForm');
expect(page).toMatch(/onDragEnd|SortableContext/);
expect(page).not.toMatch(/Tabs|activeSection|NewSection|Add Section/);
expect(save).toMatch(/fieldsToSave: FieldConfig\[\]/);
expect(topBar).not.toMatch(/predefineActiveSection|Delete Section|predefine-state/);
```

- [ ] **Step 2: Run the test and verify it fails on section tabs**

Run: `npm run test:unit -- --runInBand tests/unit/predefine-flat-schema-static.test.ts`

Expected: FAIL because Predefine still stores `SectionConfig[]` and renders tabs.

- [ ] **Step 3: Flatten schema loading and saving**

Return `fields` sorted by `order_index` from `useSchemaData`. Change
`saveSchemaIncremental(supabase, libraryId, fieldsToSave)` to enumerate one field list and persist:

```ts
const compatibility = getInternalFieldGroupColumns(libraryId);
fieldsToSave.forEach((field, orderIndex) => {
  const row = {
    library_id: libraryId,
    ...compatibility,
    label: field.label,
    description: field.description ?? null,
    data_type: field.dataType ?? null,
    required: field.required,
    order_index: orderIndex,
    enum_options: field.dataType === 'enum' ? field.enumOptions ?? [] : null,
    reference_libraries:
      field.dataType === 'reference' ? field.referenceLibraries ?? [] : null,
  };
  // classify row as insert or update using the existing field-ID logic
});
```

Keep the existing two-phase negative-order update so the retained unique database constraint cannot conflict.

- [ ] **Step 4: Replace tabs with one sortable field list**

Keep the current DnD field form and validation handlers, but make them operate directly on `fields`. Remove section-name editing, add-section positioning observers, new-section state, and section-scoped reset events. TopBar keeps Back/Publish behavior and removes Cancel/Delete Section controls tied to `predefine-state`.

- [ ] **Step 5: Run Predefine and type checks**

Run: `npm run test:unit -- --runInBand tests/unit/predefine-flat-schema-static.test.ts tests/unit/default-library-initialization.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: no errors under the Predefine route or TopBar.

- [ ] **Step 6: Commit the retained flat Predefine editor**

```bash
git add 'src/app/(dashboard)/[projectId]/[libraryId]/predefine' \
  src/components/layout/TopBar.tsx tests/unit/predefine-flat-schema-static.test.ts
git commit -m "refactor(predefine): edit one flat field list"
```

### Task 5: Flatten Imports, Exports, Versions, and Other Field Producers

**Files:**
- Modify: `src/lib/services/importService.ts`
- Modify: `src/app/api/export/route.ts`
- Modify: `src/lib/services/versionService.ts`
- Modify: `src/lib/services/libraryService.ts`
- Modify: `src/lib/services/scriptImportService.ts`
- Modify: `src/lib/utils/workbook.ts`
- Modify: `tests/unit/api-export-route.test.ts`
- Create: `tests/unit/import-flat-fields.test.ts`
- Modify: `tests/unit/import-script-minimal-plan.integration.test.ts`

- [ ] **Step 1: Write failing flat import/export tests**

For JSON export assert `sections` and `sectionId` are absent:

```ts
expect(payload.properties).toEqual([
  expect.objectContaining({ id: fieldId, name: 'Title', orderIndex: 1 }),
]);
expect(payload).not.toHaveProperty('sections');
expect(payload.properties[0]).not.toHaveProperty('sectionId');
```

For XLSX assert one worksheet and one header row:

```ts
expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Locations']);
const sheet = workbook.getWorksheet('Locations');
expect(sheet?.getRow(1).values).toEqual([, 'Title (string)']);
expect(sheet?.getCell('A2').value).toBe('Snowville, "North"');
```

For a two-sheet import assert source order flattens columns and both sheets' values land on the same asset row without returning `sectionCount`.

- [ ] **Step 2: Run export/import tests and verify old contracts fail**

Run: `npm run test:unit -- --runInBand tests/unit/api-export-route.test.ts tests/unit/import-flat-fields.test.ts`

Expected: FAIL because JSON includes section metadata and XLSX exports per-section sheets.

- [ ] **Step 3: Flatten workbook parsing and persistence**

Rename import-internal `ImportSectionData` to `ImportSheetData` and `ParsedImportFile.sections` to `sheets`; sheet names remain source metadata only. Build all field rows with one compatibility group and a monotonically increasing global order. Keep the existing row-index merge behavior across sheets. Return `{ libraryId, rowCount, fieldCount }`.

- [ ] **Step 4: Emit flat JSON and XLSX exports**

Make `getLibrarySchemaDirect` return `PropertyConfig[]`. JSON emits only library metadata, properties, and rows. XLSX creates one worksheet named from the library, writes typed field labels to row 1, and writes assets starting at row 2. Remove section grouping, merged section headers, per-section worksheets, and section-name fallbacks.

- [ ] **Step 5: Update versions, cloning, and script imports**

Snapshots store `schema: { properties }` and accept legacy snapshots by flattening `snapshot.schema.sections` only when reading old data. Cloning and script import spread `getInternalFieldGroupColumns(newLibraryId)` and retain global field order. Preserve old field-to-new-field and asset-value ID mappings.

- [ ] **Step 6: Run focused tests**

Run: `npm run test:unit -- --runInBand tests/unit/api-export-route.test.ts tests/unit/import-flat-fields.test.ts tests/unit/import-script-minimal-plan.integration.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: no errors in import/export or field-producing services.

- [ ] **Step 7: Commit flat data movement**

```bash
git add src/lib/services/importService.ts src/app/api/export/route.ts \
  src/lib/services/versionService.ts src/lib/services/libraryService.ts \
  src/lib/services/scriptImportService.ts src/lib/utils/workbook.ts \
  tests/unit/api-export-route.test.ts tests/unit/import-flat-fields.test.ts \
  tests/unit/import-script-minimal-plan.integration.test.ts
git commit -m "refactor(tables): flatten field import and export"
```

### Task 6: Remove Sections from Agent Context and Tools

**Files:**
- Delete: `src/lib/agent/page-context.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/context-message.ts`
- Modify: `src/lib/agent/prompts.ts`
- Modify: `src/lib/agent/data-access.ts`
- Modify: `src/lib/agent/tools/add-field.ts`
- Modify: `src/lib/agent/tools/list-project-structure.ts`
- Modify: `src/lib/agent/workflows/setup-library.ts`
- Modify: `src/components/agent/SetupLibraryPreviewCard.tsx`
- Modify: `src/lib/agent/embedding-index.ts`
- Modify: `tests/unit/agent/add-field.test.ts`
- Modify: `tests/unit/agent/setup-library.test.ts`
- Modify: `tests/unit/agent/list-project-structure-documents.test.ts`
- Modify: `tests/unit/agent/system-prompt.test.ts`
- Create: `tests/unit/agent/no-table-sections-static.test.ts`

- [ ] **Step 1: Write failing Agent contract tests**

```ts
expect(addField.parameters.properties).not.toHaveProperty('sectionName');
expect(addField.description).not.toMatch(/section/i);

const result = await addField.execute({ label: 'HP', dataType: 'int' }, context);
expect(result).toMatchObject({ success: true, data: { label: 'HP' } });
expect(result.data).not.toHaveProperty('sectionName');

expect(listResult.data.libraries[0]).toEqual({
  id: libraryId,
  name: 'Characters',
  folderName: null,
  fields: [{ label: 'Name', dataType: 'string' }],
});
```

The static test scans only table-domain Agent files and excludes document-heading uses of the English word `section`.

- [ ] **Step 2: Run Agent tests and verify the section assumptions fail**

Run: `npm run test:unit -- --runInBand tests/unit/agent/add-field.test.ts tests/unit/agent/setup-library.test.ts tests/unit/agent/list-project-structure-documents.test.ts tests/unit/agent/system-prompt.test.ts tests/unit/agent/no-table-sections-static.test.ts`

Expected: FAIL on active section context, grouped previews, and tool schemas.

- [ ] **Step 3: Remove active-section browser and prompt context**

Delete `page-context.ts`. Remove `currentSectionName` from ChatPanel state, `ToolContext`, request serialization, context messages, and system prompts. Do not alter document heading/range terminology.

- [ ] **Step 4: Flatten Agent table tools**

`add_field` resolves only the library and calls `addFlatLibraryField(supabase, library.id, payload)`. Change Agent data access to return `FlatPropertyConfig[]`; `list_project_structure` emits `fields: properties.map(...)`. `setup_library` accepts `fields[]` without `section`, previews one ordered field list, and creates fields in order. Update preview UI copy and embedding metadata so table schemas contain fields, not groups.

- [ ] **Step 5: Run Agent tests and typecheck**

Run the command from Step 2.

Expected: PASS.

Run: `npm run typecheck`

Expected: no Agent or ChatPanel errors.

- [ ] **Step 6: Commit Agent cleanup**

```bash
git add src/components/agent src/lib/agent tests/unit/agent
git commit -m "refactor(agent): remove table section context"
```

### Task 7: Remove Sections from MCP Contracts and RPCs

**Files:**
- Modify: `supabase/functions/mcp/write-tools.ts`
- Modify: `supabase/functions/mcp/read-tools.ts`
- Modify: `supabase/functions/mcp/server.test.ts`
- Modify: `supabase/functions/mcp/account-tools.test.ts`
- Modify: `tests/unit/database/mcp-add-table-field-migration.test.ts`
- Modify: `tests/unit/database/mcp-atomic-writes.behavior.test.ts`
- Modify: `supabase/migrations/20260804010000_flatten_library_field_sections.sql`
- Modify: `docs/mcp/README.md`

- [ ] **Step 1: Write failing MCP schema and behavior assertions**

```ts
const createTable = tools.find((tool) => tool.name === 'create_table')!;
const fieldShape = createTable.inputSchema.properties.fields.items.properties;
assertEquals('section' in fieldShape, false);
assertEquals('sectionId' in fieldShape, false);
```

Update database fixtures so `FieldInput` has no section properties. After table creation and field append, assert RPC results omit `section`/`section_id` and stored definitions all use one section ID with order indexes `[0, 1, ...]`.

- [ ] **Step 2: Run MCP tests and verify they fail on advertised fields**

Run: `npm run test:mcp -- --filter "section|create_table|add_table_field"`

Expected: FAIL because `fieldSchema` still exposes `section` and `sectionId`.

- [ ] **Step 3: Remove MCP section inputs and result metadata**

Delete both optional properties from `fieldSchema`. Continue generating field IDs in TypeScript, but let SQL provide the compatibility columns. Remove section fields from read projections and result builders while leaving unrelated document-section language unchanged.

- [ ] **Step 4: Replace MCP SQL ordering and validation**

In both `mcp_create_table` and `mcp_add_table_field`, use:

```sql
v_section := '__keco_flat_fields__';
v_section_id := md5(p_table_id::text || '::keco-flat-fields');

select coalesce(max(f.order_index), -1) + 1
into v_order_index
from public.library_field_definitions f
where f.library_id = p_table_id;
```

Remove ambiguous/missing/cross-table section validation and omit section keys from `jsonb_build_object` results. Keep project ownership, type, enum, reference, required-field, grants, and timestamp checks unchanged.

- [ ] **Step 5: Update active MCP documentation and tests**

Describe tables as ordered fields in `docs/mcp/README.md`. Change the migration static test to assert whole-table `max(order_index)` and absence of section ambiguity branches.

- [ ] **Step 6: Run MCP, database static, and type checks**

Run: `npm run test:mcp`

Expected: PASS.

Run: `npm run test:unit -- --runInBand tests/unit/database/mcp-add-table-field-migration.test.ts tests/unit/database/flatten-library-fields-migration.test.ts`

Expected: PASS.

Run: `npm run check:mcp && npm run typecheck:api`

Expected: PASS.

- [ ] **Step 7: Commit MCP cleanup**

```bash
git add supabase/functions/mcp supabase/migrations/20260804010000_flatten_library_field_sections.sql \
  tests/unit/database/mcp-add-table-field-migration.test.ts \
  tests/unit/database/mcp-atomic-writes.behavior.test.ts docs/mcp/README.md
git commit -m "refactor(mcp): expose flat table fields"
```

### Task 8: Remove Residual Product-Facing Section Code

**Files:**
- Modify: `src/lib/agent/selection-context.ts`
- Modify: `src/lib/types/libraryAssets.ts`
- Modify: `src/lib/services/libraryAssetsService.ts`
- Modify: `src/components/libraries/utils/tableStructure.ts`
- Modify: `src/components/libraries/hooks/useTableCellFindReplace.ts`
- Modify: `src/components/libraries/components/TableCellFindReplace.tsx`
- Modify: `src/lib/utils/queryKeys.ts`
- Modify: `scripts/seed-via-api.ts`
- Modify: `supabase/seed.sql`
- Modify: `supabase/seed-remote.sql`
- Modify: affected tests under `tests/unit` and `tests/e2e`
- Create: `tests/unit/no-product-table-sections-static.test.ts`

- [ ] **Step 1: Add a scoped residual-code test**

Build a path allowlist for persistence compatibility files and assert table-product files contain none of these identifiers:

```ts
const banned = [
  /\bSectionConfig\b/,
  /\bactiveSectionId\b/,
  /\bsectionName\b/,
  /\bsectionId\b/,
  /keco-active-section/,
  /library:active-section/,
];

for (const file of tableProductFiles) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of banned) expect(source).not.toMatch(pattern);
}
```

Explicitly exclude migrations, `fieldCompatibility.ts`, raw database row types, document editors, page layout markup, email components, and historical design documents.

- [ ] **Step 2: Run the test and inspect every reported residual**

Run: `npm run test:unit -- --runInBand tests/unit/no-product-table-sections-static.test.ts`

Expected: FAIL with a finite list of remaining table-section references.

- [ ] **Step 3: Remove or rename each product-facing residual**

After all callers use the parallel flat API, delete `SectionConfig`, the old `PropertyConfig.sectionId` shape, `getLibrarySchema`, `addLibraryField`, and section CRUD services. Rename `FlatPropertyConfig` to `PropertyConfig`, `getFlatLibrarySchema` to `getLibrarySchema`, and `addFlatLibraryField` to `addLibraryField`, updating imports mechanically. Flatten find/replace and selection payloads, remove section query keys, update seed writers to use the compatibility helper-equivalent values, and update E2E fixtures/selectors that click or name section tabs. Do not remove unrelated HTML `<section>` elements, document headings, simulation panel sections, or email components.

- [ ] **Step 4: Run the residual test and impacted suites**

Run: `npm run test:unit -- --runInBand tests/unit/no-product-table-sections-static.test.ts tests/unit/agent/table-selection-context.test.ts tests/unit/agent/selection-context.test.ts`

Expected: PASS.

Run: `npm run typecheck && npm run typecheck:api`

Expected: PASS after the temporary flat API names and all grouped service exports are removed.

Run: `rg -n 'SectionConfig|activeSectionId|keco-active-section|library:active-section|sectionName|sectionId' src/components/libraries 'src/app/(dashboard)/[projectId]/[libraryId]' src/lib/agent supabase/functions/mcp`

Expected: no table-section matches; matches using “section” for bounded document reads are allowed and reviewed manually.

- [ ] **Step 5: Commit residual cleanup**

```bash
git add src scripts/seed-via-api.ts supabase/seed.sql supabase/seed-remote.sql tests
git commit -m "chore(tables): remove residual section code"
```

### Task 9: Full Verification and User-Facing Workflow Check

**Files:**
- Modify: `tests/e2e/specs/table-export-filter-navigation.spec.ts`
- Modify: `tests/e2e/specs/agent-chat.spec.ts`
- Modify: `tests/e2e/pages/predefined.page.ts`
- Modify: affected E2E fixtures under `tests/e2e/fixures`

- [ ] **Step 1: Update E2E expectations before production adjustments**

Add checks that a multi-field table shows all column headers simultaneously, the table has no section tabs/add-section button, Predefine shows one sortable field list, JSON/XLSX exports are flat, and Agent `add_field` succeeds without section context.

- [ ] **Step 2: Run the focused E2E tests**

Run: `npm run test:e2e -- tests/e2e/specs/table-export-filter-navigation.spec.ts tests/e2e/specs/agent-chat.spec.ts`

Expected: PASS after Tasks 1-8; any failure must be corrected in the owning task's files rather than weakening the assertion.

- [ ] **Step 3: Run complete static and unit verification**

Run: `npm run lint`

Expected: PASS with no warnings introduced by this work.

Run: `npm run typecheck && npm run typecheck:api && npm run check:mcp`

Expected: PASS.

Run: `npm run test:unit -- --runInBand`

Expected: PASS.

Run: `npm run test:mcp`

Expected: PASS.

- [ ] **Step 4: Build the production application**

Run: `npm run build`

Expected: Next.js production build completes successfully.

- [ ] **Step 5: Review the final diff and compatibility boundary**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only files belonging to this plan are staged or modified; pre-existing story extraction changes remain untouched.

Run: `rg -n '\b(section|section_id)\b' src supabase/functions/mcp --glob '*.{ts,tsx}'`

Expected: remaining table-related hits are limited to raw database compatibility writes in `fieldCompatibility.ts` consumers; unrelated document/layout/email uses are retained.

- [ ] **Step 6: Commit E2E adjustments and verification fixes**

```bash
git add tests/e2e
git commit -m "test(tables): cover flat field workflows"
```
