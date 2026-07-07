# GitHub Issues 147-168 Batch 5 Data Invalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the core #166 data-sync CustomEvent path with typed React Query invalidation helpers.

**Architecture:** Add a small `queryInvalidation` module that owns cache invalidation for projects, folders, libraries, assets, and schema. Update core project/folder/library pages, Sidebar data hooks, and LibraryDataContext to call the helper directly instead of dispatching or listening to data-refresh browser events. Keep UI command events such as topbar controls, highlight clearing, presence, and agent commands in place.

**Tech Stack:** React Query `QueryClient`, existing `queryKeys`, Jest static and unit tests, TypeScript.

## Global Constraints

- User-facing final replies stay in Chinese.
- Code, comments, identifiers, and API names stay in English.
- Use TDD for behavior changes where a practical test surface exists.
- Preserve unrelated user changes.
- Keep commits scoped by issue or remediation batch.
- Prefer existing project patterns over new abstractions.
- Keep UI events that are clearly command/control events, such as topbar mode toggles, unless they are part of data cache synchronization.
- Every batch must end with a targeted verification command, and the final remediation must run the broadest practical validation chain.
- Do not push commits.
- If a command fails because of sandboxing or network restrictions, rerun it with escalated permissions.

---

### Task 1: Add Typed Invalidation Helper And Migrate Core Data Event Paths

**Files:**
- Create: `src/lib/queryInvalidation.ts`
- Create: `tests/unit/query-invalidation.test.ts`
- Create: `tests/unit/data-sync-events-static.test.ts`
- Modify: `src/components/layout/hooks/useSidebarAssets.ts`
- Modify: `src/components/layout/hooks/useSidebarRealtime.ts`
- Modify: `src/components/layout/hooks/useSidebarWindowEvents.ts`
- Modify: `src/components/layout/hooks/useSidebarContextMenuActions.ts`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/(dashboard)/[projectId]/page.tsx`
- Modify: `src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/page.tsx`
- Modify: `src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx`
- Modify: `src/lib/contexts/LibraryDataContext.tsx`
- Modify: `tests/unit/schema-updated-dispatch-static.test.ts`

**Interfaces:**
- `invalidateProjectData(queryClient, { projectId?, userProjectList?, refetchActiveProjects? }): Promise<void>`
- `invalidateFolderData(queryClient, { projectId?, folderId?, refetchActiveFoldersLibraries? }): Promise<void>`
- `invalidateLibraryData(queryClient, { projectId?, folderId?, libraryId?, refetchActiveFoldersLibraries? }): Promise<void>`
- `invalidateLibraryAssetsData(queryClient, { libraryId, assetId?, includeSchema?, refetchActiveAssets? }): Promise<void>`
- `invalidateLibrarySchemaData(queryClient, { libraryId, refetchActiveSchema? }): Promise<void>`
- `sidebarAssetsKey(libraryId: string): readonly ['sidebar-assets', string]`

- [x] **Step 1: Write failing tests**

Add `tests/unit/query-invalidation.test.ts` with a fake QueryClient object that records calls:

```ts
import { describe, expect, it, jest } from '@jest/globals';
import {
  invalidateFolderData,
  invalidateLibraryAssetsData,
  invalidateLibraryData,
  invalidateLibrarySchemaData,
  invalidateProjectData,
  sidebarAssetsKey,
} from '@/lib/queryInvalidation';
import { queryKeys } from '@/lib/utils/queryKeys';

const createClient = () => ({
  invalidateQueries: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  refetchQueries: jest.fn<() => Promise<void>>(() => Promise.resolve()),
});

