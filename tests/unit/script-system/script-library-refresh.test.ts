import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Script Conversation data refresh', () => {
  it('refetches assets on navigation and window focus', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'src/app/(dashboard)/script-system/[projectId]/script/[libraryId]/page.tsx',
    ), 'utf8');

    const assetQuery = source.slice(
      source.indexOf('queryKey: queryKeys.libraryAssets(libraryId)'),
      source.indexOf('const sourceDocumentId'),
    );
    expect(assetQuery).toContain("refetchOnMount: 'always'");
    expect(assetQuery).toContain('refetchOnWindowFocus: true');
  });
});
