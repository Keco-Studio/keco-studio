# Design Document → Tables, as a Field-Type-Aware Skill

**Date**: 2026-06-15
**Status**: Draft (pending review)
**Supersedes (partially)**: Section 4 (Agent Prompt Enhancement) of `2026-06-15-design-document-to-tables-design.md`
**Scope**: Make the "upload design document to auto-create tables" Agent truly understand keco-studio's field attribute system, and package this capability as a reusable skill

---

## 1. Background and Problem

The previous version implemented the full pipeline: upload page → frontend parsing (mammoth) → sessionStorage handoff → ChatPanel auto-sends a user message "containing the full document text" → Agent calls `setup_library` / `update_row` to set up tables.

**Observed problem in practice**: The Agent **does not know which field attributes (dataType) keco-studio supports, nor the usage constraints of each type**. When designing fields it tends to:

- Guess nonexistent types (e.g. `text` / `number` have aliases as a fallback, but `link`, `color`, `json`, etc. fail outright)
- Not know that `enum` requires `enumOptions`, `reference` requires `referenceLibraries`, and `formula` requires `formulaExpression`
- Not know that array types (`*_array`) and `multimedia` / `audio` exist and when they apply
- Not know that reference fields (`reference`) can link tables together, so it flattens what should be "references" into strings

Root cause: field type knowledge exists only scattered in the `dataType` parameter descriptions of `setup_library` / `add_field` (a single comma-separated line of names, with no semantics, no constraints, no examples). When "designing a whole set of tables from scratch", the Agent lacks an authoritative, structured capability catalog.

---

## 2. Goals

1. **Single source of truth**: Centralize all keco-studio field types (name, semantics, data write format, config requirements, examples, applicable scenarios) into one catalog module.
2. **Let the Agent proactively fetch the capability list**: Add a read-category skill `list_field_types`; the Agent calls it before table setup to get the full catalog (executes immediately, no confirmation needed).
3. **Formalize "tables from documents" into a disciplined process**: Strengthen the prompt rules, requiring the Agent to first call `list_project_structure` + `list_field_types`, then design fields, give a summary, create tables, and fill data.
4. **Do not break existing functionality**: `setup_library` / `add_field` / `update_row` interfaces stay unchanged; only align their dataType descriptions with the catalog.

### Non-goals

- Do not turn "document reasoning → table creation" into a deterministic, code-orchestrated tool (this step is fundamentally LLM reasoning and cannot be de-LLM-ified).
- Do not change document parsing, the upload page, or the sessionStorage handoff (already implemented and working).
- Do not add database migrations or change the field types themselves.

---

## 3. Aligning on the Definition of "skill"

keco-studio already has a "skill" concept in code: the comment in `src/lib/agent/workflows/index.ts` reads *"Skill registry"*, and the existing skills are `setup_library`, `update_row`, and `set_reference` — all `AgentTool`s registered into `allTools`.

Therefore in this spec, "skill" = **an `AgentTool` registered into `workflows/`**, consistent with the existing system.

> Design trade-off: existing skills are mostly `post_preview` (execute produces a preview → confirm → executeImport writes to DB). This `list_field_types` is a **read-only knowledge skill**, using `category: 'read'`; per the Agent Core's existing logic it will "execute immediately, without confirmation, feeding the result back to the LLM" (see `needsConfirmation` in `core.ts`: read tools always execute directly). This is the cleanest way to feed "capability knowledge" to the Agent.

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────┐
│ field-type-catalog.ts  (single source of truth / SSOT)      │
│  - Each dataType: name + aliases + semantics + data format  │
│    + config keys + examples + applicable scenarios          │
└───────────────┬───────────────────────┬────────────────────┘
                │                        │
    derive      │                        │  consume
 ┌──────────────▼─────────┐   ┌──────────▼───────────────────┐
 │ field-data-type.ts     │   │ list_field_types (read skill) │
 │  normalizeFieldDataType│   │  execute() → returns catalog  │
 │  SUPPORTED_FIELD_...   │   └──────────┬───────────────────┘
 └────────────────────────┘              │ in-context knowledge
                                          ▼
                              ┌───────────────────────────┐
                              │ Agent (ReAct loop)        │
                              │ 1 list_project_structure  │
                              │ 2 list_field_types        │
                              │ 3 design fields (valid    │
                              │   types only)             │
                              │ 4 output table plan       │
                              │   summary                 │
                              │ 5 setup_library (create)  │
                              │ 6 update_row/create_asset │
                              └───────────────────────────┘
        ▲
        │ dataType parameter descriptions aligned with catalog
 ┌──────┴───────────────────────────┐
 │ setup_library / add_field         │
 └───────────────────────────────────┘
