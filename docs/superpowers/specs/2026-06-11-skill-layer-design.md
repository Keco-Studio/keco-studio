# Skill Layer Design Spec

## Problem

The Agent's 8 tools are atomic — each does one thing. Multi-step workflows (cross-library references, row-targeted updates) rely on the LLM to orchestrate tool calls. This produces recurring failures:

- **Wrong row**: LLM picks first non-empty row instead of `rowIndex=1`
- **Stale UUIDs**: LLM copies IDs from existing reference columns instead of re-querying
- **Incomplete references**: One chip per row instead of one per non-empty cell
- **Missing `includeEmpty`**: LLM forgets to pass it, can't find empty rows

These are deterministic workflows that shouldn't depend on LLM judgment.

## Design Decision

**Skill = code-orchestrated composite tool.** Skills are implemented as `AgentTool` objects that internally call data-access functions directly (not via other tools). They reuse the existing `post_preview` confirmation flow: non-mutating steps run first, user sees a preview, then approves the final write.

## Architecture

```
LLM ──→ AgentTool.execute(params, ctx)
              │
              ├─ Skill A: internal multi-step logic
              │   1. Read source data (no confirmation)
              │   2. Resolve identifiers (no confirmation)
              │   3. Build preview → return with displayHint: 'skill_preview'
              │   ── pause for user confirmation ──
              │   4. executeImport(): execute the write
              │
              └─ Regular tool: direct execute
```

### Type Extension

Add `executeImport` to the skill's tool definition. This field already exists on `AgentTool` for `import_script`. The ReAct loop's `post_preview` path already handles it — no core.ts changes needed.

```typescript
// No new type needed. Skills use the existing AgentTool interface with:
//   confirmationMode: 'post_preview'
//   execute: (params, ctx) => Promise<ToolResult>      // non-mutating, returns preview
//   executeImport: (toolResult, params, ctx) => Promise<ToolResult>  // mutating
```

### Registration

Skills are registered in `tools/index.ts` alongside regular tools. The LLM sees them as ordinary function calls. No distinction in the tool schema sent to the LLM.

### Prompt Updates

Add rules to `prompts.ts` guiding the LLM to prefer skills when applicable:
- Rule 19: When writing references across libraries, use `set_reference` instead of manual query + update
- Rule 20: When updating a row by row number, use `update_row` instead of query + update_asset

---

## Skill 1: `update_row`

**Purpose:** Update a specific row identified by `rowIndex`, not `assetId`. Eliminates the "wrong row" failure.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `libraryName` | string | No | Target library. Defaults to active library from page context |
| `rowIndex` | number | **Yes** | 1-based row number (matches UI row numbers) |
| `propertyValues` | object | **Yes** | Field values keyed by semantic field name |

### Internal Flow

```
execute(params, ctx):
  1. Resolve library by name (reuse findLibraryByName)
  2. getLibraryAssets(libraryId) → find asset where rowIndex matches
     - If no match: return error "Row N does not exist in library X"
  3. Resolve semantic field names → field IDs (reuse resolvePropertyValues)
  4. Validate reference targets if any field is reference type
     (reuse validateReferencePropertyValues)
  5. Return preview:
     {
       libraryName, rowIndex, assetId,
       changes: [{ field: "Type", value: "int" }, ...],
       existingValues: { ... current values before update ... }
     }

executeImport(toolResult, params, ctx):
  1. Call updateAssetService(assetId, name, resolvedValues)
  2. Return { success: true, data: { assetId, rowIndex, libraryName } }
```

### Preview Format (displayHint: 'skill_preview')

```json
{
  "type": "update_row",
  "libraryName": "test2",
  "rowIndex": 1,
  "assetId": "abc-123...",
  "changes": [
    { "field": "ref-test2", "value": ["id1", "id2", "id3"] }
  ]
}
```

### Error Cases

| Condition | Error Message |
|-----------|---------------|
| Library not found | `Library "X" not found. Available: ...` |
| Row doesn't exist | `Row N does not exist in library "X" (library has M rows)` |
| Unknown field name | `Unknown field(s): Y. Available: ...` |
| Reference to empty asset | `Cannot reference empty asset(s): ...` |

---

## Skill 2: `set_reference`

