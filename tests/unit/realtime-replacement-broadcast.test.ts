import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { groupCellReplacementUpdates } from '@/lib/realtime/cell-replacement-broadcast';

describe('cell replacement broadcasts', () => {
  it('groups replacement cells into one batch per library', () => {
    const grouped = groupCellReplacementUpdates([
      { libraryId: 'library-1', assetId: 'asset-1', propertyKey: 'field-1', newValue: 'A' },
      { libraryId: 'library-2', assetId: 'asset-2', propertyKey: 'field-2', newValue: 'B' },
      { libraryId: 'library-1', assetId: 'asset-3', propertyKey: 'field-3', newValue: 'C' },
    ]);

    expect(grouped.get('library-1')).toHaveLength(2);
    expect(grouped.get('library-2')).toHaveLength(1);
  });

  it('wires both replace entry points to explicit broadcast and local reconciliation', () => {
    const topBar = readFileSync(join(process.cwd(), 'src/components/layout/TopBar.tsx'), 'utf8');
    const tableHook = readFileSync(
      join(process.cwd(), 'src/components/libraries/hooks/useTableCellFindReplace.ts'),
      'utf8'
    );
    const context = readFileSync(
      join(process.cwd(), 'src/lib/contexts/LibraryDataContext.tsx'),
      'utf8'
    );

    expect(topBar).toContain('broadcastCellReplacementBatches');
    expect(tableHook).toContain('broadcastCellReplacementBatches');
    expect(context).toContain('LIBRARY_RECONCILE_EVENT');
  });

  it('reuses the authenticated client and sends replacements over the explicit REST API', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/realtime/cell-replacement-broadcast.ts'),
      'utf8'
    );

    expect(source).toContain('supabase: SupabaseClient');
    expect(source).toContain('channel.httpSend(');
    expect(source).not.toContain('createClient(');
  });
});