```

---

## 5. Field Type Catalog (SSOT)

### 5.1 New file `src/lib/agent/field-type-catalog.ts`

Define a structured catalog as the single source of the type system. Structure sketch:

```typescript
export interface FieldTypeSpec {
  /** Canonical dataType used by PropertyConfig. */
  dataType: PropertyConfig['dataType'];
  /** Human label shown to the agent. */
  title: string;
  /** What this type is for. */
  description: string;
  /** How a cell value must be written via create_asset / update_row. */
  valueFormat: string;
  /** Extra config keys required by this type (for setup_library / add_field). */
  requiredConfig?: ('enumOptions' | 'referenceLibraries' | 'formulaExpression')[];
  /** Media types: agent may create the column but must leave cells empty. */
  isMedia?: boolean;
  /** When the agent should pick this type. */
  whenToUse: string;
  /** A short concrete example. */
  example: string;
  /** Accepted aliases that normalize to this type. */
  aliases?: string[];
}

export const FIELD_TYPE_CATALOG: FieldTypeSpec[] = [ /* ...15 entries... */ ];
```

### 5.2 Catalog contents (15 canonical types)

Types marked `isMedia` in the "tables from documents" scenario get **only an empty column created, with no data filled in** (the Agent cannot upload files; images inside the document are ignored).

| dataType | Semantics | Data write format | Required config | isMedia | When to use |
|----------|------|--------------|----------|:---:|----------|
| `string` | Text | String | — | | Names, descriptions, any text |
| `string_array` | Text array | Array of strings | — | | Tags, alias lists |
| `int` | Integer | Integer | — | | Quantities, levels, ID-like numbers |
| `int_array` | Integer array | Array of integers | — | | Multiple integers (e.g. multi-stage values) |
| `float` | Float | Number | — | | Prices, probabilities, coefficients |
| `float_array` | Float array | Array of numbers | — | | Multiple decimals |
| `boolean` | Boolean | true/false | — | | Enabled/disabled, toggles |
| `enum` | Enum | String taken from enumOptions | `enumOptions` | | Fixed option sets (type, rarity) |
| `date` | Date | Date string | — | | Times, version dates |
| `reference` | Reference to another table | Reference target (assetId+fieldId) | `referenceLibraries` | | Linking tables (character → faction) |
| `formula` | Formula | Computed from an expression | `formulaExpression` | | Derived values (total = price × quantity) |
| `image` | Image | Media asset (upload) | — | ✅ | Character art, avatars, icons |
| `file` | Arbitrary file | Media asset (upload) | — | ✅ | Attachments, resource files |
| `multimedia` | Image/video | Media asset (upload) | — | ✅ | Multimedia assets |
| `audio` | Audio | Media asset (upload) | — | ✅ | Voice-over, sound effects |

> **Media column design principle**: `image`/`file`/`multimedia`/`audio` are legitimate column types that should exist — when concepts like "character art", "avatar", or "icon" appear in a design document, the Agent **should create the corresponding `image` column** (likewise for other media). It is only that the **cell data** for these columns must be uploaded manually by the user later; during document-based table setup the Agent **only creates the column and leaves it empty**, and must not fabricate media values or file paths.
>
> Implementation note: `CANONICAL_DATA_TYPES` in `field-data-type.ts` currently does not include `image`/`file`; this change must add them (both values already belong to `PropertyConfig.dataType`, the predefine manual table-creation UI's `FIELD_TYPE_OPTIONS` already offers Image/File options, and `MediaCell` already renders by `'image' | 'file' | 'multimedia' | 'audio'`). Also add common aliases for them (e.g. picture → image, attachment → file).

### 5.3 `field-data-type.ts` refactor

- `SUPPORTED_FIELD_DATA_TYPES` becomes derived from `FIELD_TYPE_CATALOG` (`catalog.map(c => c.dataType)`), eliminating drift between two lists.
- The alias table is merged into the catalog's `aliases`; `normalizeFieldDataType` builds the alias mapping from the catalog.
- Behavior remains unchanged (same input → same canonical type); only the source becomes singular.

---

## 6. New skill: `list_field_types`

### 6.1 File `src/lib/agent/workflows/list-field-types.ts`

```typescript
export const listFieldTypes: AgentTool = {
  name: 'list_field_types',
  description:
    'List all field (column) data types supported by keco-studio, including each ' +
    'type\'s meaning, how to write its cell value, required config (enumOptions / ' +
    'referenceLibraries / formulaExpression), and when to use it. Call this BEFORE ' +
    'designing tables/fields (e.g. when building tables from a design document) so ' +
    'you only use real, valid field types. No parameters.',
  category: 'read',
  confirmationMode: 'pre_execute', // read → actually executes immediately, no confirmation
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => ({
    success: true,
    displayHint: 'list',
    data: { fieldTypes: FIELD_TYPE_CATALOG },
  }),
};
```

### 6.2 Registration

- `workflows/index.ts`: add `listFieldTypes` to `allSkills`.
- No change needed to `tools/index.ts` (it already has `...allSkills`) or the ReAct loop.

---

## 7. Aligning Existing Tool Descriptions

Generate the `dataType` parameter descriptions of `setup_library` and `add_field` from the catalog as a **concise but complete** string (a one-sentence meaning per type + config hints), replacing the current "comma-separated type names" approach. For example:

```
Field data type. One of:
  string(text) | string_array | int | int_array | float | float_array |
  boolean | enum(needs enumOptions) | date |
  reference(needs referenceLibraries) | formula(needs formulaExpression) |
  multimedia(image/video) | audio.
