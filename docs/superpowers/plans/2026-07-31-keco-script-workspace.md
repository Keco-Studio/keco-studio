# Keco Script Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an independent Keco Script LeftNav mode: import Studio documents into a project workspace, edit them, Generate conversation to create script children, and view VN dialogue + Flow chart in a resizable split.

**Architecture:** Mirror Simulation’s product-mode pattern: `/script-system` routes + Script shell sidebar. Workspace membership is a thin `script_workspace_documents` reference table (no document copies). Generation reuses `runDocumentDerivedImport` (`exportType: 'script'`). Script child view loads library asset rows into `VisualNovelScriptView` and builds a read-only Flow chart from `Label` + `OptionN_Next` (Jump targets).

**Tech Stack:** Next.js App Router, React client components, CSS Modules, Supabase SQL + RLS, React Query (existing patterns), Jest unit/wiring tests, Playwright smoke optional.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-keco-script-workspace-design.md`
- Do **not** copy document bodies; references only.
- Hide Studio project-tree Sidebar and Agent ChatPanel on `/script-system*`.
- Script document RMB: no Generate table, no Move to; Delete removes workspace reference only.
- Studio RMB Generate table stays unchanged; Agent `exportType: 'table'` stays.
- Flow chart: custom SVG + simple layered layout — **no new graph library dependency**.
- Import Documentation helper copy (exact): `Choose a Studio document to add to Keco Script. After import you can edit it, then use Generate conversation to create a dialogue script and flow chart.`
- Document editor: embed existing `DocumentEditor` in Script doc route (same props as Studio doc page).
- Do not commit unless the user asks. Do not commit `.env.local` secrets.
- Prefer TDD: failing test → implement → green for each task.

## File map

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260731170000_script_workspace_documents.sql` | Table + RLS |
| `src/lib/script-system/projectPreference.ts` | localStorage preferred project |
| `src/lib/script-system/splitRatioStorage.ts` | Split pane ratio persistence |
| `src/lib/script-system/scriptWorkspaceService.ts` | List / upsert / delete references |
| `src/lib/script-system/buildScriptFlowGraph.ts` | Pure graph builder from script rows |
| `src/lib/script-system/parseJumpTarget.ts` | Shared Jump parser (or re-export from one place) |
| `src/app/api/script-workspace/[projectId]/route.ts` | GET list, POST upsert |
| `src/app/api/script-workspace/[projectId]/[documentId]/route.ts` | DELETE reference |
| `src/lib/utils/routeParams.ts` | Recognize `script-system` |
| `src/components/layout/LeftNav.tsx` | Speech icon + active rules |
| `src/components/layout/DashboardLayout.tsx` | Hide Studio sidebar/chat on Script; slot for Script chrome via children layout |
| `src/app/(dashboard)/script-system/layout.tsx` | Metadata |
| `src/app/(dashboard)/script-system/page.tsx` | Landing → preferred project or picker |
| `src/app/(dashboard)/script-system/[projectId]/layout.tsx` | Script shell (sidebar + main) |
| `src/app/(dashboard)/script-system/[projectId]/page.tsx` | Import Documentation |
| `src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx` | DocumentEditor + guard |
| `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx` | Split view |
| `src/components/script-system/*` | Sidebar, Import UI, picker, split, flow chart |

---

### Task 1: LeftNav Script icon + path helpers + DashboardLayout chrome

**Files:**
- Modify: `src/components/layout/LeftNav.tsx`
- Modify: `src/components/layout/DashboardLayout.tsx`
- Modify: `src/lib/utils/routeParams.ts`
- Create: `src/lib/script-system/projectPreference.ts`
- Create: `src/lib/script-system/isScriptSystemPath.ts`
- Test: `tests/unit/script-system/leftnav-script-wiring.test.ts`

