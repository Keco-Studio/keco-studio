import { aggregateProjectGameAssets } from '@/lib/services/gameAssetsService';
import type { SupabaseClient } from '@supabase/supabase-js';

function client(hidden: { data: Array<{ asset_id: string }> | null; error: unknown }) {
  const records: Record<string, unknown[]> = {
    project_game_assets: [{ id: 'one', project_id: 'project', name: 'Forest.png', storage_path: null }],
    map_projects: [], gdd_map_artifacts: [], character_assets: [],
  };
  return {
    from(table: string) {
      const result = table === 'project_game_asset_hidden' ? hidden : { data: records[table] ?? [], error: null };
      const query = { select: () => query, eq: () => query, order: () => query, not: () => query,
        range: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
      return query;
    },
  } as unknown as SupabaseClient;
}

it('keeps removed assets out of a freshly loaded library', async () => {
  const result = await aggregateProjectGameAssets(client({ data: [{ asset_id: 'manual:one' }], error: null }), 'project');
  expect(result.assets).toEqual([]);
});

it('loads all pages of removed asset identifiers', async () => {
  const first = Array.from({ length: 1000 }, (_, index) => ({ asset_id: `manual:${index}` }));
  const from = jest.fn((table: string) => {
    if (table !== 'project_game_asset_hidden') {
      const query = { select: () => query, eq: () => query, order: () => query, not: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === 'project_game_assets' ? [{ id: 'one', project_id: 'project', name: 'Forest.png' }] : [], error: null }).then(resolve) };
      return query;
    }
    return { select: () => ({ eq: () => ({ range: (start: number) => Promise.resolve({ data: start === 0 ? first : [{ asset_id: 'manual:one' }], error: null }) }) }) };
  });
  const result = await aggregateProjectGameAssets({ from } as unknown as SupabaseClient, 'project');
  expect(result.assets).toEqual([]);
});

it('fails the load when removal state cannot be read', async () => {
  await expect(aggregateProjectGameAssets(client({ data: null, error: { message: 'unavailable' } }), 'project'))
    .rejects.toThrow('Unable to load removed assets');
});
