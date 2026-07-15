# Agent Self-Authoring Data — Schema-Aware Writes Design Spec

**Date:** 2026-06-18
**Status:** Draft
**Scope:** Enable the Agent to "think correctly and fill completely on its own" when writing table data — elevate the target table's structural contract (columns / required / legal enum values / reference targets / value format) into a first-class input for the model, and use strict validation to turn errors into readable, self-correctable feedback.
**Related:** [2026-06-15-design-document-to-tables-design.md](./2026-06-15-design-document-to-tables-design.md), [2026-06-17-agent-auto-execute-design.md](./2026-06-17-agent-auto-execute-design.md), [2026-06-10-keco-studio-agent-design.md](./2026-06-10-keco-studio-agent-design.md)

---

## 1. Overview

### 1.1 Problem

When users upload design documents for the Agent to automatically create tables and fill in data, a recurring problem is "it looks like it's filling, but actually misses / gets it wrong":

- The write tool returns `success`, but cells are empty (the model sent `propertyValues: {}`).
- Enum columns get fabricated values written (e.g. `Recharge Currency`, while the legal values only include `Paid Currency`), and the UI shows blanks.
- The primary label column (`Rule Name` / `Item Name`, etc.) is not filled; the row has data but the first column is blank, making it look like "creation failed".
- `string_array` gets wrapped as `[["a","b"]]`, values get wrapped as `{"item": ...}`.

These have been patched one by one via after-the-fact guardrails (`isExplicitEmptyPropertyValues`, `validateEnumPropertyValues`, `flattenArrayCellValue`, `findPrimaryLabelField`), but this is "correct after the mistake" — treating symptoms, not the cause.

### 1.2 Root Cause

**The write tools are a "blind write" for the model.** Currently the `propertyValues` of `create_asset` / `update_asset` / `update_row` is a completely free-form `Record<string, unknown>`, and its tool schema only says "write values by field name" — **it contains none of the target table's contract**:

```12:18:src/lib/agent/field-resolver.ts
export interface FieldResolution {
  /** fieldId -> value, ready for createAsset/updateAsset propertyValues. */
  resolved: Record<string, unknown>;
  /** Semantic field names that could not be matched. */
  unresolved: string[];
  /** All available field labels for the library (for error feedback to the LLM). */
  availableFields: string[];
}
```

The model can only rely on "memory" — it defined the fields during `setup_library`, or called `list_field_types` (which is only a **global type catalog**, not **the contract of this specific table**). After long conversations flush the context, it forgets columns, misses required fields, and guesses enums.

**Gap summary:**

| Gap | Current state | Impact |
|------|------|------|
| No per-library schema tool | Only the global `list_field_types` | The model doesn't know which columns "this table" has, which are required, or which enum to pick |
| Write tool schema carries no contract | `propertyValues` is a free-form object | The model relies on memory, drifting after long contexts |
| Validation is after-the-fact backstop | empty/enum/array/name are all intercepted at write time | Error feedback is unstructured; hard for the model to correct in one shot |
| Free-form JSON structure is fragile | MiniMax-M3 easily produces `{}` / nested arrays / `{item}` | Each case needs individual normalization |

### 1.3 Decision

**Make the "table structure contract" a standard input before the Agent writes data, and upgrade validation from "after-the-fact backstop" to "up-front guidance + structured self-correction loop".**

Proceed in **phases**:

- **Phase 1 (incremental enhancement / short-term stopgap)**: Without touching existing tool signatures, add a `get_library_schema` read tool, consolidate the scattered guardrails into a unified "schema validation layer" that returns structured correction info, return a "fill-in memo" after `setup_library` succeeds, and tighten the prompt.
- **Phase 2 (tool refactor / long-term direction)**: Structurally reduce the model's error space — **dynamically generate the write tools' JSON Schema** based on the currently active library (`propertyValues` precisely lists fields + enum constraints), optionally introducing step-by-step atomic write tools.