describe('query invalidation helpers', () => {
  it('invalidates project list and project detail keys', async () => {
    const client = createClient();
    await invalidateProjectData(client as never, {
      projectId: 'project-1',
      userProjectList: true,
      refetchActiveProjects: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projects() });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.project('project-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projects(),
      type: 'active',
    });
  });

  it('invalidates folder and folder/library collection keys', async () => {
    const client = createClient();
    await invalidateFolderData(client as never, {
      projectId: 'project-1',
      folderId: 'folder-1',
      refetchActiveFoldersLibraries: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectFolders('project-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.folder('folder-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'] });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['folders-libraries', 'project-1'],
      type: 'active',
    });
  });

  it('invalidates library list, detail, summary, and sidebar collection keys', async () => {
    const client = createClient();
    await invalidateLibraryData(client as never, {
      projectId: 'project-1',
      folderId: 'folder-1',
      libraryId: 'library-1',
      refetchActiveFoldersLibraries: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.projectLibraries('project-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.folderLibraries('folder-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.library('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['folders-libraries', 'project-1'] });
  });

  it('invalidates asset, library asset, summary, schema, and sidebar asset keys', async () => {
    const client = createClient();
    await invalidateLibraryAssetsData(client as never, {
      libraryId: 'library-1',
      assetId: 'asset-1',
      includeSchema: true,
      refetchActiveAssets: true,
    });

    expect(sidebarAssetsKey('library-1')).toEqual(['sidebar-assets', 'library-1']);
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.asset('asset-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.libraryAssets('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySchema('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: sidebarAssetsKey('library-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.libraryAssets('library-1'),
      type: 'active',
    });
  });

  it('invalidates schema-dependent caches', async () => {
    const client = createClient();
    await invalidateLibrarySchemaData(client as never, {
      libraryId: 'library-1',
      refetchActiveSchema: true,
    });

    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySchema('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.libraryAssets('library-1') });
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.librarySummary('library-1') });
    expect(client.refetchQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.librarySchema('library-1'),
      type: 'active',
    });
  });
});
```

Add `tests/unit/data-sync-events-static.test.ts` reading the core files and asserting they no longer dispatch or listen to data-sync browser events:

```ts
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');

const coreFiles = [
  'src/components/layout/hooks/useSidebarRealtime.ts',
  'src/components/layout/hooks/useSidebarWindowEvents.ts',
  'src/components/layout/hooks/useSidebarAssets.ts',
  'src/components/layout/hooks/useSidebarContextMenuActions.ts',
  'src/components/layout/Sidebar.tsx',
  'src/app/(dashboard)/[projectId]/page.tsx',
  'src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx',
  'src/app/(dashboard)/[projectId]/[libraryId]/page.tsx',
  'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx',
  'src/lib/contexts/LibraryDataContext.tsx',
];

const dataSyncEvents = [
  'projectCreated',
  'projectUpdated',
  'projectDeleted',
  'folderCreated',
  'folderUpdated',
  'folderDeleted',
  'libraryCreated',
  'libraryUpdated',
  'libraryDeleted',
  'assetCreated',
  'assetUpdated',
  'assetDeleted',
  'schemaUpdated',
  'referenceSourceUpdated',
  'libraryRestored',
  'libraryCellValuesReplaced',
];

describe('data sync events static guard', () => {
  it('uses typed invalidation instead of core data-sync CustomEvents', () => {
    for (const file of coreFiles) {
      const source = read(file);
      for (const eventName of dataSyncEvents) {
        expect(source).not.toContain(`new CustomEvent('${eventName}'`);
        expect(source).not.toContain(`addEventListener('${eventName}'`);
        expect(source).not.toContain(`removeEventListener('${eventName}'`);
        expect(source).not.toContain(`addEventListener('${eventName}' as any`);
        expect(source).not.toContain(`removeEventListener('${eventName}' as any`);
      }
    }
  });

  it('keeps UI command events out of the data-sync ban', () => {
    const projectPage = read('src/app/(dashboard)/[projectId]/page.tsx');
    expect(projectPage).toContain('library-page-view-mode-change');
    expect(projectPage).toContain('library-toolbar-view-mode-change');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:unit -- tests/unit/query-invalidation.test.ts tests/unit/data-sync-events-static.test.ts --runInBand
```

Expected: FAIL because `src/lib/queryInvalidation.ts` is missing and core files still use data-sync events.

- [x] **Step 3: Implement query invalidation helper**

Create `src/lib/queryInvalidation.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/utils/queryKeys';

export const sidebarAssetsKey = (libraryId: string) =>
  ['sidebar-assets', libraryId] as const;

export async function invalidateProjectData(
  queryClient: QueryClient,
  options: { projectId?: string | null; userProjectList?: boolean; refetchActiveProjects?: boolean } = {}
) {
  if (options.userProjectList) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    if (options.refetchActiveProjects) {
      await queryClient.refetchQueries({ queryKey: queryKeys.projects(), type: 'active' });
    }
  }
  if (options.projectId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.project(options.projectId) });
  }
}

export async function invalidateFolderData(
  queryClient: QueryClient,
  options: { projectId?: string | null; folderId?: string | null; refetchActiveFoldersLibraries?: boolean }
) {
  if (options.projectId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectFolders(options.projectId) });
    await queryClient.invalidateQueries({ queryKey: ['folders-libraries', options.projectId] });
    if (options.refetchActiveFoldersLibraries) {
      await queryClient.refetchQueries({
        queryKey: ['folders-libraries', options.projectId],
        type: 'active',
      });
    }
  }
  if (options.folderId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.folder(options.folderId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(options.folderId) });
  }
}

