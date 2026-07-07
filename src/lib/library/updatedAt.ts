interface SupabaseRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

type SupabaseMutationResult<TSelected = unknown> = {
  data: TSelected;
  error: unknown;
};

interface SupabaseSingleBuilder<TSelected = unknown>
  extends PromiseLike<SupabaseMutationResult<TSelected>> {
  single(): PromiseLike<SupabaseMutationResult<TSelected>>;
}

interface SupabaseFilterBuilder<TSelected = unknown>
  extends PromiseLike<SupabaseMutationResult<TSelected>> {
  eq(column: string, value: unknown): SupabaseFilterBuilder<TSelected>;
  select(columns: string): SupabaseSingleBuilder<unknown>;
}

interface SupabaseUpdateBuilder {
  update(values: Record<string, unknown>): SupabaseFilterBuilder;
}

interface SupabaseTableClient {
  from(table: string): SupabaseUpdateBuilder;
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

export async function touchLibraryUpdatedAt(
  supabase: SupabaseTableClient,
  libraryId: string,
  projectId?: string
): Promise<void> {
  if (!supabase || !libraryId) return;
  const now = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('libraries')
      .update({ updated_at: now })
      .eq('id', libraryId)
      .select('folder_id, project_id')
      .single();

    if (error) throw error;

    const row = data as { folder_id?: string | null; project_id?: string | null } | null;
    const effectiveProjectId = projectId || row?.project_id;

    if (effectiveProjectId) {
      await supabase
        .from('projects')
        .update({ updated_at: now })
        .eq('id', effectiveProjectId);
    }

    const folderId = row?.folder_id;
    if (folderId) {
      await supabase
        .from('folders')
        .update({ updated_at: now })
        .eq('id', folderId);
    }
  } catch (error) {
    // Do not break editing flow if this side effect fails.
    // eslint-disable-next-line no-console
    console.warn(
      '[LibraryDataContext] Failed to touch updated_at for library/folder/project',
      { libraryId, projectId },
      error
    );
  }
}
