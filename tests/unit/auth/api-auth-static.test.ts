import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_API_ROUTES = new Set([
  'src/app/api/invitations/decline/route.ts',
  'src/app/api/mcp/oauth-protected-resource/route.ts',
]);

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? routeFiles(path)
      : entry === 'route.ts'
        ? [path]
        : [];
  });
}

describe('API authentication boundaries', () => {
  it('excludes API requests from the proxy matcher', () => {
    const source = readFileSync(join(process.cwd(), 'src/proxy.ts'), 'utf8');
    const matcher = source.match(/export const config[\s\S]*?['"](\/\(\(\?![^'"]+)['"]/)?.[1];

    expect(matcher).toBeDefined();
    expect(new RegExp(`^${matcher}$`).test('/api/projects')).toBe(false);
    expect(new RegExp(`^${matcher}$`).test('/projects')).toBe(true);
  });

  it('keeps direct auth.getUser calls inside the shared route auth helper', () => {
    const apiDirectory = join(process.cwd(), 'src/app/api');
    const directAuthRoutes = routeFiles(apiDirectory)
      .filter((path) => readFileSync(path, 'utf8').includes('.auth.getUser('))
      .map((path) => path.slice(process.cwd().length + 1));

    expect(directAuthRoutes).toEqual([]);
  });

  it('wraps every authenticated API route with the shared auth boundary', () => {
    const apiDirectory = join(process.cwd(), 'src/app/api');
    const routesWithoutSharedBoundary = routeFiles(apiDirectory)
      .map((path) => path.slice(process.cwd().length + 1))
      .filter((path) => !PUBLIC_API_ROUTES.has(path))
      .filter((path) => !readFileSync(join(process.cwd(), path), 'utf8').includes('withAuth'));

    expect(routesWithoutSharedBoundary).toEqual([]);
  });
});
