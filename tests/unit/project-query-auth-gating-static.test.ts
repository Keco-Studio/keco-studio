import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

describe('project query authentication gating', () => {
  it('does not fetch sidebar projects until the authenticated user id is available', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/components/layout/hooks/useSidebarProjects.ts'),
      'utf8'
    );

    expect(source).toContain("queryKey: ['projects', userId]");
    expect(source).toContain('enabled: Boolean(userId)');
    expect(source).toContain('isLoading: !userId || loadingProjects');
  });

  it('does not fetch the projects page before its authenticated profile is available', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/app/(dashboard)/projects/page.tsx'),
      'utf8'
    );

    expect(source).toContain("queryKey: ['projects', userProfile?.id]");
    expect(source).toContain('enabled: Boolean(userProfile?.id)');
    expect(source).toContain('const loading = !userProfile?.id || projectsLoading;');
  });
});
