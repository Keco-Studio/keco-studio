# Library & Folder Creation — Tool/Skill Design Spec

## Problem

The Agent cannot create libraries (tables) or folders. `libraryService.ts` and `folderService.ts` are `'use client'` — agent tools run on the server and cannot import them. The agent's `data-access.ts` has no mutation functions for library/folder creation.

## Design Overview

### Server-side functions (data-access.ts)

Re-implement the 4 mutation operations as server-safe functions (same pattern as existing `getLibraryAssets`, `findLibraryByName` etc. in `data-access.ts`). Use `authorizationService` for permission checks.

| Function | Signature | Description |
|----------|-----------|-------------|
| `createLibraryServer` | `(supabase, projectId, name, folderId?, description?) → libraryId` | Insert into `libraries`. Validate folder ownership if provided. |
| `createFolderServer` | `(supabase, projectId, name, description?) → folderId` | Insert into `folders`. |
| `deleteLibraryServer` | `(supabase, libraryId) → void` | Delete library + cascade (fields, assets, values). Uses `verifyLibraryDeletionPermission`. |
| `renameLibraryServer` | `(supabase, libraryId, newName) → void` | Update `libraries.name`. Uses `verifyLibraryUpdatePermission`. |

### Tools (4 basic tools)

All tools follow the existing `AgentTool` pattern with `category: 'write'`, `confirmationMode: 'pre_execute'`.

#### `create_library`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Library name |
| `folderName` | string | No | Folder name (resolved to UUID via `findFolderByName`). Defaults to no folder. |
| `description` | string | No | Library description |

Permission: `editor` (same as `createLibrary` in libraryService — `verifyLibraryCreationPermission`).

Internal flow:
1. Resolve `folderName` → `folderId` (if provided). Error if folder not found.
2. Check for duplicate library name in project. Error if exists.
3. Call `createLibraryServer()`.
4. Return `{ libraryId, libraryName, folderName }`.

#### `create_folder`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Folder name |
| `description` | string | No | Folder description |

Permission: `editor`.

Internal flow:
1. Check for duplicate folder name in project.
2. Call `createFolderServer()`.
3. Return `{ folderId, folderName }`.

#### `delete_library`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `libraryName` | string | Yes | Library to delete |

Permission: `admin`.

Internal flow:
1. Resolve `libraryName` → `libraryId`.
2. Call `deleteLibraryServer()`.
3. Return `{ libraryName, libraryId }`.

#### `rename_library`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `libraryName` | string | Yes | Current library name |
| `newName` | string | Yes | New library name |

Permission: `editor`.

Internal flow:
1. Resolve `libraryName` → `libraryId`.
2. Check for duplicate `newName` in project.
3. Call `renameLibraryServer()`.
4. Return `{ libraryId, oldName, newName }`.

### Skill: `setup_library`

Code-orchestrated composite tool. Creates a library with all its fields in one call. Uses `post_preview` confirmation (same pattern as `set_reference` and `update_row`).

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `libraryName` | string | Yes | New library name |
| `folderName` | string | No | Folder name (resolved to UUID) |
| `description` | string | No | Library description |
| `fields` | `FieldDef[]` | Yes | At least 1 field required |

**FieldDef:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | string | Yes | Column display name |
| `dataType` | string | Yes | `string`, `int`, `float`, `boolean`, `enum`, `date`, `reference`, `formula`, `int_array`, `float_array`, `string_array`, `multimedia`, `audio` |
| `section` | string | No | Section/tab name. Default: `"section1"` |
| `description` | string | No | Field description |
| `required` | boolean | No | Whether field is required |
| `enumOptions` | `string[]` | No | For `enum` type |
| `referenceLibraries` | `string[]` | No | Library names for `reference` type. Resolved to UUIDs internally. |
| `formulaExpression` | string | No | For `formula` type |

#### Internal Flow

