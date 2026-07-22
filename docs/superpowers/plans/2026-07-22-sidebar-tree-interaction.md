# Sidebar Tree Interaction Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Libraries/Folder `+` menus discoverable, expose Document generate table/script from the sidebar context menu, slim derived-child menus, and unify rename to inline edit.

**Architecture:** Extend the existing portal menus (`AddLibraryMenu`, `ContextMenu`) and sidebar action hooks. Reuse document export-source + design handoff + `ImportScriptModal` for generate actions. Allow Excel import at project root by making `folderId` optional on the import API. Implement folder duplicate by creating a new folder, copying ordinary libraries into it, and cloning documents (without re-copying derived libraries).

**Tech Stack:** Next.js App Router, React 19, TypeScript, TanStack Query, Ant Design Tree, Jest, existing Supabase services.

**Spec:** `docs/superpowers/specs/2026-07-22-sidebar-tree-interaction-design.md`

## Global Constraints

- Libraries `+` items only: Create new folder / Create new table / Create new document / Import document / Import table. No delete/rename. No “Generate tables from document”.
- “Create new table” = former Create new library (`NewLibraryModal`).
- “Generate conversation” = script export (`document_export_type: 'script'`). “Generate table” = tables export handoff.
- Folder `+` replaces immediate `openNewLibrary()` with a left-click menu; no nested create-folder.
- Rename for tree rows: double-click or menu Rename → inline edit; Enter saves, Esc cancels.
- Derived library RMB: Delete + Rename only.
- Generate table/script from sidebar: admin only (same as document editor exports).
- No silent no-op for Folder Duplicate — implement or omit the item until ready (this plan implements it).
- Do not invent a new conversation tree-node type.

## File Map

| File | Responsibility |
|------|----------------|
| `src/components/libraries/AddLibraryMenu.tsx` | Configurable portal menu for Libraries `+` and Folder `+` |
| `src/app/api/import/route.ts` + `importService` + `ImportLibraryModal` | Allow root (`folderId` null) Excel import |
| `src/components/layout/hooks/useSidebarTree.tsx` | Folder `+` opens menu instead of create library |
| `src/components/layout/components/SidebarTreeView.tsx` | Same Folder `+` behavior while inline-editing |
| `src/components/layout/Sidebar.tsx` | Wire both menus, import-table, folder-menu state, script generate modal source |
| `src/components/layout/ContextMenu.tsx` | Document generate actions; derived slim menu |
| `src/components/layout/hooks/useSidebarContextMenuActions.ts` | generate-*, inline rename for folder/library, folder duplicate |
| `src/lib/documents/startDocumentExport.ts` (new) | Shared fetch export-source + table handoff / script source prep |
| `src/lib/services/folderService.ts` | `duplicateFolder` |
| `src/lib/services/libraryService.ts` | Optional `targetFolderId` on `duplicateLibrary` |
| `tests/unit/...` | Menu labels, context actions, import root, folder duplicate |
| `tests/e2e/pages/library.page.ts` | Update “Create new library” → “Create new table” copy |

---

### Task 1: Libraries `+` menu items and labels

**Files:**
- Modify: `src/components/libraries/AddLibraryMenu.tsx`
- Modify: `src/components/layout/Sidebar.tsx` (handlers + props; remove `onGenerateFromDocument`)
- Modify: `tests/e2e/pages/library.page.ts` (button label)
- Test: `tests/unit/layout/add-library-menu.test.tsx` (create)

**Interfaces:**
- Produces: `AddLibraryMenu` props:
  - `onCreateFolder?`, `onCreateTable?` (rename from `onCreateLibrary`), `onCreateDocument?`, `onImportDocument?`, `onImportTable?`
  - Remove `onGenerateFromDocument` / `onCreateLibrary`
- Labels (exact): `Create new folder`, `Create new table`, `Create new document`, `Import document`, `Import table`

- [ ] **Step 1: Write failing unit test for menu labels**

