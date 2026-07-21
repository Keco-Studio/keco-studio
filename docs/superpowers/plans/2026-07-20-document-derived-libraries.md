# Document-Derived Tables and Scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators generate table and script libraries from an existing project document and manage those libraries as strict, expandable children of that document.

**Architecture:** Add a nullable document-ownership relation to `libraries`, enforce same-project/same-folder placement and cascade deletion in PostgreSQL, and reuse the existing table-generation and script-import pipelines after a shared server endpoint freezes the document's latest logical state. Persist table-export context in the dedicated Agent conversation, pass script-export context through the existing import route, and build the sidebar hierarchy from the new relation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.9, Supabase/PostgreSQL RLS, TanStack Query, Ant Design Tree/Dropdown, Jest 30, Playwright 1.57.

## Global Constraints

- The document download dropdown is one ungrouped list ordered `Download DOCX`, `Download PDF`, `Download MDX`, `Export as tables`, `Export as script`.
- Only administrators can see or execute the two project-content exports.
- Every export creates a new library; existing exports never update automatically.
- Derived libraries can be renamed, edited, versioned, and individually deleted, but cannot be moved or detached.
- Moving a document moves every derived library atomically; deleting a document cascades to every derived library.
- A root-level document can export both tables and scripts.
- Ordinary libraries, external design upload, file/text script import, and DOCX/PDF/MDX downloads keep their current behavior.
- Read export content through `documentStateGateway`; do not trust the stale `documents.content` projection.
- Do not add a generalized tree-node abstraction or a new dependency.

## File Map

- `supabase/migrations/20260720000000_document_derived_libraries.sql`: ownership columns, constraints, validation trigger, move-follow trigger, index, grants.
- `src/lib/services/documentDerivedLibraryService.ts`: shared export types and server-validated source-document placement.
- `src/lib/documents/documentExportSource.ts`: browser/server-safe frozen snapshot DTO.
- `src/lib/services/libraryService.ts`: expose ownership fields, create derived libraries, and reject independent moves.
- `src/lib/server/documentExportSourceService.ts`: authorize admin access and freeze the latest logical document state.
- `src/app/api/documents/[documentId]/export-source/route.ts`: authenticated snapshot endpoint used by both menu actions.
- `src/lib/documents/documentDerivedLibraryEvents.ts`: typed browser event for sidebar refresh/expansion after creation.
- `src/lib/design-upload-handoff.ts`, `src/components/agent/types.ts`, `src/components/agent/useAgentChat.ts`, `src/components/agent/ChatPanel.tsx`: carry a table-export source into a fresh Agent conversation.
- `src/lib/agent/types.ts`, `src/lib/agent/conversation-meta.ts`, `src/lib/agent/conversation-store.ts`, `src/app/api/agent-chat/route.ts`, `src/app/api/agent-chat/confirm/route.ts`: validate and persist the table-export binding.
- `src/lib/agent/data-access.ts`, `src/lib/agent/workflows/setup-library.ts`, `src/lib/agent/tools/create-library.ts`: create table libraries under the bound document.
- `src/lib/services/scriptImportService.ts`, `src/app/api/import-script/route.ts`, `src/components/libraries/ImportScriptModal.tsx`: document-backed script source and nullable root placement.
- `src/components/documents/DocumentEditor.tsx`: five menu entries, snapshot acquisition, table handoff, and document-mode script modal.
- `src/components/layout/hooks/useSidebarTree.tsx`, `src/components/layout/components/SidebarTreeView.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/ContextMenu.tsx`, `src/components/layout/hooks/useSidebarContextMenuActions.ts`: nested display, expansion, lifecycle refresh, move guard, and delete count.
- `src/lib/queryInvalidation.ts`, `src/components/agent/useAgentChat.ts`: refresh the folders/libraries tree after derived creation.

---

### Task 1: Enforce Document Ownership in PostgreSQL

**Files:**
- Create: `supabase/migrations/20260720000000_document_derived_libraries.sql`
- Create: `tests/unit/database/document-derived-libraries-migration.test.ts`
- Create: `tests/unit/database/document-derived-libraries.rls.behavior.test.ts`

**Interfaces:**
- Produces: `libraries.source_document_id uuid | null` and `libraries.document_export_type 'table' | 'script' | null`.
- Produces: database-enforced same-project/same-folder placement, document-move propagation, and document-delete cascade.
- Consumes: existing `documents`, `libraries`, `folders`, and project membership helpers.

- [ ] **Step 1: Write the failing static migration contract test**

```ts
// tests/unit/database/document-derived-libraries-migration.test.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260720000000_document_derived_libraries.sql'
);
const sql = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('document-derived libraries migration', () => {
  it('adds paired ownership metadata and a source lookup index', () => {
    expect(sql).toMatch(/source_document_id uuid\s+references public\.documents\(id\) on delete cascade/i);
    expect(sql).toMatch(/document_export_type text/i);
    expect(sql).toMatch(/document_export_type in \('table', 'script'\)/i);
    expect(sql).toContain('idx_libraries_source_document_id');
    expect(sql).toContain('libraries_document_export_pair_check');
  });

  it('validates project and folder ownership and follows document moves', () => {
    expect(sql).toContain('enforce_derived_library_document');
    expect(sql).toContain('trg_libraries_derived_document');
    expect(sql).toContain('sync_derived_library_folder');
    expect(sql).toMatch(/after update of folder_id on public\.documents/i);
    expect(sql).toMatch(/update public\.libraries[\s\S]+source_document_id = new\.id/i);
  });
});
```