Call list_field_types for full semantics and examples.
```

Extract a helper (e.g. `buildDataTypeParamDescription()` in the catalog module) reused in both places to avoid future drift.

---

## 8. Prompt Rule Update (replaces rule 28 from the previous version)

Rewrite the existing rule 28 into a version emphasizing "fetch the capability list first, use valid types only":

```
28. DESIGN DOCUMENT -> TABLES: When the user uploads a design document
    (message starts with "[Design document]") and asks to build tables:
    - FIRST call list_project_structure (existing layout) AND list_field_types
      (supported field types + their config + how to write values).
    - Design fields using ONLY the dataTypes returned by list_field_types.
    - Use reference (with referenceLibraries) to link related tables instead of
      flattening relations into strings; use enum (with enumOptions) for fixed
      option sets; use formula (with formulaExpression) for derived values;
      use *_array for multi-valued cells.
    - For visual/asset concepts in the document (character art/avatar/icon/
      attachment/voice-over etc.),
      DO create the matching media column (image / file / multimedia / audio),
      but leave its cells EMPTY — the user uploads media later. Never invent
      media values, URLs, or file paths.
    - Present a concise summary of all planned tables and their fields BEFORE
      creating anything.
    - Create each table with setup_library, then fill non-media rows with
      update_row / create_asset.
    - Match the document language for all table/field/data names.
