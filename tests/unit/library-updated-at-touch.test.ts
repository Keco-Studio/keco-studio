import { describe, expect, it } from '@jest/globals';
import { touchLibraryAssetEditUpdatedAt } from '@/lib/library/updatedAt';

describe('touchLibraryAssetEditUpdatedAt', () => {
  it('uses a single RPC round-trip and returns the server updated_at', async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const supabase = {
      rpc: async (name: string, args: unknown) => {
        calls.push({ name, args });
        return { data: '2026-07-07T10:00:00.000Z', error: null };
      },
    };

    await expect(
      touchLibraryAssetEditUpdatedAt(supabase, {
        assetId: 'asset-1',
        libraryId: 'library-1',
      })
    ).resolves.toBe('2026-07-07T10:00:00.000Z');

    expect(calls).toEqual([
      {
        name: 'touch_library_asset_edit_updated_at',
        args: { p_asset_id: 'asset-1', p_library_id: 'library-1' },
      },
    ]);
  });
});