- [ ] **Step 2: Run the static test and verify the missing migration fails**

Run: `npx jest tests/unit/database/document-derived-libraries-migration.test.ts --runInBand`

Expected: FAIL because the migration file is absent and `sql` is empty.

- [ ] **Step 3: Create the migration with complete invariants**

```sql
-- supabase/migrations/20260720000000_document_derived_libraries.sql
alter table public.libraries
  add column if not exists source_document_id uuid
    references public.documents(id) on delete cascade,
  add column if not exists document_export_type text;

alter table public.libraries
  add constraint libraries_document_export_type_check
    check (document_export_type is null or document_export_type in ('table', 'script')),
  add constraint libraries_document_export_pair_check
    check ((source_document_id is null) = (document_export_type is null));

create index if not exists idx_libraries_source_document_id
  on public.libraries(source_document_id)
  where source_document_id is not null;

create or replace function public.enforce_derived_library_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
begin
  if new.source_document_id is null then
    return new;
  end if;

  select d.* into v_document
  from public.documents d
  where d.id = new.source_document_id;

  if not found then
    raise exception 'Source document not found' using errcode = '23503';
  end if;
  if v_document.project_id <> new.project_id then
    raise exception 'Derived library must belong to the source document project'
      using errcode = '23514';
  end if;
  if v_document.folder_id is distinct from new.folder_id then
    raise exception 'Derived library must follow the source document folder'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_libraries_derived_document
before insert or update of project_id, folder_id, source_document_id, document_export_type
on public.libraries
for each row execute function public.enforce_derived_library_document();

create or replace function public.sync_derived_library_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.libraries
  set folder_id = new.folder_id,
      updated_at = now()
  where source_document_id = new.id
    and folder_id is distinct from new.folder_id;
  return new;
end;
$$;

create trigger trg_documents_sync_derived_library_folder
after update of folder_id on public.documents
for each row
when (old.folder_id is distinct from new.folder_id)
execute function public.sync_derived_library_folder();

revoke all on function public.enforce_derived_library_document() from public, anon, authenticated;
revoke all on function public.sync_derived_library_folder() from public, anon, authenticated;
```

- [ ] **Step 4: Add a live database behavior test for cascade, move, and rejection**

```ts
// tests/unit/database/document-derived-libraries.rls.behavior.test.ts
import { describe, expect, it } from '@jest/globals';
import { RLS_DB_TESTS_ENABLED, buildProjectFixture, teardownProjectFixture } from './helpers/rlsTestClient';

const describeDb = RLS_DB_TESTS_ENABLED ? describe : describe.skip;

describeDb('document-derived library database invariants', () => {
  it('follows a document move, rejects independent movement, and cascades deletion', async () => {
    const fx = await buildProjectFixture();
    try {
      const { data: doc } = await fx.svc.from('documents').insert({
        project_id: fx.projectId,
        name: `source-${fx.suffix}`,
        content: '',
        created_by: fx.owner.id,
      }).select('id').single();
      const { data: child } = await fx.svc.from('libraries').insert({
        project_id: fx.projectId,
        folder_id: null,
        name: `child-${fx.suffix}`,
        source_document_id: doc!.id,
        document_export_type: 'table',
      }).select('id').single();

      const folder = await fx.svc.from('folders').insert({
        project_id: fx.projectId,
        name: `target-${fx.suffix}`,
      }).select('id').single();
      expect((await fx.svc.from('documents').update({ folder_id: folder.data!.id }).eq('id', doc!.id)).error).toBeNull();
      expect((await fx.svc.from('libraries').select('folder_id').eq('id', child!.id).single()).data?.folder_id)
        .toBe(folder.data!.id);

      expect((await fx.svc.from('libraries').update({ folder_id: null }).eq('id', child!.id)).error).not.toBeNull();
      expect((await fx.svc.from('documents').delete().eq('id', doc!.id)).error).toBeNull();
      expect((await fx.svc.from('libraries').select('id').eq('id', child!.id)).data).toEqual([]);
    } finally {
      await teardownProjectFixture(fx);
    }
  });
});
```

- [ ] **Step 5: Run migration tests**

Run: `npx jest tests/unit/database/document-derived-libraries-migration.test.ts tests/unit/database/document-derived-libraries.rls.behavior.test.ts --runInBand`

Expected: PASS. The live suite may report skipped when `RLS_DB_TESTS_ENABLED` is false; run it again against local Supabase during Task 7.

- [ ] **Step 6: Commit the database contract**

```bash
git add supabase/migrations/20260720000000_document_derived_libraries.sql tests/unit/database/document-derived-libraries-migration.test.ts tests/unit/database/document-derived-libraries.rls.behavior.test.ts
git commit -m "feat: enforce document-owned libraries"
```

### Task 2: Add Shared Derived-Library and Snapshot Services

**Files:**
- Create: `src/lib/services/documentDerivedLibraryService.ts`
- Create: `src/lib/documents/documentExportSource.ts`
- Create: `src/lib/server/documentExportSourceService.ts`
- Create: `src/app/api/documents/[documentId]/export-source/route.ts`
- Create: `tests/unit/documents/document-export-source-service.test.ts`
- Create: `tests/unit/documents/document-export-source-route.test.ts`
- Modify: `src/lib/services/libraryService.ts`
- Modify: `tests/unit/documents/document-service.test.ts`

