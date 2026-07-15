# Import Script Reference Table Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile audited Story IR into the selected 17-column table format and export story Libraries with the reference Excel presentation.

**Architecture:** Deterministic graph analysis produces playable Library rows and minimal compatibility extensions. A separate ExcelJS writer adds descriptions, styles, widths, and separator rows only during export.

**Tech Stack:** TypeScript, Jest 30, ExcelJS 4.4, Next.js 16, Supabase.

## Global Constraints

- Preserve the approved first 17 columns exactly.
- Store only playable rows in the Library.
- Keep LLM conversion/auditing, non-story exports, and non-LLM imports unchanged.
- Append fields only for option 3+ or unsafe option-command movement.
- Use `0_2.xlsx` as canonical where the references differ.

## File Map

- `src/lib/story-ir/tableFormat.ts`: shared schema and Excel metadata.
- `src/lib/story-ir/tableCompiler.ts`: graph-to-row compilation.
- `src/components/libraries/components/scriptPlayer.ts`: terminal control behavior.
- `src/lib/story-ir/storyWorkbook.ts`: story Excel generation.
- `src/app/api/export/route.ts`: writer selection.

### Task 1: Fixed Schema And Compiler

**Files:**
- Create: `src/lib/story-ir/tableFormat.ts`
- Modify: `src/lib/story-ir/tableCompiler.ts`
- Test: `src/lib/story-ir/tableCompiler.test.ts`

**Interfaces:**
- Produces: `STORY_BASE_COLUMNS`, `buildStoryColumns(maxOptions, commandOptionIndexes)`, `isStoryTableColumns(columns)`, and `compileStoryTable(document)`.
- Consumes: validated `StoryDocument` nodes, edges, options, and commands.

- [ ] **Step 1: Write failing schema and graph tests**

Require the exact base columns:

```ts
expect(compiled.columns).toEqual([
  'Label', 'Type', 'Name', 'Content', 'If', 'Commands', 'Fg', 'Fg1', 'Cg',
  'Option0', 'Option0_Next', 'Option1', 'Option1_Next',
  'Option2', 'Option2_Next', 'Voice', 'Bg',
]);
```

Add tests for physical fallthrough, minimal labels, non-linear jumps, independent terminals, safe unique/shared option commands, unsafe command extensions, option 3 extensions, missing targets, missing entry, and duplicate labels.

- [ ] **Step 2: Verify current behavior fails**

Run `npm run test:unit -- src/lib/story-ir/tableCompiler.test.ts --runInBand`.

Expected: FAIL because linear stories omit option columns and every option currently creates a command triplet.

- [ ] **Step 3: Add the shared format contract**

```ts
export const STORY_BASE_COLUMNS = [
  'Label', 'Type', 'Name', 'Content', 'If', 'Commands', 'Fg', 'Fg1', 'Cg',
  'Option0', 'Option0_Next', 'Option1', 'Option1_Next',
  'Option2', 'Option2_Next', 'Voice', 'Bg',
] as const;

export const STORY_COLUMN_DESCRIPTIONS = {
  Label: 'This is the jump target node',
  Type: '1 blue dialog box 2 pink 3 gray 4 no dialog box 5 screen center',
  Name: 'Speaker', Content: 'Dialogue content', If: 'Trigger condition', Commands: 'Commands',
  Fg: 'Show portrait on the left', Fg1: 'Show portrait on the right', Cg: 'Show CG',
  Voice: 'Voice-over path', Bg: 'Background image',
} as const;

export const STORY_COLUMN_WIDTHS = { Content: 51, Commands: 17, Bg: 14 } as const;
```

`buildStoryColumns` returns the base then extensions sorted by option index. `isStoryTableColumns` requires the exact base prefix and valid option extensions only.

- [ ] **Step 4: Implement graph analysis and compilation**

Use explicit incoming-edge and placement models:

```ts
type IncomingEdge =
  | { kind: 'entry' }
  | { kind: 'next'; sourceLabel: string }
  | { kind: 'option'; sourceLabel: string; optionIndex: number; commands: StoryCommand[] };

type OptionPlacement = {
  movedCommandsByTarget: Map<string, StoryCommand[]>;
  commandColumnIndexes: Set<number>;
};
```

Validate entry, labels, and all targets before emission. Move commands only when the target is not entry, every incoming edge is an option, and all incoming option command lists are identical. Prefix moved commands before target commands.

Emit labels only for entry, option targets, and non-fallthrough jump targets. Map `dialogue` to type `1` and all other Story IR node types to `2`. Use:

