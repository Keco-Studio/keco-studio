import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');

describe('table scalability (issue #215)', () => {
  it('virtualizes table rows with measured dynamic heights', () => {
    const packageJson = JSON.parse(read('package.json'));
    const source = read(
      'src/components/libraries/components/LibraryAssetsTableBody.tsx'
    );

    expect(packageJson.dependencies['@tanstack/react-virtual']).toBeTruthy();
    expect(source).toContain('useVirtualizer');
    expect(source).toContain('getScrollElement');
    expect(source).toContain('getVirtualItems()');
    expect(source).toContain('measureElement');
    expect(source).not.toContain('displayRows.map((row, index)');
  });

  it('memoizes provider values and exposes a stable actions context', () => {
    const libraryData = read('src/lib/contexts/LibraryDataContext.tsx');
    const auth = read('src/lib/contexts/AuthContext.tsx');
    const navigation = read('src/lib/contexts/NavigationContext.tsx');

    expect(libraryData).toContain('LibraryActionsContext');
    expect(libraryData).toContain('const actionsValue = useMemo');
    expect(libraryData).toContain('const contextValue = useMemo');
    expect(auth).toContain('const value = useMemo<AuthContextType>');
    expect(navigation).toContain('const value = useMemo<NavigationContextType>');
  });

  it('runs React in strict mode', () => {
    expect(read('next.config.mjs')).toContain('reactStrictMode: true');
  });
});