**Interfaces:**
- Produces: `DocumentExportType`, `DocumentLibrarySource`, `DerivedLibraryPlacement`.
- Produces: `resolveDerivedLibraryPlacement(supabase, projectId, source): Promise<DerivedLibraryPlacement>`.
- Produces: browser/server-safe `DocumentExportSource` from `src/lib/documents/documentExportSource.ts`.
- Produces: `getDocumentExportSource(supabase, userId, documentId): Promise<DocumentExportSource>`.
- Produces: `GET /api/documents/:documentId/export-source -> DocumentExportSource`.
- Consumes: Task 1 database columns and `documentStateGateway.read`.

- [ ] **Step 1: Write failing service tests**

```ts
// Core assertions for tests/unit/documents/document-export-source-service.test.ts
await expect(getDocumentExportSource(supabase, 'admin-id', DOCUMENT_ID)).resolves.toEqual({
  documentId: DOCUMENT_ID,
  documentName: 'World Notes',
  projectId: PROJECT_ID,
  folderId: null,
  markdown: '# Latest\nBody',
  token: { epoch: 2, revision: 7 },
});
expect(documentStateGateway.read).toHaveBeenCalledWith(supabase, DOCUMENT_ID);

await expect(getDocumentExportSource(supabase, 'editor-id', DOCUMENT_ID))
  .rejects.toThrow('Only admin users can export project content');
```

Add library-service assertions that a derived create resolves its source document, inserts both metadata fields with the document folder, and that `moveLibraryToFolder` rejects a row with `source_document_id`.

- [ ] **Step 2: Run the focused tests and verify missing exports fail**

Run: `npx jest tests/unit/documents/document-export-source-service.test.ts tests/unit/documents/document-service.test.ts --runInBand`

Expected: FAIL because the new services and ownership properties do not exist.

- [ ] **Step 3: Implement the shared ownership contract**

```ts
// src/lib/services/documentDerivedLibraryService.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type DocumentExportType = 'table' | 'script';
export type DocumentLibrarySource = {
  sourceDocumentId: string;
  exportType: DocumentExportType;
};
export type DerivedLibraryPlacement = {
  projectId: string;
  folderId: string | null;
  sourceDocumentId: string;
  documentExportType: DocumentExportType;
};

export async function resolveDerivedLibraryPlacement(
  supabase: SupabaseClient,
  projectId: string,
  source: DocumentLibrarySource
): Promise<DerivedLibraryPlacement> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, project_id, folder_id')
    .eq('id', source.sourceDocumentId)
    .single();
  if (error || !data || data.project_id !== projectId) {
    throw new Error('Source document not found in this project');
  }
  return {
    projectId,
    folderId: data.folder_id ?? null,
    sourceDocumentId: data.id,
    documentExportType: source.exportType,
  };
}
```

Extend `Library` with `source_document_id` and `document_export_type`; extend `CreateLibraryInput` with `documentSource?: DocumentLibrarySource`. In `createLibrary`, resolve derived placement after the existing admin permission check and insert:

```ts
const placement = input.documentSource
  ? await resolveDerivedLibraryPlacement(supabase, projectId, input.documentSource)
  : null;

const { data, error } = await supabase.from('libraries').insert({
  project_id: projectId,
  folder_id: placement?.folderId ?? folderId,
  name,
  description,
  source_document_id: placement?.sourceDocumentId ?? null,
  document_export_type: placement?.documentExportType ?? null,
}).select('id').single();
```

Reject independent moves before folder/name checks:

```ts
if (library.source_document_id) {
  throw new Error('Libraries generated from a document move with their source document');
}
```

- [ ] **Step 4: Implement the admin-only frozen export source**

```ts
// src/lib/documents/documentExportSource.ts
export type DocumentExportSource = {
  documentId: string;
  documentName: string;
  projectId: string;
  folderId: string | null;
  markdown: string;
  token: { epoch: number; revision: number };
};
```

```ts
// src/lib/server/documentExportSourceService.ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentExportSource } from '@/lib/documents/documentExportSource';
import { documentStateGateway } from '@/lib/documents/documentStateGateway';
import { getUserProjectRole } from '@/lib/services/authorizationService';

export async function getDocumentExportSource(
  supabase: SupabaseClient,
  userId: string,
  documentId: string
): Promise<DocumentExportSource> {
  const state = await documentStateGateway.read(supabase, documentId);
  const { role } = await getUserProjectRole(supabase, state.projectId, userId);
  if (role !== 'admin') throw new Error('Only admin users can export project content');
  const { data, error } = await supabase
    .from('documents')
    .select('name, folder_id')
    .eq('id', documentId)
    .single();
  if (error || !data) throw new Error('Document not found or not accessible');
  if (!state.markdown.trim()) throw new Error('Document is empty');
  return {
    documentId,
    documentName: data.name,
    projectId: state.projectId,
    folderId: data.folder_id ?? null,
    markdown: state.markdown,
    token: state.token,
  };
}
```

The new route validates UUID input, calls this service with `user.id`, returns `{ source }` and `Cache-Control: private, no-store`, maps permission errors to 403, empty content to 400, missing documents to 404, and unexpected errors to 500 without leaking internal messages.

- [ ] **Step 5: Run service and route tests**

Run: `npx jest tests/unit/documents/document-export-source-service.test.ts tests/unit/documents/document-export-source-route.test.ts tests/unit/documents/document-service.test.ts --runInBand`

Expected: PASS with admin latest-state, editor rejection, empty-document, invalid UUID, and no-store assertions covered.