```ts
const physicalNext = document.nodes[index + 1]?.label;
const control = node.next
  ? node.next === physicalNext ? '' : `Jump ${node.next}`
  : node.options.length === 0 && index < document.nodes.length - 1 ? 'End' : '';
```

- [ ] **Step 5: Run tests and commit**

Run `npm run test:unit -- src/lib/story-ir/tableCompiler.test.ts --runInBand`; expect PASS.

Commit:

```bash
git add src/lib/story-ir/tableFormat.ts src/lib/story-ir/tableCompiler.ts src/lib/story-ir/tableCompiler.test.ts
git commit -m "refactor: compile stories to reference table schema"
```

### Task 2: Playback And Storage Compatibility

**Files:**
- Modify: `src/components/libraries/components/scriptPlayer.ts`
- Test: `src/components/libraries/components/scriptPlayer.test.ts`
- Modify: `src/lib/story-plan/projection.test.ts`
- Modify: `src/lib/services/scriptImportService.test.ts`

**Interfaces:**
- Consumes: fixed-base rows, optional `OptionN_Commands`, and `End`.
- Produces: exact-once variable execution and immediate terminal completion.

- [ ] **Step 1: Write failing playback tests**

Compile rows into `AssetRow` fixtures. Verify moved and retained option commands each execute once. For an independent ending require:

```ts
expect(state.done).toBe(true);
expect(state.variables.trust).toBe(expectedTrust);
expect(state.revealed).not.toContain(siblingBranchIndex);
```

- [ ] **Step 2: Verify dependent tests fail**

Run `npm run test:unit -- src/components/libraries/components/scriptPlayer.test.ts src/lib/story-plan/projection.test.ts src/lib/services/scriptImportService.test.ts --runInBand`.

Expected: FAIL because `End` is parsed as numeric and old tests expect command columns for every option.

- [ ] **Step 3: Handle exact End tokens**

```ts
function isStructuralCommand(source: string): boolean {
  return /^Jump\s+\S+$/i.test(source) || /^End$/i.test(source);
}

function hasEndCommand(value: string): boolean {
  return value.split(';').some((source) => /^End$/i.test(source.trim()));
}
```

After numeric commands run and before choices/jumps, return `done: true` when `hasEndCommand` passes. Continue rejecting every unknown non-structural command.

- [ ] **Step 4: Update projection and storage assertions**

Require the fixed base prefix, commands moved to unique trust-branch targets, and no unnecessary command extension. Give the four-option import fixture valid targets; expect base plus `Option3`/`Option3_Next`; assert inserted assets contain no `*` or description rows.

- [ ] **Step 5: Run compatibility tests and commit**

Run `npm run test:unit -- src/lib/story-ir/tableCompiler.test.ts src/components/libraries/components/scriptPlayer.test.ts src/components/libraries/utils/tableStructure.test.ts src/lib/story-plan/projection.test.ts src/lib/services/scriptImportService.test.ts --runInBand`; expect PASS.

Commit:

```bash
git add src/components/libraries/components/scriptPlayer.ts src/components/libraries/components/scriptPlayer.test.ts src/lib/story-plan/projection.test.ts src/lib/services/scriptImportService.test.ts
git commit -m "fix: preserve compiled story playback semantics"
```

### Task 3: Story Excel Writer

**Files:**
- Create: `src/lib/story-ir/storyWorkbook.ts`
- Create: `src/lib/story-ir/storyWorkbook.test.ts`

**Interfaces:**
- Produces: `writeStoryXlsxWorkbook(sheet): Promise<Uint8Array>` and `buildStoryWorkbookSheet(name, properties, rows)`.
- Consumes: shared schema detection, descriptions, and widths from Task 1.

- [ ] **Step 1: Write a failing ExcelJS round-trip test**

Generate and reload a choice sheet with an `Option0_Commands` extension. Assert exact header and description rows; fill `FFD9F3FD`; Calibri 10; vertical middle and wrapping; widths `D=51`, `F=17`, `Q=14`; a `*` row and blank row after the choice; and unchanged following narrative data.

Also test that exact and extended schemas are detected, while reordered, incomplete, and generic schemas are rejected.

- [ ] **Step 2: Verify the writer test fails**

Run `npm run test:unit -- src/lib/story-ir/storyWorkbook.test.ts --runInBand`.

Expected: FAIL because the writer does not exist.

- [ ] **Step 3: Implement the focused writer**

