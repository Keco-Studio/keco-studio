# Import Script Reference Table Format Design

## Goal

Make Story IR imports produce a playable Library table whose base schema and control-flow layout match the selected reference workbooks `0_1.xlsx` and `0_2.xlsx`, while preserving advanced story features that the fixed reference format cannot represent by itself.

The first 17 columns, in order, are:

1. `Label`
2. `Type`
3. `Name`
4. `Content`
5. `If`
6. `Commands`
7. `Fg`
8. `Fg1`
9. `Cg`
10. `Option0`
11. `Option0_Next`
12. `Option1`
13. `Option1_Next`
14. `Option2`
15. `Option2_Next`
16. `Voice`
17. `Bg`

## Scope

This change covers deterministic Story IR table compilation, Library playback compatibility, and story-specific Excel export presentation.

It does not change the LLM provider or ask an LLM to construct spreadsheet rows. The Converter and Auditor continue to identify and independently review story semantics. Deterministic code remains responsible for table layout, command placement, validation, database writes, and Excel presentation.

Non-story Library exports keep their existing generic format.

## Data And Presentation Boundary

The Library stores only playable story rows and fields. It must not store spreadsheet-only presentation artifacts.

The following elements exist only in downloaded Excel files:

- the second-row Chinese field descriptions;
- light-blue header and description styling;
- reference-compatible column widths, fonts, alignment, and wrapping;
- the `*` row and following blank visual separator after a choice row.

The Excel exporter creates these artifacts from the stored playable table. The player and Library editor therefore never interpret them as story nodes.

## Compiler Contract

`compileStoryTable` always emits the fixed 17-column base contract, including all three option pairs even when a story uses fewer than three options.

Extension columns are appended only when the story cannot be represented without losing behavior:

- `Option3`, `Option3_Next`, and subsequent option pairs represent a fourth or later option;
- `OptionN_Commands` represents an option command that cannot safely be moved to its target node.

An extension command column is emitted only for the option index that needs it. The fixed first 17 columns never change order.

## Row Layout And Control Flow

The compiler lays out nodes in deterministic story order and uses physical row fallthrough for ordinary sequential playback.

A row receives a `Label` only when it is:

- the story entry row;
- an option target;
- a target of a non-fallthrough jump;
- a merge, loop, or other control-flow target that must be addressable.

Ordinary sequential rows have an empty `Label`. A transition to the immediately following playable row does not emit `Jump`. Explicit jumps are reserved for non-linear transitions such as choices, branch merges, loops, and transitions that skip rows.

`OptionN_Next` uses the existing `Jump <label>` syntax. When a branch must merge without attaching the jump to narrative content, the compiler may emit a standalone playable control row with only its required label or command fields populated. Such a row is semantic data, unlike the Excel-only separator rows.

## Type Mapping

The generated table preserves current parser and player behavior:

- Story IR `dialogue` nodes compile to `Type = 1`;
- Story IR `narration`, `scene`, and `system` nodes compile to `Type = 2`.

The reference description documents these additional meanings:

- `1`: blue dialogue box;
- `2`: pink dialogue box;
- `3`: gray dialogue box;
- `4`: no dialogue box;
- `5`: centered screen text.

The current Story IR does not encode blue, pink, gray, hidden, or centered presentation independently from its semantic node type, and the player currently distinguishes only types 1 and 2. The compiler therefore does not infer types 3 through 5. Supporting those distinctions requires a separate Story IR and player design.

## Option Command Placement

Option commands must execute exactly once when the user chooses the option.

The compiler may move an option's commands into the target row's `Commands` only when that move is behaviorally unambiguous. It is safe when the target is an entry unique to that option, or when every incoming option that reaches the target contributes the same commands.

The compiler must retain `OptionN_Commands` when moving the commands would alter behavior. This includes a shared target reached by options with different commands and any target that can also be entered through a path that must not execute the option command.

When commands are safely moved, they execute before the target node's existing commands. Command order is stable, and command sources come from validated Story IR commands rather than text parsing or regeneration.

## Deterministic Validation