- [ ] **Step 6: Commit the shared services**

```bash
git add src/lib/services/documentDerivedLibraryService.ts src/lib/documents/documentExportSource.ts src/lib/services/libraryService.ts src/lib/server/documentExportSourceService.ts 'src/app/api/documents/[documentId]/export-source/route.ts' tests/unit/documents/document-export-source-service.test.ts tests/unit/documents/document-export-source-route.test.ts tests/unit/documents/document-service.test.ts
git commit -m "feat: expose validated document export sources"
```

### Task 3: Bind Table Generation to Its Source Document

**Files:**
- Modify: `src/lib/design-upload-handoff.ts`
- Modify: `src/components/agent/types.ts`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/components/agent/ChatPanel.tsx`
- Modify: `src/lib/agent/types.ts`
- Modify: `src/lib/agent/conversation-meta.ts`
- Modify: `src/lib/agent/conversation-store.ts`
- Modify: `src/app/api/agent-chat/route.ts`
- Modify: `src/app/api/agent-chat/confirm/route.ts`
- Modify: `src/lib/agent/data-access.ts`
- Modify: `src/lib/agent/workflows/setup-library.ts`
- Modify: `src/lib/agent/tools/create-library.ts`
- Modify: `src/app/(dashboard)/[projectId]/design-upload/page.tsx`
- Modify: `tests/unit/agent/conversation-meta.test.ts`
- Create: `tests/unit/agent/document-table-export-context.test.ts`
- Modify: `tests/unit/design-upload-document-wiring.test.ts`
- Modify: `tests/e2e/specs/design-upload.spec.ts`

**Interfaces:**
- Produces: `DocumentTableExportContext = { sourceDocumentId: string; exportType: 'table' }` in conversation meta and `ToolContext.documentExport`.
- Produces: `SendOptions.documentExport?: DocumentTableExportContext`.
- Changes: `createLibraryServer(..., documentSource?: DocumentLibrarySource)`.
- Consumes: Task 2 `DocumentLibrarySource` and derived `createLibrary` support.

- [ ] **Step 1: Write failing context persistence tests**

```ts
// Key assertions in tests/unit/agent/document-table-export-context.test.ts
const documentExport = { sourceDocumentId: DOCUMENT_ID, exportType: 'table' as const };
expect(metaForSave(false, scope, documentExport)).toEqual({
  autoExecute: false,
  scope,
  documentExport,
});
expect(resolveConversationMeta({ autoExecute: false, documentExport })).toEqual({
  autoExecute: false,
  documentExport,
});

await setupLibrary.executeImport!(preview, params, { ...ctx, documentExport });
expect(createLibraryServer).toHaveBeenCalledWith(
  ctx.supabase,
  PROJECT_ID,
  'Characters',
  undefined,
  undefined,
  documentExport
);
```

Also assert that preview preparation ignores an LLM-supplied folder and displays the source document's current folder. Assert that the Agent route rejects a document-export context for an editor, rejects cross-project document IDs, accepts it only on new conversations, persists it through `getOrCreateConversation`, and reconstructs it on `/confirm` from conversation meta rather than the request body.

- [ ] **Step 2: Run the tests and verify the context is dropped**

Run: `npx jest tests/unit/agent/conversation-meta.test.ts tests/unit/agent/document-table-export-context.test.ts tests/unit/agent/document-context-route.test.ts --runInBand`

Expected: FAIL because `documentExport` is not part of meta, send options, routes, or tool creation.

- [ ] **Step 3: Add and preserve the typed conversation binding**

```ts
// src/lib/agent/types.ts
export interface DocumentTableExportContext {
  sourceDocumentId: string;
  exportType: 'table';
}

export interface ConversationMeta {
  autoExecute?: boolean;
  skipConfirmation?: boolean;
  scope?: ConversationScope;
  documentExport?: DocumentTableExportContext;
}
```

Add this member to the existing `ToolContext` interface:

```ts
documentExport?: DocumentTableExportContext;
```

Change `metaForSave` to accept and include `documentExport`, and make `resolveConversationMeta` preserve it. Extend `getOrCreateConversation` with `documentExport?: DocumentTableExportContext` for new conversations only. Update `updateConversationMeta` so an auto-execute mode change preserves both the frozen `scope` and `documentExport`. In both Agent routes, set `toolContext.documentExport = boundMeta.documentExport`; never accept a new binding for an existing conversation or from the confirmation body.

The initial Agent route must validate the requested source with `getDocumentExportSource`. Accept only `exportType === 'table'`, an authenticated admin, and a source whose `projectId` equals the new conversation project.

- [ ] **Step 4: Thread the binding from the handoff to the Agent request**

```ts
// src/lib/design-upload-handoff.ts
import type { DocumentTableExportContext } from '@/lib/agent/types';

export interface DesignUploadHandoff {
  message: string;
  fileName: string;
  documentId?: string;
  imageUrls?: string[];
  timestamp: number;
  documentExport?: DocumentTableExportContext;
}

// src/components/agent/types.ts
import type { DocumentTableExportContext } from '@/lib/agent/types';

