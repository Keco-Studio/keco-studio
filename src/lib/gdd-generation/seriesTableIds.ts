import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeTableLogicalKey } from './tableResources';

/**
 * Load stable table library IDs already owned by the GDD resource series for a
 * project + Game Design System. Keys are normalized logical table names.
 */
export async function loadSeriesTableLibraryIds(
  client: SupabaseClient,
  projectId: string,
  designSystemId: string,
): Promise<Map<string, string>> {
  const series = await client
    .from('gdd_resource_series')
    .select('id')
    .eq('project_id', projectId)
    .eq('design_system_id', designSystemId)
    .maybeSingle();
  if (series.error) throw series.error;
  const seriesId = (series.data as { id?: unknown } | null)?.id;
  if (typeof seriesId !== 'string') return new Map();

  const resources = await client
    .from('gdd_series_resources')
    .select('logical_key, library_id')
    .eq('series_id', seriesId)
    .eq('resource_kind', 'table');
  if (resources.error) throw resources.error;

  const map = new Map<string, string>();
  for (const row of resources.data ?? []) {
    const key = typeof row.logical_key === 'string'
      ? normalizeTableLogicalKey(row.logical_key)
      : '';
    const libraryId = typeof row.library_id === 'string' ? row.library_id : '';
    if (key && libraryId) map.set(key, libraryId);
  }
  return map;
}