Validation strictness: **Strict** — missing required, illegal enum, and illegal reference all raise errors telling the model "what's missing/wrong and how to fill it", forcing the model to complete the data rather than silently succeeding.

### 1.4 Goals

| Goal | Description |
|------|------|
| **G1** | Before writing to a table, the model can obtain the table's complete contract with one tool call (columns / dataType / required / enumOptions / referenceLibraries / valueFormat / primary label column / current row count) |
| **G2** | Write validation is Strict: missing required / illegal enum / illegal reference → structured error containing "what's missing + legal format for each field" |
| **G3** | Validation failure messages can be directly consumed by the model to self-correct in the next turn (self-correction loop), with no user intervention |
| **G4** | After `setup_library` succeeds, the result includes an "example propertyValues for filling one row" of that table, reducing "forget right after creating" |
| **G5** | Existing after-the-fact guardrails (empty/enum/array/name) are consolidated into the unified validation layer with no behavioral regression |
| **G6** | Phase 2 provides a structurally error-proof path (dynamic schema / atomic tools), but is decoupled from Phase 1 and can be evaluated independently |

### 1.5 Non-Goals

- Do not decide for the model "which tables to create or what business content to fill" — business reasoning remains with the LLM (this is precisely the "think for itself" part; not hard-coded).
- Phase 1 does not change the external parameter signatures of `create_asset` / `update_asset` / `update_row`.
- No new LLM provider or fine-tuning (that belongs to a separate optimization track).
- No data rollback / versioning (see the F5 mindset in the auto-execute spec).

---

## 2. Core Idea — Contract Before Write

```
Current state (blind write):
  LLM ──fields from memory?── create_asset({any field: any value}) ──→ silent success / after-the-fact backstop

Target (contract-driven + self-correction):
  LLM ──get_library_schema──→ obtain the table's complete contract
      ──create_asset(fill per contract)──→ schema validation
          ├─ pass → write
          └─ fail → structured error (missing required X / illegal enum / bad format + legal format per field)
                     ──→ LLM self-corrects next turn ──→ write again
```

Key shift: **make the "table structure" queryable at any time in the conversation and enforce alignment at write time**; the model's "thinking" focuses on business content, while "format / contract" is guaranteed visible and correctable by the system.

---

## 3. Phase 1 — Incremental (Short-Term)

### 3.1 T1: Add the `get_library_schema` read tool

**Purpose**: Give the model an entry point to "the contract of this specific table", filling the gap between `list_field_types` (global) and `query_assets` (data; only returns `columns` names).

**Location**: `src/lib/agent/workflows/get-library-schema.ts` (read tool, no confirmation required, modeled on the structure of `list-field-types.ts`).

**Parameters**:

```typescript
{
  libraryName?: string; // omit to use ctx.currentLibraryName
}
```

**Returns** (based on existing `getLibraryProperties` + `FIELD_TYPE_CATALOG`):

```typescript
{
  libraryId: string;
  libraryName: string;
  rowCount: number;            // current non-empty row count (hints that create_asset will reuse empty rows)
  primaryLabelField: string;   // result of findPrimaryLabelField (Name/Rule Name/...)
  fields: Array<{
    label: string;             // semantic field name (use this key when writing propertyValues)
    dataType: FieldDataType;
    required: boolean;
    valueFormat: string;       // from FIELD_TYPE_CATALOG[dataType].valueFormat
    enumOptions?: string[];    // enum columns: legal values (the model must choose from these)
    referenceLibraries?: string[]; // reference columns: referenceable target tables
    isMedia?: boolean;         // media columns: recommended to leave empty for user upload
  }>;
  writeExample: Record<string, unknown>; // an "example propertyValues for one row" assembled from real fields
}
```

**Notes**:
- `required` must be read from `library_field_definitions.required` — `getLibraryProperties` does not currently expose that field; `required` needs to be added on `FieldDefinitionRow` / `PropertyConfig` (see §6).
- `writeExample` is derived from each field's `dataType` `example`, giving the model a "this is what it looks like" anchor, lowering the probability of `{}` / nested arrays.
- Register it in the tool table of `src/lib/agent/tools/index.ts`.