export interface SendOptions {
  imageUrls?: string[];
  selectionContext?: AgentSelectionContext;
  documentExport?: DocumentTableExportContext;
}
```

`ChatPanel.consumeDesignHandoff` calls:

```ts
void send(handoff.message, {
  imageUrls: handoff.imageUrls,
  documentExport: handoff.documentExport,
});
```

`useAgentChat.send` includes `documentExport` only in the new-conversation request body. Update the external design upload page so its handoff attaches the imported document:

```ts
documentExport: {
  sourceDocumentId: imported.document.id,
  exportType: 'table',
},
```

Change the page permission gate from “not viewer” to `role === 'admin'`. Render `Only administrators can generate tables from a design document.` and disable file selection/submission for both editor and viewer roles. Extend `tests/unit/design-upload-document-wiring.test.ts` and `tests/e2e/specs/design-upload.spec.ts` with the editor case so the UI matches the server-side export binding rule.

- [ ] **Step 5: Attach every Agent-created table to the bound document**

Change the data-access signature and both creation tools:

```ts
export async function createLibraryServer(
  supabase: SupabaseClient,
  projectId: string,
  name: string,
  folderId?: string,
  description?: string,
  documentSource?: DocumentLibrarySource
): Promise<string> {
  return createLibrary(supabase, {
    projectId,
    name,
    folderId,
    description,
    documentSource,
  });
}
```

`setup_library.executeImport` and `create_library.execute` pass `ctx.documentExport`. During preview/preparation, both tools ignore an LLM-supplied folder when `ctx.documentExport` exists and resolve the source document's current folder/name for display. Do not expose source IDs in the LLM tool schema. The server-derived conversation binding is authoritative, and `createLibrary` resolves the document's current folder again at final write time.

- [ ] **Step 6: Run the Agent and upload tests**

Run: `npx jest tests/unit/agent/conversation-meta.test.ts tests/unit/agent/document-table-export-context.test.ts tests/unit/agent/document-context-route.test.ts tests/unit/design-upload-document-wiring.test.ts --runInBand`

Expected: PASS, including confirmation-resume preservation and external upload attachment.

- [ ] **Step 7: Commit the table-generation binding**

```bash
git add src/lib/design-upload-handoff.ts src/components/agent/types.ts src/components/agent/useAgentChat.ts src/components/agent/ChatPanel.tsx src/lib/agent/types.ts src/lib/agent/conversation-meta.ts src/lib/agent/conversation-store.ts src/app/api/agent-chat/route.ts src/app/api/agent-chat/confirm/route.ts src/lib/agent/data-access.ts src/lib/agent/workflows/setup-library.ts src/lib/agent/tools/create-library.ts 'src/app/(dashboard)/[projectId]/design-upload/page.tsx' tests/unit/agent/conversation-meta.test.ts tests/unit/agent/document-table-export-context.test.ts tests/unit/agent/document-context-route.test.ts tests/unit/design-upload-document-wiring.test.ts tests/e2e/specs/design-upload.spec.ts
git commit -m "feat: bind generated tables to source documents"
```

### Task 4: Export Scripts from a Frozen Project Document

**Files:**
- Modify: `src/lib/services/scriptImportService.ts`
- Modify: `src/app/api/import-script/route.ts`
- Modify: `src/components/libraries/ImportScriptModal.tsx`
- Modify: `src/components/libraries/ImportScriptModal.module.css`
- Modify: `tests/unit/api-import-script-route.test.ts`
- Modify: `src/lib/services/scriptImportService.test.ts`
- Modify: `tests/unit/import-script-modal-copy.test.ts`
- Create: `tests/unit/documents/document-script-export.test.tsx`

**Interfaces:**
- Changes: `ImportTableParams.folderId: string | null`.
- Changes: `ImportTableParams.documentSource?: DocumentLibrarySource`.
- Changes: `ImportScriptModalProps.folderId: string | null`.
- Adds: `ImportScriptModalProps.documentSource?: DocumentExportSource`.
- Consumes: Task 2 frozen export source and derived placement resolver.

- [ ] **Step 1: Write failing service and route tests**

Add service coverage for:

```ts
await importStoryDocument(supabase, {
  userId: ADMIN_ID,
  projectId: PROJECT_ID,
  folderId: null,
  libraryName: 'Main Story',
  document: storyDocument,
  fileName: 'Main Story.txt',
  documentSource: { sourceDocumentId: DOCUMENT_ID, exportType: 'script' },
});

expect(librariesInsert).toHaveBeenCalledWith(expect.objectContaining({
  project_id: PROJECT_ID,
  folder_id: null,
  source_document_id: DOCUMENT_ID,
  document_export_type: 'script',
}));
```

Add route coverage proving `sourceDocumentId` makes `folderId` optional, the route resolves the source document before writing, non-admin/cross-project requests fail, and ordinary file/text imports still require a UUID folder.

- [ ] **Step 2: Run focused tests and verify root document import fails**

Run: `npx jest src/lib/services/scriptImportService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/import-script-modal-copy.test.ts tests/unit/documents/document-script-export.test.tsx --runInBand`

Expected: FAIL because folder IDs are mandatory and the modal has no document source mode.

- [ ] **Step 3: Make script persistence source-aware**

Update the script import parameter and library insert:

```ts
interface ImportTableParams {
  userId: string;
  projectId: string;
  folderId: string | null;
  libraryName: string;
  fileName: string;
  documentSource?: DocumentLibrarySource;
}

const placement = documentSource
  ? await resolveDerivedLibraryPlacement(supabase, projectId, documentSource)
  : null;
const resolvedFolderId = placement?.folderId ?? folderId;