```
execute()  NON-MUTATING:
  1. Resolve folderName → folderId (if provided)
  2. Check duplicate library name → error if exists
  3. Validate all field dataType values (use normalizeFieldDataType)
  4. For each reference field: resolve referenceLibraries names → UUIDs
     Error if any referenced library not found.
  5. Group fields by section
  6. Return preview (displayHint: 'skill_preview'):
     {
       type: "setup_library",
       libraryName,
       folderName?,
       description?,
       sections: {
         "section1": [{ label, dataType, ... }, ...],
         "stats": [{ label, dataType, ... }, ...]
       },
       totalFields: N
     }

executeImport()  MUTATING:
  1. createLibraryServer(supabase, projectId, libraryName, folderId, description)
     → libraryId
  2. For each section → for each field in section:
     sectionId = `${libraryId}:${sectionName}`
     addLibraryField(supabase, libraryId, sectionId, sectionName, fieldPayload)
  3. Return { libraryId, libraryName, sections, totalFields }
```

#### Preview Format (displayHint: 'skill_preview')

```json
{
  "type": "setup_library",
  "libraryName": "Characters",
  "folder": "Worldview",
  "sections": {
    "section1": [
      { "label": "ID", "dataType": "string" },
      { "label": "Name", "dataType": "string" },
      { "label": "Type", "dataType": "enum", "enumOptions": ["Protagonist", "Supporting", "NPC"] }
    ],
    "stats": [
      { "label": "HP", "dataType": "int" },
      { "label": "Faction", "dataType": "reference", "referenceLibraries": ["Factions"] }
    ]
  },
  "totalFields": 5
}
```

#### Error Cases

| Condition | Error |
|-----------|-------|
| Library name already exists | `Library "X" already exists in this project.` |
| Folder not found | `Folder "X" not found. Available folders: ...` |
| Empty fields array | `At least one field is required.` |
| Invalid dataType | `Unsupported data type "X". Supported: ...` |
| Referenced library not found | `Reference library "X" not found. Available: ...` |
| Field creation fails mid-way | Rollback: delete the partially created library. Return error with details. |

#### Rollback Strategy

If field creation fails partway through (e.g., 3 of 5 fields succeed), delete the library to avoid leaving a half-created schema. This is safe because:
- The library was just created (no user data yet)
- `deleteLibraryServer` cascades to fields/assets

### Folder Resolution Helper

Add to `data-access.ts`:

```typescript
export async function findFolderByName(
  supabase: SupabaseClient,
  projectId: string,
  folderName: string
): Promise<{ folder: { id: string; name: string } | null; available: string[] }>
```

Same pattern as `findLibraryByName`: exact match → case-insensitive → UUID fallback.

### Prompt Updates

Add to RULES in `prompts.ts`:

```
22. When the user asks to create a new library/table with fields, use `setup_library`.
    It creates the library and all fields in one step.
23. When the user only needs an empty library, use `create_library`.
24. When the user mentions a folder by name, pass `folderName` to the tool.
    Do NOT ask for folder UUID.
```

### File Changes

| File | Change |
|------|--------|
| `src/lib/agent/data-access.ts` | Add `createLibraryServer`, `createFolderServer`, `deleteLibraryServer`, `renameLibraryServer`, `findFolderByName` |
| `src/lib/agent/tools/create-library.ts` | **NEW** — basic tool |
| `src/lib/agent/tools/create-folder.ts` | **NEW** — basic tool |
| `src/lib/agent/tools/delete-library.ts` | **NEW** — basic tool |
| `src/lib/agent/tools/rename-library.ts` | **NEW** — basic tool |
| `src/lib/agent/tools/setup-library.ts` | **NEW** — skill (post_preview) |
| `src/lib/agent/tools/index.ts` | Register 4 tools + 1 skill |
| `src/lib/agent/prompts.ts` | Add rules 22-24 |

**No changes to:** `core.ts`, `types.ts`, frontend.

### Testing Strategy

- **create_library**: Create a library, verify it appears in `listProjectLibraries`. Create with folderName, verify folder_id is set. Duplicate name → error.
- **create_folder**: Create a folder, verify it exists. Duplicate name → error.
- **delete_library**: Create then delete. Verify cascade (fields, assets gone). Non-admin → permission error.
- **rename_library**: Create then rename. Verify name updated. Duplicate newName → error.
- **setup_library**: Create library with multi-section fields including reference fields. Verify: (a) library created, (b) all fields exist with correct types, (c) sections created correctly, (d) reference libraries resolved to UUIDs. Partial failure → rollback.
