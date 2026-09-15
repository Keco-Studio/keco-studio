import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(
  process.cwd(),
  'src/app/(dashboard)/[projectId]/admin/assets/page.tsx',
), 'utf8');

describe('Assets page activation', () => {
  it('activates a directly opened workspace and refreshes project navigation', () => {
    expect(source).toContain("action: 'activate-workspace'");
    expect(source).toContain("queryClient.invalidateQueries({ queryKey: ['projects'] })");
  });
});
