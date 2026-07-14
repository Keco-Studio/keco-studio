import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(
    process.cwd(),
    'src/components/layout/hooks/useSidebarDocuments.ts'
  ),
  'utf8'
);

describe('sidebar document query recovery policy', () => {
  it('refetches stale document lists after a missed realtime broadcast', () => {
    expect(source).toMatch(/staleTime:\s*0/);
    expect(source).toMatch(/refetchOnWindowFocus:\s*true/);
    expect(source).not.toMatch(/refetchOnMount:\s*false/);
  });
});