const { data: createdLibrary, error } = await supabase.from('libraries').insert({
  project_id: projectId,
  folder_id: resolvedFolderId,
  name: libraryName,
  description: `Imported from ${fileName}`,
  source_document_id: placement?.sourceDocumentId ?? null,
  document_export_type: placement?.documentExportType ?? null,
}).select('id').single();
```

For ordinary imports, preserve the existing folder UUID and same-project validation. For document imports, ignore a client folder value and resolve the document's current folder immediately before insertion.

- [ ] **Step 4: Add document mode to the import route and modal**

The route parses optional `sourceDocumentId`. When present, it validates the UUID and passes the submitted frozen file content through the existing conversion pipeline. `importStoryDocument` performs the existing administrator creation check and calls `resolveDerivedLibraryPlacement` immediately before insertion. That verifies the source still exists in the same project and supplies its current folder without rereading or replacing the frozen content. Call it with:

```ts
folderId: null,
documentSource: {
  sourceDocumentId,
  exportType: 'script',
},
```

The modal accepts `documentSource`. In document mode it initializes a private frozen text state from `documentSource.markdown`, renders the document name and preview, hides both file/text tabs, and appends `sourceDocumentId` to `FormData`. It does not refetch or mutate the frozen markdown after opening.

```tsx
{documentSource ? (
  <div className={styles.documentSource} data-testid="import-script-document-source">
    <span className={styles.documentSourceLabel}>Project document</span>
    <strong>{documentSource.documentName}</strong>
  </div>
) : null}
```

Wrap the existing tab container and existing file/text input branch in `!documentSource && (...)`; do not duplicate or alter their controls.

- [ ] **Step 5: Run script export tests**

Run: `npx jest src/lib/services/scriptImportService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/import-script-modal-copy.test.ts tests/unit/documents/document-script-export.test.tsx --runInBand`

Expected: PASS for root/folder document sources, ordinary modes, preview isolation, rollback, and permission rejection.

- [ ] **Step 6: Commit document-backed script import**

```bash
git add src/lib/services/scriptImportService.ts src/app/api/import-script/route.ts src/components/libraries/ImportScriptModal.tsx src/components/libraries/ImportScriptModal.module.css src/lib/services/scriptImportService.test.ts tests/unit/api-import-script-route.test.ts tests/unit/import-script-modal-copy.test.ts tests/unit/documents/document-script-export.test.tsx
git commit -m "feat: import scripts from project documents"
```

### Task 5: Wire the Five-Item Document Menu and Creation Events

**Files:**
- Create: `src/lib/documents/documentDerivedLibraryEvents.ts`
- Modify: `src/components/documents/DocumentEditor.tsx`
- Modify: `src/lib/design-message.ts`
- Modify: `tests/unit/documents/document-editor-export.test.tsx`
- Modify: `tests/unit/documents/document-export-route.test.ts`
- Modify: `tests/unit/design-message.test.ts`
- Modify: `src/components/agent/useAgentChat.ts`
- Modify: `src/lib/queryInvalidation.ts`
- Modify: `tests/unit/query-invalidation.test.ts`

**Interfaces:**
- Produces: `DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT` and `notifyDocumentDerivedLibraryCreated(detail)`.
- Produces: table action that saves a design handoff with a frozen Task 2 source.
- Produces: script action that opens Task 4 modal with the same frozen source.
- Changes: library invalidations may carry `projectId` and `sourceDocumentId` for tree refresh.

- [ ] **Step 1: Extend the DocumentEditor test harness with failing menu assertions**

```ts
it('renders five ungrouped items in order for an admin', () => {
  permissionRole = 'admin';
  expect(exportMenuItems().map((item) => item.label)).toEqual([
    'Download DOCX',
    'Download PDF',
    'Download MDX',
    'Export as tables',
    'Export as script',
  ]);
});

it.each(['editor', 'viewer'] as const)('hides project-content exports for %s', (role) => {
  permissionRole = role;
  expect(exportMenuItems().map((item) => item.label)).toEqual([
    'Download DOCX',
    'Download PDF',
    'Download MDX',
  ]);
});
```

Add action tests proving both actions await `collaboration.session.flush()`, fetch `/api/documents/:id/export-source`, table export saves and dispatches the design handoff, and script export opens the modal with exactly the returned snapshot.

- [ ] **Step 2: Run menu tests and verify only three items exist**

Run: `npx jest tests/unit/documents/document-editor-export.test.tsx tests/unit/documents/document-export-route.test.ts --runInBand`

Expected: FAIL on the admin five-item assertion and missing table/script handlers.

- [ ] **Step 3: Implement the two menu actions without changing downloads**

Use distinct keys and one ungrouped array:

```ts
const exportItems = [
  { key: 'docx', label: 'Download DOCX' },
  { key: 'pdf', label: 'Download PDF' },
  { key: 'mdx', label: 'Download MDX' },
  ...(permissions.role === 'admin'
    ? [
        { key: 'tables', label: 'Export as tables' },
        { key: 'script', label: 'Export as script' },
      ]
    : []),
];
```

Extract `loadExportSource` inside `DocumentEditorSession`: flush, fetch with the current session token, validate the response, and return `DocumentExportSource`. `tables` builds the existing design message from `source.markdown`, saves a handoff with `documentExport`, and dispatches `DESIGN_UPLOAD_EVENT`. `script` stores the source in state and renders `ImportScriptModal` with `folderId={source.folderId}` and `documentSource={source}`.

Extend `BuildDesignMessageParams` with `sourceKind?: 'upload' | 'project-document'`. For project documents, the instruction starts `The user selected the project document` instead of claiming the file was uploaded. Preserve the machine-readable headers so `parseDesignMessage` and compact chat display continue to work. Add a `tests/unit/design-message.test.ts` case for the project-document wording and unchanged parsing.

- [ ] **Step 4: Add one typed creation event and tree-aware invalidation**

```ts
// src/lib/documents/documentDerivedLibraryEvents.ts
export const DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT =
  'document-derived-library:created';