**Interfaces:**
- Produces: `isScriptSystemPath(pathname: string | null): boolean`
- Produces: `readScriptProjectPreference(): { projectId: string; projectName: string } | null`
- Produces: `writeScriptProjectPreference(pref: { projectId: string; projectName: string }): void`
- Storage key: `keco.script.projectPreference`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Keco Script LeftNav wiring', () => {
  it('isScriptSystemPath matches /script-system prefix', async () => {
    const { isScriptSystemPath } = await import(
      '@/lib/script-system/isScriptSystemPath'
    );
    expect(isScriptSystemPath('/script-system')).toBe(true);
    expect(isScriptSystemPath('/script-system/abc')).toBe(true);
    expect(isScriptSystemPath('/simulation-system')).toBe(false);
    expect(isScriptSystemPath('/proj/doc/x')).toBe(false);
  });

  it('LeftNav includes Script control between Simulation and coming-soon', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toContain("aria-label=\"Script\"");
    expect(source).toContain('/script-system');
    const sim = source.indexOf("aria-label=\"Simulation\"");
    const script = source.indexOf("aria-label=\"Script\"");
    const soon = source.indexOf("aria-label=\"Coming soon\"");
    expect(sim).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(sim);
    expect(soon).toBeGreaterThan(script);
  });

  it('Studio active excludes script-system paths', () => {
    const source = read('src/components/layout/LeftNav.tsx');
    expect(source).toMatch(/!onSimulation\s*&&\s*!onScript|!onScript\s*&&\s*!onSimulation/);
  });

  it('DashboardLayout hides Studio sidebar and ChatPanel on script-system', () => {
    const source = read('src/components/layout/DashboardLayout.tsx');
    expect(source).toContain('isScriptSystemPath');
    expect(source).toMatch(/hideSidebarForSimulation|hideStudioChrome/);
  });

  it('routeParams lists script-system as special segment', () => {
    const source = read('src/lib/utils/routeParams.ts');
    expect(source).toContain("'script-system'");
  });
});
```

- [ ] **Step 2: Run — expect RED**

```bash
cd /home/ltt/project/keco-studio && npx jest tests/unit/script-system/leftnav-script-wiring.test.ts --no-coverage
```

- [ ] **Step 3: Implement**

Create `src/lib/script-system/isScriptSystemPath.ts`:

```ts
export function isScriptSystemPath(pathname: string | null): boolean {
  return (pathname ?? '').startsWith('/script-system');
}
```

Create `src/lib/script-system/projectPreference.ts` mirroring `src/lib/simulation/projectPreference.ts` with key `keco.script.projectPreference`.

In `LeftNav.tsx`:
- Import `isScriptSystemPath`, `readScriptProjectPreference`.
- `onScript = isScriptSystemPath(pathname)`.
- Studio active: `!onSimulation && !onScript`.
- Studio click when leaving Script: prefer `readScriptProjectPreference()?.projectId` → `/${id}` else `/projects` (same idea as Simulation).
- Insert Script button after Simulation with `aria-label="Script"`, `router.push('/script-system')`, active when `onScript`.
- Inline SVG speech-bubble icon (no new icon package).

In `DashboardLayout.tsx`:
- `const hideStudioChrome = hideSidebarForSimulation || isScriptSystemPath(pathname);`
- Use `hideStudioChrome` for Studio Sidebar + TopBar hide (Script layout will supply its own chrome; TopBar: **hide** on Script so Script shell owns header — Script layout can render a thin top bar later if needed).
- Conditionally omit `<ChatPanel />` when `hideStudioChrome` (Simulation already has no Studio sidebar; also hide chat on Script).

In `routeParams.ts`:
- Add `'script-system'` to `SPECIAL_ROUTE_SEGMENTS`.
- Early branch like simulation: if `parts[0] === 'script-system'`, parse `projectId = parts[1]` when UUID-like, `documentId` when `parts[2]==='doc'`, `libraryId` when `parts[2]==='script'`; set `isLibraryPage`/`isPredefinePage` false unless needed. Do **not** treat `script-system` as a Studio `projectId`.

- [ ] **Step 4: Run — expect GREEN**

```bash
cd /home/ltt/project/keco-studio && npx jest tests/unit/script-system/leftnav-script-wiring.test.ts --no-coverage
```

- [ ] **Step 5: Commit only if user asked**

---

### Task 2: Migration + workspace service

**Files:**
- Create: `supabase/migrations/20260731170000_script_workspace_documents.sql`
- Create: `src/lib/script-system/scriptWorkspaceService.ts`
- Test: `tests/unit/script-system/script-workspace-service.test.ts`
- Test: `tests/unit/database/script-workspace-migration.test.ts` (source assertions)

**Interfaces:**
- Produces:
  - `listScriptWorkspaceDocuments(supabase, projectId): Promise<ScriptWorkspaceDocumentRow[]>`
  - `upsertScriptWorkspaceDocument(supabase, { projectId, documentId, userId }): Promise<void>`
  - `deleteScriptWorkspaceDocument(supabase, { projectId, documentId }): Promise<void>`
- Row type: `{ project_id: string; document_id: string; imported_at: string; imported_by: string | null }`

- [ ] **Step 1: Write migration source test + service unit test (mock supabase)**

```ts
// tests/unit/database/script-workspace-migration.test.ts
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('script_workspace_documents migration', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260731170000_script_workspace_documents.sql'),
    'utf8'
  );

  it('creates table with composite PK and cascades', () => {
    expect(sql).toMatch(/create table[\s\S]*script_workspace_documents/i);
    expect(sql).toMatch(/primary key\s*\(\s*project_id\s*,\s*document_id\s*\)/i);
    expect(sql).toMatch(/references public\.documents\(id\) on delete cascade/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toContain('is_editor_or_admin_collaborator');
    expect(sql).toContain('is_accepted_collaborator');
  });
});
```

Service test: mock chain returning data; assert upsert uses `upsert` on conflict `(project_id, document_id)`; delete does not call `documents.delete`.

- [ ] **Step 2: Run — expect RED**

- [ ] **Step 3: Write migration**

```sql
create table public.script_workspace_documents (
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  primary key (project_id, document_id)
);