```

`buildDesignMessage` (already exists from the previous version) may add one hint sentence guiding the Agent to follow this process (optional; the prompt rule is the main driver).

---

## 9. Affected Files

| File | Action |
|------|------|
| `src/lib/agent/field-type-catalog.ts` | New (SSOT + helper; includes image/file/multimedia/audio, marked isMedia) |
| `src/lib/agent/field-data-type.ts` | Refactor to derive from catalog; add image/file + aliases to `CANONICAL_DATA_TYPES` |
| `src/lib/agent/workflows/list-field-types.ts` | New read skill |
| `src/lib/agent/workflows/index.ts` | Register `listFieldTypes` |
| `src/lib/agent/tools/add-field.ts` | Align dataType description with catalog |
| `src/lib/agent/workflows/setup-library.ts` | Align dataType description with catalog |
| `src/lib/agent/prompts.ts` | Rewrite rule 28 |
| `src/lib/design-message.ts` | (Optional) add one process-guidance sentence |
| `src/app/(dashboard)/[projectId]/[libraryId]/predefine/validation.ts` | Drive-by fix: complete the dataType enum (see §10) |

---

## 10. Drive-by Fix: Incomplete Type Enum in predefine/validation.ts

Current state: the zod enum for `fieldSchema.dataType` only includes the 9 types `string/int/float/boolean/enum/date/image/file/reference`,
missing `multimedia/audio/int_array/float_array/string_array/formula`.

Additional fact: `sectionSchema` / `fieldSchema` are currently **only imported, never called** in `page.tsx` and `NewSectionForm.tsx`
(saving actually goes through `saveSchemaIncremental`), so this validation never takes effect at runtime — which is exactly why the incomplete type list has not caused production issues.

Fix plan:
- Build the `fieldSchema.dataType` enum from the single source `SUPPORTED_FIELD_DATA_TYPES` (catalog-derived, including image/file),
  e.g. `z.enum(SUPPORTED_FIELD_DATA_TYPES as [string, ...string[]])`, eliminating list drift.
- **Do not change how it is called** (no new `.parse()` calls), to avoid introducing unvetted interception into the predefine save path and to limit the regression surface.
- The import direction is UI → `lib/agent/field-data-type` (a pure domain utility with no agent runtime dependency), which is acceptable.

Testing: unit tests assert `fieldSchema` accepts all `SUPPORTED_FIELD_DATA_TYPES` and rejects unknown types.

---

## 11. Testing Strategy (TDD)

| Test | Coverage | Tool |
|------|------|------|
| Unit | `FIELD_TYPE_CATALOG` covers exactly `CANONICAL_DATA_TYPES` (including image/file, nothing missing or extra) | Jest |
| Unit | `normalizeFieldDataType` behavior unchanged after refactor; new image/file + aliases (picture/attachment) resolve correctly | Jest |
| Unit | `setup_library` accepts image/file as valid dataTypes (no longer reports unsupported) | Jest |
| Unit | `list_field_types.execute()` returns all types, media types carry the isMedia flag | Jest |
| Unit | `buildDataTypeParamDescription()` contains all canonical type names | Jest |
| Manual | Run through a real design document, confirm the Agent calls list_field_types first and picks types sensibly (incl. reference/enum) | — |

---

## 12. Risks and Regressions

- **Low**: the `field-data-type.ts` refactor must guarantee `normalizeFieldDataType` / `SUPPORTED_FIELD_DATA_TYPES` behave identically, backed by the existing unit tests of current callers (`setup_library`, `add_field`).
- The new read skill triggers no confirmation and writes nothing to the DB; no side effects.
- Tool description changes only affect the schema text sent to the LLM, not runtime validation logic.
- The prompt rule count stays at 28 (replacement, not addition), so other rule numbers are unaffected.

---

## 13. Future Enhancements

- Add "example value JSON for each type in create_asset/update_row" to the catalog to further reduce data-filling errors.
- Let `list_field_types` optionally return "libraries that already exist in the current project" to aid reference type selection (or keep that with `list_project_structure`).
- Table setup template presets (common game genres).