```tsx
// tests/unit/layout/add-library-menu.test.tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddLibraryMenu } from '@/components/libraries/AddLibraryMenu';

jest.mock('@/components/libraries/AddLibraryMenu.module.css', () =>
  new Proxy({}, { get: () => 'class' })
);

describe('AddLibraryMenu', () => {
  it('renders the five Libraries actions with table naming', () => {
    const html = renderToStaticMarkup(
      React.createElement(AddLibraryMenu, {
        open: true,
        anchorElement: null,
        onClose: () => {},
        onCreateFolder: () => {},
        onCreateTable: () => {},
        onCreateDocument: () => {},
        onImportDocument: () => {},
        onImportTable: () => {},
      })
    );
    expect(html).toContain('Create new folder');
    expect(html).toContain('Create new table');
    expect(html).toContain('Create new document');
    expect(html).toContain('Import document');
    expect(html).toContain('Import table');
    expect(html).not.toContain('Create new library');
    expect(html).not.toContain('Generate tables from document');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx jest tests/unit/layout/add-library-menu.test.tsx --runInBand`  
Expected: FAIL (props/labels still old).

- [ ] **Step 3: Update `AddLibraryMenu`**

Replace props and buttons:

```tsx
type AddLibraryMenuProps = {
  open: boolean;
  anchorElement: HTMLElement | null;
  onClose: () => void;
  onCreateFolder?: () => void;
  onCreateTable?: () => void;
  onCreateDocument?: () => void;
  onImportDocument?: () => void;
  onImportTable?: () => void;
  // Folder-only optional destructive actions (Task 3):
  onDelete?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
};
```

Render create/import buttons when callbacks are defined. For `onDelete` / `onRename` / `onDuplicate`, render after a separator using existing `styles.menuItem` / delete styling if present (add `deleteItem` class mirroring `ContextMenu.module.css` only if needed). Keep portal positioning logic unchanged.

- [ ] **Step 4: Wire `Sidebar.tsx`**

- Rename `handleCreateLibrary` → `handleCreateTable` (same body: `setSelectedFolderId(null); openNewLibrary();`).
- Add `handleImportTable` for Libraries `+`: close menu, require project, set `selectedFolderId(null)`, call `openImportLibrary` with a sentinel handled in Task 2 (`''` or dedicated `openImportLibraryAtRoot()`).
- Pass role-gated props; **do not** pass `onGenerateFromDocument`.
- Update e2e helper text from `Create new library` to `Create new table`.

- [ ] **Step 5: Re-run unit test — PASS; commit**

```bash
git add src/components/libraries/AddLibraryMenu.tsx src/components/layout/Sidebar.tsx tests/unit/layout/add-library-menu.test.tsx tests/e2e/pages/library.page.ts
git commit -m "feat(sidebar): relabel Libraries add menu for tables and imports"
```

---

### Task 2: Import table at project root (`folderId` optional)

**Files:**
- Modify: `src/app/api/import/route.ts`
- Modify: `src/lib/services/importService.ts` (`importLibraryFromFile` folderId type)
- Modify: `src/components/libraries/ImportLibraryModal.tsx`
- Modify: `src/components/layout/hooks/useSidebarModals.ts`
- Modify: `src/components/layout/Sidebar.tsx` (modal `folderId` prop)
- Test: `tests/unit/api/import-route-folder.test.ts` (create) — static/contract style if route hard to import; prefer testing a small extracted validator

**Interfaces:**
- Produces: `folderId: string | null` accepted by `/api/import` and `importLibraryFromFile`.
- Empty / missing `folderId` in FormData ⇒ `null` (root library).
- `openImportLibrary(folderId: string | null)` replaces `string`-only signature.

- [ ] **Step 1: Write failing contract test for folderId parsing**

Extract a tiny helper in the route file or `importService.ts`:

```ts
// src/lib/services/importService.ts
export function parseImportFolderId(raw: FormDataEntryValue | null): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (!isUuid(value)) throw new Error('Invalid folderId');
  return value;
}
```

```ts
// tests/unit/api/import-folder-id.test.ts
import { parseImportFolderId } from '@/lib/services/importService';

describe('parseImportFolderId', () => {
  it('treats empty as root', () => {
    expect(parseImportFolderId('')).toBeNull();
    expect(parseImportFolderId(null)).toBeNull();
  });
  it('accepts uuid folders', () => {
    expect(parseImportFolderId('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });
  it('rejects garbage', () => {
    expect(() => parseImportFolderId('nope')).toThrow(/Invalid folderId/);
  });
});
```

- [ ] **Step 2: Run — FAIL until helper exists**

Run: `npx jest tests/unit/api/import-folder-id.test.ts --runInBand`

