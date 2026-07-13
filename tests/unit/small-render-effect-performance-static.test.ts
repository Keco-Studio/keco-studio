import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('small render and effect performance guards', () => {
  it('debounces table find text and precomputes searchable cell values', () => {
    const source = read('src/components/libraries/hooks/useTableCellFindReplace.ts');
    expect(source).toContain('debouncedFindText');
    expect(source).toContain('buildNormalizedIndexMap');
  });

  it('keeps the sidebar context-menu callback stable', () => {
    const source = read('src/components/layout/Sidebar.tsx');
    expect(source).toMatch(/const handleContextMenu = useCallback\s*\(/);
  });

  it('does not allocate Date objects in the asset sort comparator', () => {
    const source = read('src/lib/utils/assetEmptiness.ts');
    expect(source).not.toMatch(/new Date\((?:a|b)\.created_at\)/);
    expect(source).toContain('Date.parse');
  });

  it('reads click-outside autosave inputs through a live params ref', () => {
    const source = read('src/components/libraries/hooks/useClickOutsideAutoSave.ts');
    expect(source).toContain('paramsRef');
    expect(source).toContain('paramsRef.current');
  });

  it('removes dead presence heartbeat state and noisy collaborator logs', () => {
    const presence = read('src/lib/hooks/usePresenceTracking.ts');
    const topBar = read('src/components/layout/TopBar.tsx');
    expect(presence).not.toContain('heartbeatIntervalRef');
    expect(topBar).not.toContain("console.log('[TopBar]");
  });
});
