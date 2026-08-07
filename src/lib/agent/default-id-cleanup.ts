import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteLibraryField } from '@/lib/services/libraryAssetsService';
import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';
import { findUnusedDefaultIdField } from './default-id-field';

export async function removeUnusedDefaultIdField(
  supabase: SupabaseClient,
  libraryId: string,
  properties: PropertyConfig[],
  assets: AssetRow[],
  incomingValues: Record<string, unknown> | undefined
): Promise<{ removed: false } | { removed: true; fieldId: string }> {
  const field = findUnusedDefaultIdField(properties, assets, incomingValues);
  if (!field) return { removed: false };

  await deleteLibraryField(supabase, libraryId, field.id);
  return { removed: true, fieldId: field.id };
}