- [ ] **Step 3: Implement helper + route + service + modal**

- Route: replace hard UUID require with `parseImportFolderId`; pass `folderId: string | null` into `importLibraryFromFile`.
- `importLibraryFromFile`: type `folderId: string | null`; when null, create library with `folder_id: null` (same as `createLibrary` root path). Keep folder access checks only when non-null.
- `ImportLibraryModal`: `folderId: string | null`; append `folderId` only when non-null (or append empty string).
- `useSidebarModals.openImportLibrary(folderId: string | null)`.
- Sidebar Libraries `handleImportTable` → `openImportLibrary(null)`.

- [ ] **Step 4: Tests PASS; commit**

```bash
git commit -m "feat(import): allow Excel library import at project root"
```

---

### Task 3: Folder `+` left-click menu

**Files:**
- Modify: `src/components/layout/hooks/useSidebarTree.tsx`
- Modify: `src/components/layout/components/SidebarTreeView.tsx`
- Modify: `src/components/layout/components/SidebarLibrariesSection.tsx` (prop plumbing if needed)
- Modify: `src/components/layout/Sidebar.tsx`
- Extend: `AddLibraryMenu` folder actions from Task 1
- Test: extend `tests/unit/layout/add-library-menu.test.tsx` for folder items

**Interfaces:**
- Produces: `onFolderAddClick: (folderId: string, anchor: HTMLElement) => void` passed into tree builders instead of `openNewLibrary` on the `+` button.
- Sidebar state: `folderAddMenu: { folderId: string; anchor: HTMLElement } | null`.

- [ ] **Step 1: Failing test — folder menu shows delete/rename/duplicate**

```tsx
it('renders folder destructive actions when provided', () => {
  const html = renderToStaticMarkup(
    React.createElement(AddLibraryMenu, {
      open: true,
      anchorElement: null,
      onClose: () => {},
      onCreateTable: () => {},
      onCreateDocument: () => {},
      onImportDocument: () => {},
      onImportTable: () => {},
      onDelete: () => {},
      onRename: () => {},
      onDuplicate: () => {},
    })
  );
  expect(html).toContain('Delete');
  expect(html).toContain('Rename');
  expect(html).toContain('Duplicate');
  expect(html).not.toContain('Create new folder');
});
```

- [ ] **Step 2: Run — FAIL if delete/rename/duplicate UI missing**

- [ ] **Step 3: Replace Folder `+` handlers**

In `useSidebarTree.tsx` and `InlineEditRow` in `SidebarTreeView.tsx`:

```tsx
onClick={(e) => {
  e.stopPropagation();
  if (!currentIds.projectId) {
    setError('Please select a project first');
    return;
  }
  onFolderAddClick(folder.id, e.currentTarget);
}}
```

Update aria-label/title to `Folder actions`.

In `Sidebar.tsx`:

```tsx
const [folderAddMenu, setFolderAddMenu] = useState<{
  folderId: string;
  anchor: HTMLElement;
} | null>(null);

const openFolderAddMenu = (folderId: string, anchor: HTMLElement) => {
  setFolderAddMenu({ folderId, anchor });
};

// Second AddLibraryMenu instance OR reuse one menu with mode:
<AddLibraryMenu
  open={Boolean(folderAddMenu)}
  anchorElement={folderAddMenu?.anchor ?? null}
  onClose={() => setFolderAddMenu(null)}
  onCreateTable={userRole === 'admin' ? () => {
    setSelectedFolderId(folderAddMenu!.folderId);
    setFolderAddMenu(null);
    openNewLibrary();
  } : undefined}
  onCreateDocument={userRole === 'admin' || userRole === 'editor' ? () => {
    openNewDocumentInFolder(folderAddMenu!.folderId); // existing helper from context actions / local
    setFolderAddMenu(null);
  } : undefined}
  onImportDocument={... setSelectedFolderId(folderId); setShowImportDocumentModal(true) ...}
  onImportTable={... openImportLibrary(folderId) ...}
  onDelete={userRole === 'admin' ? () => { /* reuse folder delete confirm path */ } : undefined}
  onRename={userRole === 'admin' ? () => {
    startInlineRename(`folder-${folderAddMenu!.folderId}`);
    setFolderAddMenu(null);
  } : undefined}
  onDuplicate={... Task 5 ...}
/>
```

