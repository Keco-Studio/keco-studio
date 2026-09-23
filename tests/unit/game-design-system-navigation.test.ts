import { parseRouteParams, SPECIAL_ROUTE_SEGMENTS } from '@/lib/utils/routeParams';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('Game Design System navigation', () => {
  it('treats manager and create pages as root product routes without project context', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('game-design-systems');
    expect(parseRouteParams('/game-design-systems').projectId).toBeNull();
    expect(parseRouteParams('/game-design-systems/create').projectId).toBeNull();
  });

  it('uses the shared product rail and sidebar brand treatment', () => {
    const dashboard = read('src/components/layout/DashboardLayout.tsx');
    const library = read('src/components/game-design-system/GameDesignSystemLibrary.tsx');
    const styles = read('src/components/game-design-system/GameDesignSystemsPage.module.css');

    expect(dashboard).toMatch(/showLeftNav[\s\S]+hideSidebarForGameDesignSystems/);
    expect(library).toContain('Game Design System');
    expect(library).toContain('Manage and config game assets for game designers.');
    expect(library).not.toContain('Design governance');
    expect(styles).toMatch(/\.library\s*\{[^}]*position:\s*fixed/s);
    expect(styles).toMatch(/\.library\s*\{[^}]*top:\s*0/s);
    expect(styles).toMatch(/\.library\s*\{[^}]*left:\s*60px/s);
    expect(styles).toMatch(/\.library\s*\{[^}]*z-index:\s*31/s);
    expect(styles).toMatch(/\.workspace,\s*\.createWorkspace\s*\{[^}]*grid-column:\s*2/s);
  });
});