create index script_workspace_documents_document_id_idx
  on public.script_workspace_documents (document_id);

alter table public.script_workspace_documents enable row level security;

create policy script_workspace_documents_select
  on public.script_workspace_documents for select
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_accepted_collaborator(project_id, (select auth.uid()))
  );

create policy script_workspace_documents_insert
  on public.script_workspace_documents for insert
  with check (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

create policy script_workspace_documents_delete
  on public.script_workspace_documents for delete
  using (
    public.is_project_owner(project_id, (select auth.uid()))
    or public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))
  );

-- optional: no UPDATE policy (immutable membership rows; delete+insert if needed)
```

Also enforce document belongs to project via trigger or check in service:

```ts
// In upsertScriptWorkspaceDocument before upsert:
const { data: doc, error } = await supabase
  .from('documents')
  .select('id, project_id')
  .eq('id', documentId)
  .single();
if (error || !doc || doc.project_id !== projectId) {
  throw new Error('Document not found in project');
}
await supabase.from('script_workspace_documents').upsert(
  { project_id: projectId, document_id: documentId, imported_by: userId },
  { onConflict: 'project_id,document_id' }
);
```

- [ ] **Step 4: Run — expect GREEN**

- [ ] **Step 5: Commit only if user asked**

---

### Task 3: API routes for workspace membership

**Files:**
- Create: `src/app/api/script-workspace/[projectId]/route.ts`
- Create: `src/app/api/script-workspace/[projectId]/[documentId]/route.ts`
- Test: `tests/unit/api/script-workspace-route.test.ts` (handler wiring / auth pattern matching other API tests)

**Interfaces:**
- `GET /api/script-workspace/:projectId` → `{ documents: Array<{ documentId, importedAt, title?, folderId? }> }` (join titles via documents select)
- `POST /api/script-workspace/:projectId` body `{ documentId: string }` → `{ ok: true }`
- `DELETE /api/script-workspace/:projectId/:documentId` → `{ ok: true }`

Follow existing API auth: create server supabase client from cookies/session; 401 if unauthenticated; 403/404 on RLS/service errors.

- [ ] **Step 1: Write failing route tests** (import route handlers if pattern allows, or source-wiring expects `upsertScriptWorkspaceDocument` / status codes)

- [ ] **Step 2: Implement routes using Task 2 service**

- [ ] **Step 3: GREEN + optional commit**

---

### Task 4: Script shell layout + landing + Import Documentation UI

**Files:**
- Create: `src/app/(dashboard)/script-system/layout.tsx`
- Create: `src/app/(dashboard)/script-system/page.tsx`
- Create: `src/app/(dashboard)/script-system/[projectId]/layout.tsx`
- Create: `src/app/(dashboard)/script-system/[projectId]/page.tsx`
- Create: `src/components/script-system/ScriptShell.tsx`
- Create: `src/components/script-system/ScriptSidebar.tsx` (+ CSS module)
- Create: `src/components/script-system/ImportDocumentationView.tsx`
- Create: `src/components/script-system/SelectDocumentModal.tsx`
- Test: `tests/unit/script-system/import-documentation-wiring.test.ts`

**Interfaces:**
- `ScriptShell` renders sidebar + `{children}` full height beside LeftNav (Dashboard already left-nav only when Studio chrome hidden).
- Sidebar header: title `Keco Script`, subtitle `Manage and config game assets for game designers.`, project dropdown, Import button → `router.push(/script-system/${projectId})`.
- Landing page: if preference projectId exists and user can access, redirect to `/script-system/${projectId}`; else list user’s projects (reuse existing projects query/hook) and on pick write preference + navigate.

**ImportDocumentationView:**
- H1 `Import Documentation`
- Helper paragraph: exact Global Constraints copy
- Left: Select form card + primary button `Import documentation`
- Right: preview panel `STUDIO SOURCE DOCUMENTATION` — show selected doc title + markdown/plaintext preview if available via existing document fetch; empty state when none selected
- Select form opens `SelectDocumentModal` listing `listDocuments` for project (reuse `documentService.listDocuments`)
- Import calls `POST /api/script-workspace/${projectId}` then `router.push(/script-system/${projectId}/doc/${documentId})` and `writeScriptProjectPreference`

- [ ] **Step 1: Wiring tests** expect strings/routes in sources; modal uses `listDocuments` or fetch documents API

- [ ] **Step 2: Implement UI components + routes**

- [ ] **Step 3: Manual smoke** — LeftNav → Script → see Import page

- [ ] **Step 4: Commit only if user asked**

---

### Task 5: Doc route guard + DocumentEditor embed

**Files:**
- Create: `src/app/(dashboard)/script-system/[projectId]/doc/[documentId]/page.tsx`
- Create: `src/components/script-system/useScriptWorkspaceMembership.ts` (react-query: list refs; `isMember(documentId)`)
- Test: `tests/unit/script-system/doc-route-guard.test.ts`

**Behavior:**
- On mount, ensure documentId is in workspace list (GET). If not → redirect to `/script-system/${projectId}` with toast.
- Render `<DocumentEditor key={documentId} projectId={projectId} documentId={documentId} />`.
- Sidebar highlights selected document.

- [ ] **Step 1–4:** TDD wiring + implement + green

---

### Task 6: Script sidebar tree + context menus

**Files:**
- Modify: `src/components/script-system/ScriptSidebar.tsx`
- Create: `src/components/script-system/ScriptContextMenu.tsx`
- Create: `src/components/script-system/useScriptSidebarActions.ts`
- Test: `tests/unit/script-system/script-context-menu.test.tsx`
- Test: `tests/unit/layout/context-menu-generate-table.test.tsx` (assert Studio `ContextMenu.tsx` **still** contains `Generate table`)

**Tree data:**
- Workspace document IDs → fetch document names (from documents list or join in GET API).
- For each document, children = libraries where `source_document_id === documentId && document_export_type === 'script'` (reuse NavigationContext libraries query or `libraryService` list filtered client-side).

**Document menu items only:**
- Generate conversation (admin)
- Rename (existing document rename API/service)
- Delete → `DELETE /api/script-workspace/...` then refresh; **do not** call document delete

**Script child menu:** Rename / Delete library (existing services); no generate actions.

**Do not** render Generate table or Move to in Script menus.

- [ ] **Step 1: Tests**

```tsx
it('Script document menu omits Generate table', () => {
  // render ScriptContextMenu type=document admin
  expect(html).toContain('Generate conversation');
  expect(html).not.toContain('Generate table');
  expect(html).not.toContain('Move to');
});