For delete from Folder `+`, call the same confirm + `deleteFolder` path used by context-menu folder delete (extract a `requestDeleteFolder(folderId)` helper from `useSidebarContextMenuActions` if duplicated logic is messy — prefer calling into an exported helper rather than copying SQL).

- [ ] **Step 4: Tests PASS; commit**

```bash
git commit -m "feat(sidebar): open folder actions menu from plus button"
```

---

### Task 4: Document / derived ContextMenu + generate wiring

**Files:**
- Create: `src/lib/documents/startDocumentExport.ts`
- Modify: `src/components/layout/ContextMenu.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Modify: `src/components/layout/Sidebar.tsx` (script export modal state for documentSource)
- Modify: `tests/unit/documents/document-derived-sidebar.test.tsx`
- Test: `tests/unit/documents/start-document-export.test.ts` (mock fetch)

**Interfaces:**
- Extend `ContextMenuAction`:
  - `'generate-conversation' | 'generate-table' | 'import-document'` (import-document optional for folder RMB alignment; not required for this task)
- Document menu (admin generate; editor/admin rename/delete per existing helpers):
  1. Generate conversation  
  2. Generate table  
  3. Rename  
  4. Delete  
  - Keep or drop Move to… (spec: not a focus — **keep** behind rename for editors/admins to avoid regressions)
- Derived library (`isDerivedLibrary`): only Rename + Delete (no Export, Version history, Library info, Duplicate, Move).
- `startDocumentExport.ts`:

```ts
export async function fetchDocumentExportSource(
  documentId: string,
  accessToken: string
): Promise<DocumentExportSource>;

