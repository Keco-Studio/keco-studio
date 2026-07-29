# Agent Generate Table / Conversation From Document

**Date:** 2026-07-29  
**Status:** Implemented  
**Scope:** Built-in Agent chat tool + prompt routing for existing project documents.

## Summary

When a user asks Agent to generate a **table** or **conversation** from an **already existing** project Document, Agent must use the same pipeline as sidebar right-click:

- Document → **Generate table**
- Document → **Generate conversation**

That pipeline is the silent document-derived import (`runDocumentDerivedImport` → `/api/import-script` Story IR), which creates a derived library nested under the source Document (`source_document_id` + `document_export_type`).

Agent must **not** approximate this path with `setup_library` / `create_library` / folder `import_script`.

## Goals

- Add Agent tool `generate_from_document` that produces the same derived library outcome as the Document context-menu actions.
- Route chat requests for generating table/conversation from an existing Document to that tool via system-prompt rules.
- Preserve admin-only gating and confirmation behavior consistent with other write tools / Auto mode.
- Reuse existing client progress + sidebar refresh signals so UX matches right-click generate.

## Non-Goals

- Changing TopBar **Export as tables** (design-doc Agent handoff / `documentExport` + `setup_library`) in this change.
- Changing TopBar **Export as script** / ImportScriptModal UX.
- Creating a Document from attachments first (existing `create_document` / design-upload flows stay as-is).
- New tree node types or changes to derived-library ownership / cascade-delete rules.
- Making Agent literally “click” the context menu in the DOM.

## Current Divergence (why this exists)

| Entry | Current path | Nesting |
| --- | --- | --- |
| Sidebar RMB Generate table / conversation | `fetchDocumentExportSource` + `startDocumentDerivedImport` / `runDocumentDerivedImport` | Derived under Document |
| Agent chat “帮我从这个 Document 生成 table/conversation” | Often `setup_library` / `import_script` / free-form writes | Independent library, wrong product path |
| TopBar Export as tables | Design handoff → Agent `documentExport` + `setup_library` | Derived via `documentExport` binding (different pipeline; out of scope) |

Item 8 product rule: chat generate for an existing Document must match the **RMB** path.

## Confirmed Product Rules

1. Source Document already exists in the project.
2. Trigger is a user request in Agent chat (not TopBar export).
3. `exportType: 'table'` ≡ RMB **Generate table**.
4. `exportType: 'script'` ≡ RMB **Generate conversation**.
5. Effect must match RMB: same Story IR import, same naming defaults, same nesting under Document.
6. Admin only (same as RMB generate).
7. Requires confirmation unless Auto mode already auto-approves equivalent writes.
8. Prompt must forbid substituting `setup_library` / `create_library` / folder `import_script` for this intent.

## Design

### 1. New tool: `generate_from_document`

**Parameters**

| Field | Type | Notes |
| --- | --- | --- |
| `documentId` | uuid, optional | Preferred when known |
| `documentName` | string, optional | Resolve via project documents; ambiguous names must ask / disambiguate like other document tools |
| `exportType` | `'table' \| 'script'` | Required. UI label for `script` is “conversation” |

Exactly one of `documentId` / `documentName` must resolve to a single in-project Document. If the chat has a current document and the user says “this document”, prefer `currentDocumentId` from context when params omit an id.

**Server execution**

1. Authorize: user must be project **admin**; else fail with the same admin-export restriction wording used by document export/generate.
2. Load export source via the same service as RMB (`getDocumentExportSource` / snapshot token).
3. Convert markdown → plain text with `toScriptImportPlainText` (same as `runDocumentDerivedImport`).
4. Reject empty document with the same error (`Document is empty`).
5. Call the same import path used by `/api/import-script` for document-derived exports (`documentExportType`, `sourceDocumentId`, snapshot token, default derived library name).
6. Return tool result with: `libraryId`, `libraryName`, `exportType`, `sourceDocumentId`, and invalidation payload including `sourceDocumentId` so the client can expand/refresh the Document tree.

Do **not** invent columns with `setup_library`. The Story IR compiler owns schema/rows.

**Streaming / progress**

Prefer yielding progress events compatible with existing agent progress UX where practical. Also emit the existing `notifyDocumentDerivedImportProgress` client signal after tool success/failure if the client receives a dedicated invalidation/event (mirror RMB banner when the Document page is open).

### 2. Prompt routing

Add a DOCUMENT DERIVED GENERATE rule to the agent system prompt:

- When the user asks to generate a **table** or **conversation/script** from an **existing project Document**, call `generate_from_document` with the correct `exportType`.
- Do not call `setup_library`, `create_library`, or folder-scoped `import_script` for that intent.
- If the Document does not exist yet, create it first with `create_document` (and edits if needed), then call `generate_from_document`.
- Distinguish:
  - **Document-derived generate** (this tool) vs
  - **Design-document / attachment tables intent** (`[Document intent] tables` / Export as tables handoff) which remains the existing setup_library path for this release.

### 3. Confirmation + Auto mode

Treat `generate_from_document` as a mutating write tool:

- Show a confirmation card summarizing Document name + target (`table` or `conversation`).
- Auto mode follows the same auto-approve policy as comparable import/setup writes already in the product (do not invent a special bypass).

### 4. Client refresh

On success invalidations of type `library` that include `sourceDocumentId`, keep using `notifyDocumentDerivedLibraryCreated` in `invalidateAgentCaches` so the sidebar expands the Document and shows the new child—same as today’s derived-library creation path.

### 5. Tests

- Unit: tool param validation, admin gate, empty document, name disambiguation, success returns `sourceDocumentId` + `document_export_type`.
- Unit: system prompt contains the “must use generate_from_document / must not use setup_library for this intent” rule.
- Integration or route-level: tool execution creates a library with `source_document_id` set and correct `document_export_type`.
- E2E (smoke): Agent chat request on an existing Document generates a nested table (and optionally conversation) without creating a top-level independent library.

## Alternatives considered

| Approach | Why not |
| --- | --- |
| Prompt-only “please right-click” | Does not automate; fails item 8 |
| Client-only structured event calling `startDocumentDerivedImport` | Couples chat SSE to DOM side effects harder to test; server tool keeps auth + audit with other tools |
| Reuse folder `import_script` tool | Requires folder placement and does not establish Document nesting semantics without the derived-export flags |

## Success criteria

- From Agent chat, generating table/conversation from an existing Document creates the same class of derived child as RMB Generate table / Generate conversation.
- No independent top-level library is created for that intent.
- Admin / empty / ambiguity failures are explicit and actionable.
- TopBar Export as tables remains unchanged in this change set.

## Open follow-ups (explicitly deferred)

- Optionally unify TopBar **Export as tables** onto the same Story IR derived-import path later, if product wants one generate pipeline everywhere.
- Optionally expose progress banner parity when Agent runs while the Document page is not open.