Compilation fails before database writes when any of these conditions holds:

- an option or jump target does not exist;
- the entry point is missing or ambiguous;
- generated rows have inconsistent column counts;
- a required target lacks an addressable label;
- a command would be dropped, duplicated, or moved to a path where it should not execute;
- generated fallthrough or jumps change Story IR reachability;
- an extension column name collides with the fixed base schema.

Errors identify the relevant node, option, target, or command. Existing import cleanup remains responsible for removing a newly created Library if a later database write fails, so partial tables are not retained.

## Excel Export

The export route detects a story Library from its ordered field contract, not from its Library name. A story-specific workbook formatter then produces the reference presentation:

- exact fixed base-column order followed by any extension columns;
- a header row containing field names without generic data-type suffixes;
- a second row containing the reference descriptions;
- light-blue fill `FFD9F3FD` for the header and description rows;
- Calibri 10, vertical middle alignment, and wrapped text;
- reference-compatible widths, including a wide `Content` column and suitable `Voice` and `Bg` widths;
- a `*` row followed by a blank row after each row containing choices.

The canonical second row is:

| Column | Description |
| --- | --- |
| `Label` | `Jump target node` |
| `Type` | `1 blue dialog box, 2 pink, 3 gray, 4 no dialog box, 5 screen center` |
| `Name` | `Speaker` |
| `Content` | `Dialogue content` |
| `If` | `Trigger condition` |
| `Commands` | `Commands` |
| `Fg` | `Show portrait on the left` |
| `Fg1` | `Show portrait on the right` |
| `Cg` | `Show CG` |
| `Option0` through `Option2_Next` | empty |
| `Voice` | `Voice-over path` |
| `Bg` | `Background image` |

`0_2.xlsx` is the canonical source where the two references differ. Accordingly, `Content` has width 51, `Commands` has width 17, and `Bg` has width 14. Other base columns retain Excel's default width, matching the reference. `0_1.xlsx` remains a compatibility fixture for the same schema and styling but does not override these canonical values.

Appended `OptionN` and `OptionN_Next` columns use an empty description and the default width, consistent with the three base option pairs. Appended `OptionN_Commands` columns use description `Option commands` and width 17, matching `Commands`.

The exporter must not change stored rows. Re-importing a downloaded story workbook is outside this work and is not an acceptance criterion. The general workbook importer will not be changed.

## Compatibility

The player must continue to support:

- legacy fixed 17-column story tables;
- newly compiled fixed-base tables;
- tables with `OptionN_Commands` extensions;
- tables with `Option3` and later dynamic option extensions.

Existing non-LLM script import remains unchanged.

## Tests

Compiler unit tests cover:

- fixed 17-column output for linear stories;
- zero to three options without unnecessary extension columns;
- four or more options with appended extension columns;
- physical fallthrough and minimal labels;
- nested branches, merges, independent endings, loops, and skipped rows;
- safe option-command movement;
- shared-target and alternate-entry cases that require `OptionN_Commands`;
- rejection of missing targets and command-loss conditions.

Playback regression tests cover legacy, fixed-base, and extended tables. The trust-variable story verifies all four paths and final values. The rainy-mansion story verifies that the east and west branches reach only their own endings.

Excel tests generate a workbook and read it back with ExcelJS. They compare field order, descriptions, cell content, styles, widths, and choice separators against normalized fixtures derived from `0_1.xlsx` and `0_2.xlsx`. Story content and row count may differ; the format contract may not.

Final verification includes relevant Jest suites, Web and API TypeScript checks, ESLint, the Next.js production build, and `git diff --check`.

## Acceptance Criteria

- A simple story creates a Library with exactly the fixed 17 base fields.
- Complex stories append only the extension fields necessary to preserve behavior.
- Sequential rows, branch labels, choices, jumps, merges, and commands play with the same semantics as the audited Story IR.
- Neither Excel descriptions nor visual separator rows appear as Library assets.
- Downloaded story workbooks match the selected reference format's schema and presentation.
- Other Library exports and existing story tables remain compatible.