it('Studio ContextMenu still has Generate table', () => {
  const source = read('src/components/layout/ContextMenu.tsx');
  expect(source).toContain('Generate table');
});
```

- [ ] **Step 2: Implement menus + tree navigation**

- Parent click → `/script-system/${projectId}/doc/${documentId}`
- Child click → `/script-system/${projectId}/script/${libraryId}`

- [ ] **Step 3: GREEN**

---

### Task 7: Generate conversation in Script mode

**Files:**
- Modify: `src/components/script-system/useScriptSidebarActions.ts`
- Reuse: `src/lib/documents/runDocumentDerivedImport.ts`, `fetchDocumentExportSource`, `documentDerivedImportProgress`
- Test: `tests/unit/script-system/script-generate-conversation.test.ts` (mock fetch/run; assert `exportType: 'script'` and navigate to script route)

**Behavior (match Studio RMB generate-conversation):**
1. Admin check
2. Optionally navigate to doc route first
3. Start progress bus
4. `fetchDocumentExportSource` → `runDocumentDerivedImport({ exportType: 'script', ... })`
5. On success: invalidate libraries + workspace queries; expand parent; `router.push(/script-system/${projectId}/script/${newLibraryId})`

Do **not** call table export path.

- [ ] **Step 1–4:** TDD + implement + green

---

### Task 8: Flow chart graph builder (pure)

**Files:**
- Create: `src/lib/script-system/parseJumpTarget.ts`
- Create: `src/lib/script-system/buildScriptFlowGraph.ts`
- Test: `tests/unit/script-system/build-script-flow-graph.test.ts`

**Interfaces:**

```ts
export type FlowGraphNode = {
  id: string;       // Label
  label: string;    // display = Label
  speaker?: string; // Name column
  rowIndex: number;
};