export type DocumentDerivedLibraryCreatedDetail = {
  projectId: string;
  documentId: string;
  libraryId: string;
};

export function notifyDocumentDerivedLibraryCreated(
  detail: DocumentDerivedLibraryCreatedDetail
): void {
  window.dispatchEvent(new CustomEvent(DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT, { detail }));
}
```

After script success, emit this event. Extend the Agent library invalidation shape with optional `projectId` and `sourceDocumentId`; both table creation tools populate them. `invalidateAgentCaches` calls `invalidateLibraryData` with the project/library IDs and emits the same event when `sourceDocumentId` is present.

- [ ] **Step 5: Run menu and invalidation tests**

Run: `npx jest tests/unit/documents/document-editor-export.test.tsx tests/unit/documents/document-export-route.test.ts tests/unit/design-message.test.ts tests/unit/query-invalidation.test.ts tests/unit/agent/document-table-export-context.test.ts --runInBand`

Expected: PASS, with existing binary download durability tests unchanged.

- [ ] **Step 6: Commit the menu workflow**

```bash
git add src/lib/documents/documentDerivedLibraryEvents.ts src/components/documents/DocumentEditor.tsx src/lib/design-message.ts src/components/agent/useAgentChat.ts src/lib/queryInvalidation.ts tests/unit/documents/document-editor-export.test.tsx tests/unit/documents/document-export-route.test.ts tests/unit/design-message.test.ts tests/unit/query-invalidation.test.ts tests/unit/agent/document-table-export-context.test.ts
git commit -m "feat: add document table and script exports"
```

### Task 6: Render and Protect the Document Subtree

**Files:**
- Modify: `src/components/layout/hooks/useSidebarTree.tsx`
- Modify: `src/components/layout/components/SidebarTreeView.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/ContextMenu.tsx`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Create: `tests/unit/documents/document-derived-sidebar.test.tsx`
- Modify: `tests/unit/documents/folder-document-create-action.test.ts`

**Interfaces:**
- Consumes: Task 1 ownership fields and Task 5 creation event.
- Produces: `document-${id}` parent nodes with `library-${id}` children.
- Produces: stale-UI move guards and derived-count deletion copy.

- [ ] **Step 1: Write failing pure tree and action tests**

Cover these exact cases in `document-derived-sidebar.test.tsx`:

```ts
expect(documentNode.isLeaf).toBe(false);
expect(documentNode.children?.map((child) => child.key)).toEqual([
  `library-${OLDER_TABLE_ID}`,
  `library-${NEWER_SCRIPT_ID}`,
]);
expect(rootKeys).not.toContain(`library-${OLDER_TABLE_ID}`);

expect(emptyDocumentNode.isLeaf).toBe(true);
expect(emptyDocumentNode.children).toBeUndefined();
```

Render `ContextMenu` with `type="library" isDerivedLibrary` and assert `Move to` is absent while Rename/Delete remain. Exercise the action hook with a stale derived row and assert `openMoveLibrary` is not called. Assert document delete copy is:

```text
Delete this document permanently? 2 tables and 1 script will also be deleted.
```

- [ ] **Step 2: Run the sidebar test and verify documents are leaves**

Run: `npx jest tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/documents/folder-document-create-action.test.ts --runInBand`

Expected: FAIL because derived libraries are still rendered as folder siblings and the move/delete rules do not exist.

- [ ] **Step 3: Group libraries beneath documents**

In `useSidebarTree`, build both `librariesByFolder` and `librariesByDocument`. Only put libraries with no `source_document_id` in the folder/root map. Sort derived children by `created_at`, then `id`, and reuse the existing library row renderer.

```ts
const children = [...(librariesByDocument.get(doc.id) ?? [])]
  .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  .map((library) => buildLibraryNode(library, true));