**Purpose:** Write cross-library references from all non-empty cells of a source library to a target row's reference field. Produces one reference chip per non-empty cell (not per row).

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceLibrary` | string | **Yes** | Library to read reference targets from |
| `targetLibrary` | string | No | Library to write references to. Defaults to active library |
| `targetRow` | number | **Yes** | 1-based row number in target library |
| `targetField` | string | **Yes** | Reference field name in target library |

### Internal Flow

```
execute(params, ctx):
  1. Resolve source library by name
  2. Resolve target library by name
  3. getLibraryAssets(sourceLibraryId) → all source rows
  4. Filter to non-empty rows (propertyValues not empty)
  5. For each non-empty source row:
     - For each non-empty field in that row:
       - Build ReferenceSelection { assetId, fieldId, fieldLabel, displayValue }
  6. Resolve target library properties → find targetField's fieldId
     - Validate it's a reference type field
     - Validate sourceLibrary is in its reference_libraries list
  7. getLibraryAssets(targetLibraryId) → find target asset by rowIndex
     - If no match: return error "Row N does not exist"
  8. Return preview:
     {
       type: "set_reference",
       sourceLibrary, targetLibrary, targetRow, targetField,
       references: [
         { assetId, fieldLabel, displayValue }, ...
       ],
       referenceCount: N
     }

executeImport(toolResult, params, ctx):
  1. Build ReferenceSelection[] from preview data
  2. Call updateAssetService(targetAssetId, name, { [targetFieldId]: selections })
  3. Return { success: true, data: { targetAssetId, referenceCount } }
```

### Preview Format (displayHint: 'skill_preview')

```json
{
  "type": "set_reference",
  "sourceLibrary": "test1",
  "targetLibrary": "test2",
  "targetRow": 1,
  "targetField": "ref-test2",
  "references": [
    { "rowIndex": 1, "fieldLabel": "ID", "displayValue": "hsssssshssssss" },
    { "rowIndex": 1, "fieldLabel": "IDDD", "displayValue": "vessssion4" },
    { "rowIndex": 2, "fieldLabel": "IDDD", "displayValue": "version4" },
    { "rowIndex": 2, "fieldLabel": "idd", "displayValue": "12345" },
    { "rowIndex": 3, "fieldLabel": "IDDD", "displayValue": "helllo world" },
    { "rowIndex": 3, "fieldLabel": "idd", "displayValue": "12345" },
    { "rowIndex": 4, "fieldLabel": "type", "displayValue": "int" }
  ],
  "referenceCount": 7
}
```

### Error Cases

| Condition | Error Message |
|-----------|---------------|
| Source library not found | `Source library "X" not found. Available: ...` |
| Target library not found | `Target library "X" not found. Available: ...` |
| Target row doesn't exist | `Row N does not exist in library "X" (library has M rows)` |
| Target field not found | `Field "Y" not found in library "X". Available: ...` |
| Field is not reference type | `Field "Y" is not a reference field (type: string). Cannot set references.` |
| Source library not in reference_libraries | `Field "Y" does not reference library "X". It references: ...` |
| Source library has no non-empty rows | `Source library "X" has no non-empty rows. Nothing to reference.` |

### Key Design: One Chip Per Non-Empty Cell

The current `resolveAgentReferencePropertyValues` calls `buildReferenceSelectionForAsset` which returns only the **first** non-empty field per asset. `set_reference` instead calls `buildAllReferenceSelectionsForAsset` (new function) which returns **all** non-empty fields per asset.

This means if source row 1 has `{ID: "hsssssshssssss", IDDD: "vessssion4"}`, two reference selections are created — one for each non-empty cell.

---

## System Prompt Updates

Add to RULES section in `prompts.ts`:

```
19. When the user asks to write references from one library to another, use `set_reference`.
    Do NOT manually query the source library and write IDs via update_asset.
20. When the user refers to a row by number ("row 1", "row 3"), use `update_row`
    with the rowIndex parameter. Do NOT use update_asset with a guessed assetId.
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/lib/agent/tools/update-row.ts` | **NEW** — `update_row` skill |
| `src/lib/agent/tools/set-reference.ts` | **NEW** — `set_reference` skill |
| `src/lib/agent/tools/index.ts` | Add imports + register both skills in `allTools` |
| `src/lib/agent/prompts.ts` | Add rules 19-20 |
| `src/lib/utils/assetEmptiness.ts` | Add `buildAllReferenceSelectionsForAsset` (already done in this branch) |
| `src/lib/agent/asset-emptiness.ts` | Export new function, use in `set_reference` |

**No changes to:** `core.ts`, `types.ts`, confirmation flow, frontend.

## Testing Strategy

- **update_row**: Create a library with 3 rows (row 1 empty, row 2 has data, row 3 has data). Update row 1 by rowIndex. Verify it writes to the empty row, not row 2.
- **set_reference**: Create source library with multi-section data (some rows have values in multiple sections). Set references to target library row 1. Verify: (a) correct number of reference chips, (b) each chip shows the right displayValue, (c) empty source rows are excluded.
- **Error paths**: Test row-not-found, field-not-found, non-reference field, source library not in reference_libraries.