export async function invalidateLibraryData(
  queryClient: QueryClient,
  options: {
    projectId?: string | null;
    folderId?: string | null;
    libraryId?: string | null;
    refetchActiveFoldersLibraries?: boolean;
  }
) {
  if (options.projectId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectLibraries(options.projectId) });
    await queryClient.invalidateQueries({ queryKey: ['folders-libraries', options.projectId] });
    if (options.refetchActiveFoldersLibraries) {
      await queryClient.refetchQueries({
        queryKey: ['folders-libraries', options.projectId],
        type: 'active',
      });
    }
  }
  if (options.folderId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.folderLibraries(options.folderId) });
  }
  if (options.libraryId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.library(options.libraryId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(options.libraryId) });
    await queryClient.invalidateQueries({ queryKey: sidebarAssetsKey(options.libraryId) });
  }
}

export async function invalidateLibraryAssetsData(
  queryClient: QueryClient,
  options: {
    libraryId: string;
    assetId?: string | null;
    includeSchema?: boolean;
    refetchActiveAssets?: boolean;
  }
) {
  if (options.assetId) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.asset(options.assetId) });
  }
  await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(options.libraryId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(options.libraryId) });
  await queryClient.invalidateQueries({ queryKey: sidebarAssetsKey(options.libraryId) });
  if (options.includeSchema) {
    await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(options.libraryId) });
  }
  if (options.refetchActiveAssets) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.libraryAssets(options.libraryId),
      type: 'active',
    });
  }
}

export async function invalidateLibrarySchemaData(
  queryClient: QueryClient,
  options: { libraryId: string; refetchActiveSchema?: boolean }
) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.librarySchema(options.libraryId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.libraryAssets(options.libraryId) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.librarySummary(options.libraryId) });
  if (options.refetchActiveSchema) {
    await queryClient.refetchQueries({
      queryKey: queryKeys.librarySchema(options.libraryId),
      type: 'active',
    });
  }
}
```

- [x] **Step 4: Move Sidebar assets to React Query**

Update `src/components/layout/hooks/useSidebarAssets.ts`:

```ts
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSupabase } from '@/lib/SupabaseContext';
import { sidebarAssetsKey } from '@/lib/queryInvalidation';

export type SidebarAssetRow = { id: string; name: string; library_id: string };

