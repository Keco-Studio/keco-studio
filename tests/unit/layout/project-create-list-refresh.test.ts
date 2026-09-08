import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('project create list refresh', () => {
  it('lists newest projects first so creates are visible in the compact selector', () => {
    const source = read('src/lib/services/projectService.ts');
    expect(source).toContain(".order('created_at', { ascending: false })");
    expect(source).not.toContain(".order('created_at', { ascending: true })");
  });

  it('optimistically upserts into the user-scoped projects cache on create', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain('upsertProjectInListCache');
    expect(sidebar).toContain('updateProjectsListCache');
    expect(sidebar).toContain('removeProjectFromListCache');
    expect(sidebar).not.toContain("setQueryData<Project[]>(['projects']");

    const page = read('src/app/(dashboard)/projects/page.tsx');
    expect(page).toContain('upsertProjectInListCache');
    expect(page).toContain('CreatedProjectPayload');

    const modal = read('src/components/projects/NewProjectModal.tsx');
    expect(modal).toContain('CreatedProjectPayload');
    expect(modal).toContain('name: trimmed');
  });

  it('reads realtime project membership from prefix-matched list caches', () => {
    const source = read('src/components/layout/hooks/useSidebarRealtime.ts');
    expect(source).toContain('projectsListCacheHasId');
    expect(source).toContain('removeProjectFromListCache');
    expect(source).not.toContain("getQueryData<Project[]>(['projects']");
    expect(source).not.toContain("setQueryData<Project[]>(['projects']");
  });
});
