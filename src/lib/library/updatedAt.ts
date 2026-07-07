interface SupabaseRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface TouchLibraryAssetEditUpdatedAtArgs {
  assetId: string;
  libraryId: string;
}

export async function touchLibraryAssetEditUpdatedAt(
  supabase: SupabaseRpcClient,
  { assetId, libraryId }: TouchLibraryAssetEditUpdatedAtArgs
): Promise<string | null> {
  const { data, error } = await supabase.rpc('touch_library_asset_edit_updated_at', {
    p_asset_id: assetId,
    p_library_id: libraryId,
  });

  if (error) throw error;
  return (data as string | null) ?? null;
}
