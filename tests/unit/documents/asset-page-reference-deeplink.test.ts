import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('asset page route redirect contract', () => {
  const assetPage = readFileSync(
    join(process.cwd(), 'src/app/(dashboard)/[projectId]/[libraryId]/[assetId]/page.tsx'),
    'utf8'
  );

  it('redirects the full-page asset route to the library table with ?asset=', () => {
    expect(assetPage).toContain('router.replace');
    expect(assetPage).toMatch(
      /router\.replace\(`\/\$\{projectId\}\/\$\{libraryId\}\?asset=\$\{assetId\}`\)/
    );
    expect(assetPage).toMatch(
      /assetId === 'new'[\s\S]*router\.replace\(`\/\$\{projectId\}\/\$\{libraryId\}`\)/
    );
    expect(assetPage).not.toContain('getAsset(assetId)');
    expect(assetPage).not.toContain('Asset not found');
  });
});
