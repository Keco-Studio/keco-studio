import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8');

describe('realtime channel consolidation (issue #216)', () => {
  it('delivers version changes through the main library channel', () => {
    const subscription = read('src/lib/hooks/realtime/useLibraryChannel.ts');
    const dataContext = read('src/lib/contexts/LibraryDataContext.tsx');
    const versionSidebar = read(
      'src/components/version-control/VersionControlSidebar.tsx'
    );

    expect(subscription).toContain('onVersionChange');
    expect(subscription).toContain("table: 'library_versions'");
    expect(dataContext).not.toContain('library-versions-restore:');
    expect(versionSidebar).not.toContain('library-versions:');
  });

  it('keeps snapshot payloads out of the version-list query', () => {
    const versionService = read('src/lib/services/versionService.ts');
    const listQuery = versionService.slice(
      versionService.indexOf('export async function getVersionsByLibrary'),
      versionService.indexOf('export async function checkVersionNameExists')
    );

    expect(listQuery).not.toContain(".select('*')");
    expect(versionService).toContain('const VERSION_LIST_COLUMNS');
    expect(listQuery).toContain('.select(VERSION_LIST_COLUMNS)');
    expect(listQuery).not.toContain('snapshot_data,');
  });

  it('uses one React Query-backed collaborator subscription', () => {
    const projectLayout = read('src/app/(dashboard)/[projectId]/layout.tsx');
    const topBar = read('src/components/layout/TopBar.tsx');
    const sidebarRealtime = read(
      'src/components/layout/hooks/useSidebarRealtime.ts'
    );
    const collaboratorsPage = read(
      'src/app/(dashboard)/[projectId]/collaborators/page.tsx'
    );

    expect(projectLayout).toContain('useProjectCollaboratorsRealtime');
    expect(topBar).not.toContain('topbar-collaborators:project:');
    expect(sidebarRealtime).not.toContain('collaborators:project:');
    expect(collaboratorsPage).toContain('useProjectCollaboratorsQuery');
    expect(collaboratorsPage).not.toContain('setCollaborators');
  });

  it('drops the unused snapshot GIN index in a forward migration', () => {
    const migration =
      'supabase/migrations/20260713060000_drop_library_versions_snapshot_index.sql';

    expect(existsSync(path.join(process.cwd(), migration))).toBe(true);
    expect(read(migration)).toContain(
      'DROP INDEX IF EXISTS public.idx_library_versions_snapshot_data'
    );
  });

  it('decomposes the realtime hook into lifecycle and broadcast hooks', () => {
    expect(
      existsSync(
        path.join(process.cwd(), 'src/lib/hooks/realtime/useLibraryChannel.ts')
      )
    ).toBe(true);
    expect(
      existsSync(
        path.join(process.cwd(), 'src/lib/hooks/realtime/useLibraryBroadcasts.ts')
      )
    ).toBe(true);
    expect(
      read('src/lib/hooks/useRealtimeSubscription.ts').split(/\r?\n/).length
    ).toBeLessThan(220);
  });
});