export function useSidebarAssets(currentLibraryId: string | null) {
  const supabase = useSupabase();
  const queryClient = useQueryClient();

  const { data: currentAssets = [] } = useQuery({
    queryKey: currentLibraryId ? sidebarAssetsKey(currentLibraryId) : ['sidebar-assets', 'none'],
    queryFn: async () => {
      if (!currentLibraryId) return [];
      const { data: rows, error } = await supabase
        .from('library_assets')
        .select('id,name,library_id')
        .eq('library_id', currentLibraryId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (rows as SidebarAssetRow[]) || [];
    },
    enabled: !!currentLibraryId,
  });

  const fetchAssets = useCallback(
    async (libraryId: string | null | undefined) => {
      if (!libraryId) return;
      await queryClient.ensureQueryData({
        queryKey: sidebarAssetsKey(libraryId),
        queryFn: async () => {
          const { data: rows, error } = await supabase
            .from('library_assets')
            .select('id,name,library_id')
            .eq('library_id', libraryId)
            .order('created_at', { ascending: true });
          if (error) throw error;
          return (rows as SidebarAssetRow[]) || [];
        },
      });
    },
    [queryClient, supabase]
  );

  const assets = currentLibraryId ? { [currentLibraryId]: currentAssets } : {};
  return { assets, fetchAssets };
}
```

- [x] **Step 5: Replace core data event dispatch/listener paths**

In the listed files, replace data-sync event dispatch/listener logic with helper calls:

- Project/folder/library created/deleted/updated paths call `invalidateProjectData`, `invalidateFolderData`, and `invalidateLibraryData`.
- Asset and schema changes call `invalidateLibraryAssetsData` and `invalidateLibrarySchemaData`.
- LibraryDataContext replaces self-loop events with `invalidateLibraryAssetsData` and direct local callbacks (`applySnapshotToYjs`, `loadInitialData`, formula meta invalidation).
- Keep `library-page-view-mode-change`, `library-toolbar-*`, `library-version-control-*`, `library-presence-update`, `asset-page-mode`, `libraryCellSearchHighlightClear`, and agent events.

- [x] **Step 6: Update schema dispatch static test**

Change `tests/unit/schema-updated-dispatch-static.test.ts` to assert helper use instead of `schemaUpdated` dispatch:

```ts
expect(libraryPageSource).toContain('invalidateLibrarySchemaData');
expect(tableHeaderSource).toContain('invalidateLibrarySchemaData');
expect(editColumnModalSource).toContain('invalidateLibrarySchemaData');
```

- [x] **Step 7: Verify targeted tests and typecheck**

Run:

```bash
npm run test:unit -- tests/unit/query-invalidation.test.ts tests/unit/data-sync-events-static.test.ts tests/unit/schema-updated-dispatch-static.test.ts --runInBand
npm run typecheck
```

Expected: PASS.

- [x] **Step 8: Commit Batch 5**

Run:

```bash
git add src/lib/queryInvalidation.ts tests/unit/query-invalidation.test.ts tests/unit/data-sync-events-static.test.ts tests/unit/schema-updated-dispatch-static.test.ts src/components/layout/hooks/useSidebarAssets.ts src/components/layout/hooks/useSidebarRealtime.ts src/components/layout/hooks/useSidebarWindowEvents.ts src/components/layout/hooks/useSidebarContextMenuActions.ts src/components/layout/Sidebar.tsx src/app/(dashboard)/[projectId]/page.tsx src/app/(dashboard)/[projectId]/folder/[folderId]/page.tsx src/app/(dashboard)/[projectId]/[libraryId]/page.tsx src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx src/lib/contexts/LibraryDataContext.tsx docs/superpowers/plans/2026-07-08-github-issues-147-168-batch-5-data-invalidation.md
git commit -m "fix: replace core data sync events with query invalidation"
```

Expected: Commit created. Do not push.

## Self-Review

- Spec coverage: this plan covers #166's core CustomEvent data sync path and creates the typed React Query invalidation seam required for later cleanup.
- Scope note: full deletion of `useRequestCache` is intentionally left out of this batch because services and auth/navigation still use it as request de-duplication, not only event-driven sync. Removing it safely requires a separate service-query migration.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: helper names and signatures match the test and implementation steps.