### 3.2 T2: Unified schema validation layer (Strict)

Consolidate the checks currently scattered across `field-resolver.ts` / `property-value-validation.ts` into a single entry point, and **add required validation** plus **structured errors**.

**Location**: extend `prepareAgentPropertyValues` in `src/lib/agent/property-value-validation.ts`:

```typescript
// Existing
export function prepareAgentPropertyValues(
  resolved: Record<string, unknown>,
  properties: PropertyConfig[],
  options?: { assetName?: string }
): { values: Record<string, unknown> } | { error: string }
```

**Upgraded to** (pipeline order is fixed):

1. `mergeAssetNameIntoPropertyValues` (existing) — name → primary label column
2. `flattenArrayValuesInMap` (existing) — unwrap `[[...]]`
3. `normalizeLlmPropertyValues` (already at the resolver entry) — unwrap `{item}`
4. **`validateRequiredPropertyValues` (new)** — missing required → structured error
5. `validateEnumPropertyValues` (existing) — illegal enum → structured error
6. (references remain handled by the existing `validateReferencePropertyValues`)

**Strict rules**:
- **create_asset**: missing required columns is an error (creation must satisfy required).
- **update_asset / update_row**: only validate enum/format among "fields submitted this time"; do **not** force completion of unsubmitted required fields (partial updates may change a single column). Required validation is enabled only on the create path.
- Illegal enum, illegal reference: error on both create and update.

> Trade-off: the update path does not enforce required, avoiding the counterintuitive behavior of "changing one field but being asked to fill the whole row"; the create path enforces required to guarantee new rows are not incomplete.

### 3.3 T3: Structured correction messages (Self-Correction Loop)

The `error` returned on validation failure must be **machine-readable and self-contained**, so the model can correct in one turn. Unified format:

```
WRITE_VALIDATION_FAILED: <one-sentence reason>.
Missing required: Rule Name, Discount Strength.
Invalid enum: Currency Type="Recharge Currency" (allowed: Free Currency, Semi-Free Currency, Paid Currency, Gameplay Points).
Field formats: Rule Name=string; Discount Strength=number; Applicable Zone=reference([{assetId,fieldId}] from query_assets).
Re-issue the call with corrected propertyValues.
```