return {
  key: `document-${doc.id}`,
  isLeaf: children.length === 0,
  children: children.length ? children : undefined,
  // existing document title metadata
};
```

Add a document arrow branch in `SidebarTreeView.switcherIcon` using the existing expand/collapse arrow assets without wrapping the document in folder visuals.

- [ ] **Step 4: Enforce lifecycle UI and refresh behavior**

Add `isDerivedLibrary?: boolean` to `ContextMenu`; omit `move-to` for derived rows. In the action hook and `openMoveLibrary`, independently reject rows with `source_document_id` so stale menus cannot move them.

In `Sidebar`, listen for `DOCUMENT_DERIVED_LIBRARY_CREATED_EVENT`. When the event project matches, call `invalidateLibraryData(..., { refetchActiveFoldersLibraries: true })`, expand the parent folder when present, and add `document-${documentId}` to `expandedKeys`.

After document move or delete, invalidate the folders/libraries collection as well as documents. For delete confirmation, count the current `libraries` by `source_document_id` and `document_export_type`, pluralize deterministically, and state permanent cascade deletion.

- [ ] **Step 5: Run sidebar and lifecycle tests**

Run: `npx jest tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/documents/folder-document-create-action.test.ts tests/unit/query-invalidation.test.ts --runInBand`

Expected: PASS for hierarchy, ordering, leaf behavior, move suppression, delete counts, event expansion, move refresh, and delete refresh.

- [ ] **Step 6: Commit the nested sidebar**

```bash
git add src/components/layout/hooks/useSidebarTree.tsx src/components/layout/components/SidebarTreeView.tsx src/components/layout/Sidebar.tsx src/components/layout/ContextMenu.tsx src/components/layout/hooks/useSidebarContextMenuActions.ts tests/unit/documents/document-derived-sidebar.test.tsx tests/unit/documents/folder-document-create-action.test.ts
git commit -m "feat: nest generated libraries under documents"
```

### Task 7: End-to-End Lifecycle and Full Verification

**Files:**
- Create: `tests/e2e/specs/document-derived-libraries.spec.ts`
- Modify: implementation or focused tests from Tasks 1-6 only when this verification exposes a concrete defect.

**Interfaces:**
- Consumes: every prior task.
- Produces: browser-level proof of menu permissions, nesting, independent delete, atomic move, cascade delete, snapshot behavior, and root script support.

- [ ] **Step 1: Write the browser lifecycle test**

Create one serial fixture with admin, editor, viewer, a project, two folders, and two documents (one folder document and one root document). Use direct Supabase fixture inserts for derived library setup when the test is about hierarchy/lifecycle; mock only the long-running LLM conversion response when testing the two export buttons.

Required test cases and exact assertions:

- `admin sees five items while editor and viewer see three`: open the download dropdown under each role; assert the ordered visible labels and assert both export labels have count zero for editor/viewer.
- `table and script results appear once beneath their source document`: fulfill the long-running conversion endpoints, create one `table` and one `script` library carrying the source ID, wait for the creation-event refresh, expand the document, assert both labels beneath it, and assert neither label appears as a direct folder child.
- `moving a document moves its complete subtree`: move the document through `MoveDocumentModal`, assert the old folder no longer contains its node, assert the destination contains the document and both children, and query all three rows to verify the destination `folder_id`.
- `deleting one child preserves the document and sibling`: delete the table child through its context menu, query that the table is absent, query that the document and script remain, and assert the script is still rendered beneath the document.
- `deleting the document cascades every child`: assert the confirmation contains exact table/script counts, approve it, then query that the document and all source-linked libraries are absent.
- `a root document exports a script from its frozen snapshot`: intercept the export-source response with known markdown, open document script mode, assert the preview, change the document row after the modal opens, submit, and assert the request contains the original text plus `sourceDocumentId`; verify the created library has null `folder_id` and `document_export_type = 'script'`.

- [ ] **Step 2: Apply the migration to local Supabase and run live database tests**

Run: `supabase migration up --local`

Expected: migration `20260720000000_document_derived_libraries.sql` applies successfully.

Run: `RLS_DB_TESTS=1 npx jest tests/unit/database/document-derived-libraries.rls.behavior.test.ts --runInBand`

Expected: PASS with no skipped tests.

- [ ] **Step 3: Run all focused unit suites**

Run:

```bash
npx jest \
  tests/unit/database/document-derived-libraries-migration.test.ts \
  tests/unit/database/document-derived-libraries.rls.behavior.test.ts \
  tests/unit/documents/document-export-source-service.test.ts \
  tests/unit/documents/document-export-source-route.test.ts \
  tests/unit/documents/document-service.test.ts \
  tests/unit/agent/conversation-meta.test.ts \
  tests/unit/agent/document-table-export-context.test.ts \
  tests/unit/agent/document-context-route.test.ts \
  tests/unit/design-upload-document-wiring.test.ts \
  src/lib/services/scriptImportService.test.ts \
  tests/unit/api-import-script-route.test.ts \
  tests/unit/import-script-modal-copy.test.ts \
  tests/unit/documents/document-script-export.test.tsx \
  tests/unit/documents/document-editor-export.test.tsx \
  tests/unit/documents/document-export-route.test.ts \
  tests/unit/design-message.test.ts \
  tests/unit/query-invalidation.test.ts \
  tests/unit/documents/document-derived-sidebar.test.tsx \
  tests/unit/documents/folder-document-create-action.test.ts \
  --runInBand
```

Expected: PASS with the live database suite enabled after Step 2.

- [ ] **Step 4: Run the focused Playwright suite**

Run: `npx playwright test tests/e2e/specs/document-derived-libraries.spec.ts tests/e2e/specs/design-upload.spec.ts tests/e2e/specs/script-import.spec.ts`

Expected: PASS on Chromium with no retries required.

- [ ] **Step 5: Run repository-wide static and unit verification**

Run: `npm run lint`

Expected: exit 0 with no ESLint errors.

Run: `npm run typecheck && npm run typecheck:api`

Expected: both TypeScript projects exit 0.

Run: `npm run test:unit -- --runInBand`

Expected: all unit suites pass.

Run: `npm run build`

Expected: Next.js production build exits 0.

- [ ] **Step 6: Review the final diff against the approved design**

Run: `git diff --check`

Expected: no output.

Review these requirements directly in the diff: ungrouped five-item order; admin-only export; repeated snapshot exports; derived move rejection; move follow; cascade delete; root script; no ordinary import/download regression; no unrelated refactor.

- [ ] **Step 7: Commit end-to-end coverage and any verified corrections**

```bash
git add tests/e2e/specs/document-derived-libraries.spec.ts
git add -u
git commit -m "test: cover document-derived library lifecycle"
```

Before committing, inspect `git status --short` and stage only files belonging to this feature.
