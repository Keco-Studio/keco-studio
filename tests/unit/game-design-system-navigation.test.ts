import { parseRouteParams, SPECIAL_ROUTE_SEGMENTS } from '@/lib/utils/routeParams';

describe('Game Design System navigation', () => {
  it('treats manager and create pages as root product routes without project context', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('game-design-systems');
    expect(parseRouteParams('/game-design-systems').projectId).toBeNull();
    expect(parseRouteParams('/game-design-systems/create').projectId).toBeNull();
  });
});