Key points:
- List all problems at once (don't report only the first), reducing round trips.
- Include a "field format quick reference for this table", equivalent to inlining the §3.1 contract summary into the error, so the model need not call `get_library_schema` again.
- This message goes into the tool result and is fed back to the LLM via the existing ReAct loop (`core.ts` already has a mechanism to feed `{ success:false, error }` back as a tool message).

### 3.4 T4: `setup_library` returns a "fill-in memo"

After `setup_library` succeeds, append `writeGuide` to the `data` of its tool result: the table's field contract + `writeExample` (same as §3.1). This way the model gets "how to fill" **within the same context right after creating the table**, without an extra `get_library_schema`, directly mitigating "forget after creating → send empty `{}`".

**Location**: the return value of `executeImport` in `src/lib/agent/workflows/setup-library.ts`.

### 3.5 T5: Prompt tightening

`src/lib/agent/prompts.ts`:

- Add rule: **"Before filling data into a table, if the table was not just created by setup_library, first call get_library_schema to obtain the columns / required fields / legal enum values, then write."**
- Reinforce: enum values must be taken exactly from enumOptions; create must satisfy required columns; `name` is automatically synced to the primary label column.
- Continue removing any verbose `propertyValues = {...}` JSON examples that could induce empty `{}` (continuing this week's cleanup).

### 3.6 Phase 1 affected files

| File | Change |
|------|------|
| `src/lib/agent/workflows/get-library-schema.ts` | **New** read tool |
| `src/lib/agent/tools/index.ts` | Register the new tool |
| `src/lib/agent/data-access.ts` | `PropertyConfig` / `FieldDefinitionRow` expose `required` |
| `src/lib/types/libraryAssets.ts` | `PropertyConfig` gains `required?: boolean` |
| `src/lib/agent/property-value-validation.ts` | New `validateRequiredPropertyValues` + structured errors; extend `prepareAgentPropertyValues` |
| `src/lib/agent/tools/create-asset.ts` | Use unified validation (create: required enabled) |
| `src/lib/agent/tools/update-asset.ts` | Use unified validation (update: required disabled) |
| `src/lib/agent/workflows/update-row.ts` | Same as above |
| `src/lib/agent/workflows/setup-library.ts` | Result includes `writeGuide` |
| `src/lib/agent/prompts.ts` | Add / tighten rules |

---

## 4. Phase 2 — Structural (Long-Term)

Goal: **structurally eliminate the space where "the model can fill things in wrong"**, rather than relying on validation bounce-back. Two optional paths (choose one or combine):

### 4.1 Option A: Dynamic schema injection (recommended long-term)

For the currently active library, **dynamically generate the write tools' JSON Schema on each request** — turn `propertyValues` from a free-form object into an object that precisely lists the table's fields, with enum columns constrained via JSON Schema `enum` and required columns placed in `required`.

```
getToolsForLlm() today: static global tool table
        ↓ refactor
getToolsForLlm(ctx): when ctx.currentLibraryId exists,
  create_asset.parameters.properties.propertyValues =
    { type:'object',
      properties: { "Currency Type": {enum:[...]}, "Name": {type:'string'}, ... },
      required: [required columns] }
```

**Benefit**: compatible with OpenAI/MiniMax function-call constraint mechanisms; in theory makes it hard for the model to produce illegal enums / miss required fields at generation time.
**Cost**: `getToolsForLlm` needs ctx and a schema query; for multi-library operations only the "currently active library" can be injected, and cross-library writes still fall back to Phase 1 validation.
**Related**: `src/lib/agent/tools/index.ts`, `core.ts` (`streamLlm(..., { tools: getToolsForLlm(ctx) })`).

### 4.2 Option B: Step-by-step atomic write tools

Add more atomic tools to reduce the JSON complexity of a single tool call:

- `create_row({ libraryName, name })` — only creates the row + primary label column.
- `set_cell({ libraryName, rowIndex, field, value })` — writes one cell at a time; parameters are minimal, so the model can hardly send an "empty object".
- Keep the bulk `propertyValues` of `create_asset` / `update_row` as a "fast path".

**Benefit**: simplest structure, hardest to get wrong, debugging-friendly.
**Cost**: bulk filling significantly increases tool call count (N rows × M columns); works acceptably with the "single SSE, multiple tools" of the auto-execute spec, but tokens / latency rise.

### 4.3 Phase 2 trade-off recommendations

| Dimension | Option A dynamic schema | Option B atomic tools |
|------|---------------------|-------------------|
| Error prevention strength | High (constraints at generation time) | High (minimal structure) |
| Refactoring surface | Medium (tool generation + core passing ctx) | Medium (new tools + prompt guidance) |
| Bulk efficiency | High (still writes a whole row at once) | Low (cell count = call count) |
| Cross-library scenarios | Degrades to Phase 1 validation | Naturally supported |
| Recommendation | **Primary choice** (bulk-friendly) | Fallback / supplement for complex tables |

> Recommendation: do Option A first in Phase 2; if dynamic schema constraints prove insufficient on MiniMax, use Option B to cover complex tables.

---

## 5. Data Structures

### 5.1 `PropertyConfig` new field (`src/lib/types/libraryAssets.ts`)

```typescript
export type PropertyConfig = {
  // ...existing fields
  required?: boolean; // new: from library_field_definitions.required
};
```

### 5.2 Validation result (`property-value-validation.ts`)

```typescript
type PrepareResult =
  | { values: Record<string, unknown> }
  | { error: string }; // structured WRITE_VALIDATION_FAILED text (§3.3)

interface ValidationContext {
  requireAllRequired: boolean; // create=true, update=false
}
```

---

## 6. Error Feedback Contract (§3.3 normative)

The validation error text is the model's sole basis for self-correction, constrained as follows:

- Must start with the `WRITE_VALIDATION_FAILED:` prefix (for model/log recognition).
- Must aggregate **all** problems, in sections: `Missing required`, `Invalid enum`, `Invalid format`.
- Enum errors must include the complete legal values as `allowed: ...`.
- Must end with the action instruction `Re-issue the call with corrected propertyValues.`
- Text is in English (consistent with existing tool errors; aimed at the LLM, not end users).

---

## 7. Testing

### 7.1 Unit (`tests/unit/agent/`)

| Case | Expectation |
|------|------|
| `get_library_schema` returned fields include enumOptions / required / referenceLibraries | Contract is complete |
| `get_library_schema` `writeExample` assembled from real fields | Non-empty, keys are field labels |
| `validateRequiredPropertyValues` create missing required | Returns structured error listing missing fields |
| update missing required (column not submitted) | Does **not** raise a required error (partial updates allowed) |
| Illegal enum | Errors and includes the allowed list |
| Error text format conforms to the §6 contract | Prefix + sections + action instruction |
| `setup_library` result contains `writeGuide` | Field contract + writeExample |
| Existing guardrails (empty/array/name) after consolidation do not regress | Existing tests all green |

### 7.2 Regression reproduction

Build offline fixtures from the real failure scenarios in §1.1 (fabricated enum value in the currency table, empty primary label in discount rules), asserting the new validation chain intercepts them and produces correctable errors.

### 7.3 Manual / E2E

- Upload a design document → Agent creates tables → fills data: spot-check that enum columns, primary label columns, and reference columns are complete and legal.
- Deliberately make the model write an illegal enum: confirm it self-corrects based on the error in the next turn and writes correctly (self-correction loop works).

---

## 8. Implementation Plan

### Phase 1 (short-term stopgap, ordered by dependency)

1. Expose `PropertyConfig.required` (types + data-access).
2. `get_library_schema` tool + registration + unit tests.
3. `validateRequiredPropertyValues` + structured errors + extend `prepareAgentPropertyValues` (create/update distinction).
4. Wire the three write tools into the unified validation layer.
5. `setup_library` returns `writeGuide`.
6. `prompts.ts` tightening + new rules.
7. Unit tests + real-scenario regression.

### Phase 2 (long-term, independently evaluated)

1. `getToolsForLlm(ctx)` dynamic schema (Option A) prototype + MiniMax constraint strength validation.
2. Decide based on results whether to introduce `create_row` / `set_cell` (Option B).

---

## 9. Open Questions

| # | Question | Tentative |
|---|------|------|
| Q1 | Should the update path also enforce required? | **No**: only create enforces it; update allows partial |
| Q2 | Should `get_library_schema` be merged into `query_assets` (adding a `schemaOnly` parameter) rather than a standalone tool? | Leaning standalone tool (clear semantics, read requires no confirmation); can be decided in review |
| Q3 | Does the Phase 2 dynamic schema's `enum` constraint actually take effect on MiniMax-M3? | Needs prototype validation; fall back to Option B if inadequate |
| Q4 | For cross-library bulk writes, schema injection only covers the active library — is that enough? | Phase 1 validation as backstop; acceptable |
| Q5 | Error text in English vs Chinese? | English (aimed at the LLM, consistent with existing tool errors) |

---

## 10. Success Criteria

- [ ] The model can use `get_library_schema` to obtain any table's complete contract in one call (columns/required/enum/references/format).
- [ ] create missing required / illegal enum → structured error (not silent success), and the model can self-correct in the next turn based on it.
- [ ] The three classes of historical failures in §1.1 (empty `{}`, fabricated enum, empty primary label) are intercepted or auto-completed under the new pipeline.
- [ ] After `setup_library`, the model can correctly fill the first row of data without "guessing".
- [ ] Existing unit tests and guardrail behavior do not regress; new validation has unit test coverage.
- [ ] The Phase 2 path has a prototype conclusion (whether dynamic schema suffices), forming a decision record on whether to ship it.