export function handoffDocumentTableExport(
  projectId: string,
  source: DocumentExportSource
): void; // saveDesignHandoff + dispatch DESIGN_UPLOAD_EVENT
```

- [ ] **Step 1: Update derived-menu unit test expectations**

Change existing test that expects `Library info` for derived libraries:

```ts
expect(markup).toContain('Rename');
expect(markup).toContain('Delete');
expect(markup).not.toContain('Library info');
expect(markup).not.toContain('Export');
expect(markup).not.toContain('Duplicate');
expect(markup).not.toContain('Move to...');
```

Add document menu test expecting Generate conversation / Generate table for admin.

- [ ] **Step 2: Run — FAIL on old derived markup**

Run: `npx jest tests/unit/documents/document-derived-sidebar.test.tsx --runInBand`

- [ ] **Step 3: Implement ContextMenu branches**

```tsx
} else if (type === 'document') {
  return (
    <>
      {userRole === 'admin' && (
        <>
          <button className={styles.menuItem} onClick={() => handleAction('generate-conversation')}>
            Generate conversation
          </button>
          <button className={styles.menuItem} onClick={() => handleAction('generate-table')}>
            Generate table
          </button>
        </>
      )}
      {showEditButton && (
        <button className={styles.menuItem} onClick={() => handleAction('rename')}>Rename</button>
      )}
      {/* existing Move to... optional */}
      {showDeleteButton && (/* Delete */)}
    </>
  );
} else if (type === 'library' && isDerivedLibrary) {
  return (
    <>
      {showEditButton && (
        <button className={styles.menuItem} onClick={() => handleAction('rename')}>Rename</button>
      )}
      {showDeleteButton && (/* Delete */)}
    </>
  );
}
```

For ordinary libraries keep the previous full menu.

- [ ] **Step 4: Implement `startDocumentExport` + action handlers**

In `useSidebarContextMenuActions`:

```ts
if (action === 'generate-table' && contextMenu.type === 'document') {
  if (userRole !== 'admin') { closeContextMenu(); return; }
  // get session token via supabase.auth.getSession()
  // source = await fetchDocumentExportSource(contextMenu.id, token)
  // handoffDocumentTableExport(currentIds.projectId!, source)
  closeContextMenu();
  return;
}
if (action === 'generate-conversation' && contextMenu.type === 'document') {
  if (userRole !== 'admin') { closeContextMenu(); return; }
  // fetch source, then call injected openDocumentScriptExport(source)
  closeContextMenu();
  return;
}
```

Add param `openDocumentScriptExport: (source: DocumentExportSource) => void` to the hook. In `Sidebar.tsx`, hold `scriptExportSource` state and pass into `ImportScriptModal` `documentSource` (same props as `DocumentEditor`).

On script import success, call `notifyDocumentDerivedLibraryCreated`.

Rename actions for `library` and `folder`: use `startInlineRename(\`library-${id}\`)` / `startInlineRename(\`folder-${id}\`)` instead of Edit modals.

- [ ] **Step 5: Tests PASS; commit**

```bash
git commit -m "feat(sidebar): document generate actions and slim derived menus"
```

---

### Task 5: Folder duplicate

**Files:**
- Modify: `src/lib/services/libraryService.ts` — `duplicateLibrary(..., options?: { targetFolderId?: string | null; copyHeaderOnly?: boolean })` or add optional 4th/5th args carefully without breaking callers
- Modify: `src/lib/services/folderService.ts` — add `duplicateFolder`
- Modify: `useSidebarContextMenuActions` + Folder `+` `onDuplicate`
- Test: `tests/unit/services/folder-duplicate.test.ts`

**Interfaces:**
- Produces:

```ts
export async function duplicateFolder(
  supabase: SupabaseClient,
  folderId: string
): Promise<string>; // new folder id
```

Behavior:
1. Load folder; require admin (same as folder create/delete).
2. Create folder named `${name} (Copy)` (if conflict, `${name} (Copy 2)` …).
3. For each library in the folder where `source_document_id` is null: `duplicateLibrary` into the new folder (full data copy, not headers-only).
4. For each document in the folder: `createDocument` with same `name` (resolve conflicts) and `content` from `getDocument`.
5. Do **not** copy derived libraries (they stay owned by original documents only).
6. Return new folder id; caller invalidates `['folders-libraries', projectId]` + documents query and navigates to the new folder.

- [ ] **Step 1: Write failing service unit test with mocked supabase**

Follow existing service test patterns in `tests/unit/` (mock from/insert/select chain). Assert:
- new folder insert called with `(Copy)` name
- `duplicateLibrary` not required if fully inlined — assert library insert uses new `folder_id`
- derived libraries (`source_document_id` set) are skipped

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `duplicateFolder` + wire Duplicate in Folder `+` and folder RMB**

Replace the current folder duplicate no-op in `useSidebarContextMenuActions`.

- [ ] **Step 4: PASS; commit**

```bash
git commit -m "feat(folders): duplicate folder with libraries and documents"
```

---

### Task 6: Smoke verification + e2e label sweep

**Files:**
- Modify any remaining `Create new library` user-facing strings in sidebar/e2e that should say table
- Manual / automated checks per acceptance list

- [ ] **Step 1: Grep for stale copy**

Run: `rg "Create new library|Generate tables from document" src tests -g '!**/docs/**'`

Fix leftovers that are user-visible in the sidebar add flow.

- [ ] **Step 2: Run focused unit suites**

```bash
npx jest tests/unit/layout/add-library-menu.test.tsx tests/unit/api/import-folder-id.test.ts tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/services/folder-duplicate.test.ts --runInBand
```

Expected: all PASS.

- [ ] **Step 3: Manual acceptance (dev server)**

1. Libraries `+`: five items; Import table creates root library.  
2. Folder `+`: menu not instant create; create/import scoped; delete/rename/duplicate work.  
3. Document RMB: generate conversation/table; expand arrow after success.  
4. Child RMB: delete/rename only.  
5. Double-click rename + Enter everywhere in scope.

- [ ] **Step 4: Final commit if copy fixes remain**

```bash
git commit -m "chore(sidebar): finish interaction redesign acceptance fixes"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Libraries `+` five items, no delete/rename, no generate shortcut | 1 |
| Create new table = NewLibraryModal | 1 |
| Import table Excel | 1–2 |
| Root import table | 2 |
| Folder `+` menu replaces instant new library | 3 |
| Folder menu create/import/delete/rename/duplicate | 3, 5 |
| No nested create folder on Folder `+` | 3 |
| Document LMB navigate (unchanged) | — (no change) |
| Document RMB generate conversation/table/delete/rename | 4 |
| Expand after generate | 4 (existing notify + expand) |
| Derived child slim RMB | 4 |
| Inline rename via double-click + menu | 4 (folder/library) + existing document |
| Folder duplicate implemented (not silent no-op) | 5 |
| Admin-only generate | 4 |
| E2E label updates | 1, 6 |