export type FlowGraphEdge = {
  from: string;
  to: string;
  optionIndex?: number;
  optionText?: string;
};

export type FlowGraph = { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] };

export function parseJumpTarget(value: string): string | undefined {
  return value.match(/\bJump\s+([A-Za-z][A-Za-z0-9_-]*)\b/i)?.[1];
}

/** rows: array of record keyed by column name (Label, Name, Option0, Option0_Next, ...) */
export function buildScriptFlowGraph(
  rows: Array<Record<string, string>>
): FlowGraph;
```

**Rules:**
- Skip rows with empty `Label`.
- For each option slot `Option${n}` / `Option${n}_Next` (n = 0..9): if Next has Jump target (or bare label matching LABEL_PATTERN), add edge.
- Also accept Next cell that is exactly a label without `Jump` prefix if it matches `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`.
- Missing Label column / empty rows → `{ nodes: [], edges: [] }` (no throw).
- Duplicate labels: keep first rowIndex; still emit edges.

- [ ] **Step 1: Failing tests** covering linear Jump, multi-option branch, empty input

```ts
it('builds nodes and Jump edges from Option0_Next', () => {
  const g = buildScriptFlowGraph([
    { Label: 'Start', Name: 'Guide', Option0: 'Go', Option0_Next: 'Jump End' },
    { Label: 'End', Name: '', Option0: '', Option0_Next: '' },
  ]);
  expect(g.nodes.map((n) => n.id)).toEqual(['Start', 'End']);
  expect(g.edges).toContainEqual({ from: 'Start', to: 'End', optionIndex: 0, optionText: 'Go' });
});
```

- [ ] **Step 2: Implement until GREEN**

---

### Task 9: Script split view (VN + Flow chart + divider)

**Files:**
- Create: `src/lib/script-system/splitRatioStorage.ts` — key `keco.script.splitRatio`, default `0.68`, clamp 0.35–0.8
- Create: `src/components/script-system/ScriptSplitView.tsx`
- Create: `src/components/script-system/FlowChartPanel.tsx`
- Create: `src/components/script-system/ScriptSplitView.module.css`
- Create: `src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx`
- Test: `tests/unit/script-system/split-ratio-storage.test.ts`
- Test: `tests/unit/script-system/script-split-wiring.test.ts`

**Page load:**
1. Fetch library; require `document_export_type === 'script'` and `source_document_id` in workspace; else redirect Import.
2. Load asset rows the same way Studio library page does (reuse hooks/services used by `LibraryAssetsTable` / library assets query — prefer extracting minimal row+column fetch rather than mounting full table).
3. Resolve `scriptColumns` like Studio script mode.
4. Render `ScriptSplitView`.

**ScriptSplitView:**
- Header: library name
- Left: `VisualNovelScriptView`
- Drag handle (mousemove/mouseup); persist ratio
- Right: `FlowChartPanel` with title `Flow chart`, close X collapses (state); reopen button in header when collapsed
- Min pane width ~240px

**FlowChartPanel:**
- Call `buildScriptFlowGraph` on row records
- Simple vertical layered SVG: layer by BFS from first node; nodes as rounded rects; edges as cubic paths
- Selected node state (click); blue stroke when selected
- Empty state message when no nodes

- [ ] **Step 1: Storage + wiring tests**

- [ ] **Step 2: Implement layout + SVG**

- [ ] **Step 3: GREEN + manual check** open a known script library under Script routes

---

### Task 10: E2E smoke (optional but recommended)

**Files:**
- Create: `tests/e2e/specs/keco-script-workspace.spec.ts`

**Flow (admin user fixture):**
1. Navigate `/script-system/{projectId}`
2. Open Select form, pick a document, Import
3. Assert doc editor visible
4. Open context menu → Generate conversation (may skip if LLM/env unavailable — gate with env flag; if skipped, seed a script derived library + workspace row via DB fixture and open split route)
5. Assert VN pane + `Flow chart` text visible

If full generate is too flaky in CI, implement **seeded path only** and keep generate covered by unit tests in Task 7.

- [ ] **Step 1: Implement seeded smoke**
- [ ] **Step 2: Run locally** `npx playwright test tests/e2e/specs/keco-script-workspace.spec.ts`
- [ ] **Step 3: Commit only if user asked**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| LeftNav speech between Simulation and coming-soon | 1 |
| `/script-system` routes | 4, 5, 9 |
| Hide Studio sidebar + ChatPanel | 1 |
| script_workspace_documents + RLS | 2 |
| Select form / Import Documentation | 4 |
| Idempotent import → editable DocumentEditor | 4, 5 |
| Sidebar docs + script children only | 6 |
| No Generate table / no Move to in Script | 6 |
| Delete = remove reference | 6 |
| Generate conversation → script child + navigate | 7 |
| Split VN + Flow chart + movable divider | 9 |
| Flow from Label + OptionN_Next / Jump | 8 |
| Studio Generate table preserved | 6 |
| E2E smoke | 10 |

## Open points resolved in this plan

1. Helper copy — fixed in Global Constraints.
2. DocumentEditor — embedded in Script doc route.
3. Flow chart — custom SVG, no new dependency.