```ts
export type StoryWorkbookSheet = {
  name: string;
  columns: string[];
  rows: Array<Array<string | number | boolean | null>>;
};
```

Add row 1 from columns and row 2 from the description map. Option text/next descriptions are empty; `/^Option\d+_Commands$/` uses `Option commands` and width 17. Add every playable row, then add `*` in column A plus one blank row after any row containing a non-empty `/^Option\d+$/` cell.

Style rows 1 and 2 exactly:

```ts
cell.font = { name: 'Calibri', size: 10 };
cell.fill = {
  type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9F3FD' },
};
cell.alignment = { vertical: 'middle', wrapText: true };
```

Return `new Uint8Array(await workbook.xlsx.writeBuffer())`.

- [ ] **Step 4: Implement the pure selector**

```ts
export function buildStoryWorkbookSheet(
  name: string,
  properties: Array<{ name: string }>,
  rows: StoryWorkbookSheet['rows']
): StoryWorkbookSheet | null {
  const columns = properties.map((property) => property.name);
  return isStoryTableColumns(columns) ? { name, columns, rows } : null;
}
```

- [ ] **Step 5: Run tests and commit**

Run `npm run test:unit -- src/lib/story-ir/storyWorkbook.test.ts --runInBand`; expect PASS.

Commit:

```bash
git add src/lib/story-ir/storyWorkbook.ts src/lib/story-ir/storyWorkbook.test.ts src/lib/story-ir/tableFormat.ts
git commit -m "feat: export stories with reference workbook format"
```

### Task 4: Export Integration And Full Verification

**Files:**
- Modify: `src/app/api/export/route.ts`
- Modify: `src/lib/story-ir/tableCompiler.test.ts`
- Modify: `src/components/libraries/components/scriptPlayer.test.ts`
- Fixture: `tests/fixtures/import-script/nested-trust-story.txt`
- Fixture: `tests/fixtures/import-script/rainy-manor-story.txt`

**Interfaces:**
- Consumes: `buildStoryWorkbookSheet` and `writeStoryXlsxWorkbook`.
- Produces: specialized story downloads and unchanged generic downloads.

- [ ] **Step 1: Select the story writer for one detected sheet**

Retain `const exportedSectionProps: PropertyConfig[][] = []` beside `outputSheets`, push each ordered `sectionProps` during the section loop, and retain playable `sheetRows`. After sheet construction:

```ts
const storySheet = outputSheets.length === 1
  ? buildStoryWorkbookSheet(
      outputSheets[0].name,
      exportedSectionProps[0],
      outputSheets[0].rows.slice(1)
    )
  : null;

const buf = storySheet
  ? await writeStoryXlsxWorkbook(storySheet)
  : await writeXlsxWorkbook(outputSheets);
```

Keep generic `name (datatype)` headers for non-story files, pass no generic header to the story writer, and do not change JSON export.

- [ ] **Step 2: Run focused regression tests**

Run `npm run test:unit -- src/lib/story-ir/tableCompiler.test.ts src/components/libraries/components/scriptPlayer.test.ts src/components/libraries/utils/tableStructure.test.ts src/lib/story-plan/projection.test.ts src/lib/services/scriptImportService.test.ts src/lib/story-ir/storyWorkbook.test.ts --runInBand`.

Expected: PASS.

- [ ] **Step 3: Verify the two real fixtures**

The nested trust fixture must terminate with trust values `2`, `0`, `4`, and `0`. The rainy-manor fixture must keep east and west endings isolated. Print both compiled tables for user review.

- [ ] **Step 4: Run full verification**

Run these commands independently and require success:

```bash
npm run test:unit -- --runInBand
npm run typecheck
npm run typecheck:api
npm run lint
npm run build
git diff --check
```

Expected: all suites and builds pass, ESLint has zero errors, and `git diff --check` prints nothing.

- [ ] **Step 5: Commit integration**

```bash
git add src/app/api/export/route.ts src/lib/story-ir src/components/libraries/components/scriptPlayer.ts src/components/libraries/components/scriptPlayer.test.ts src/lib/story-plan/projection.test.ts src/lib/services/scriptImportService.test.ts
git commit -m "feat: match imported story reference table format"
```

- [ ] **Step 6: Produce review evidence**

Print for each fixture: all columns; row index; non-empty `Label`, `Type`, `Name`, `Content`, and `Commands`; every non-empty option cell; workbook dimensions, descriptions, widths, and separator indexes. Confirm Library rows contain no presentation artifacts.
