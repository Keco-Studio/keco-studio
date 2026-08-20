import type { SupabaseClient } from '@supabase/supabase-js';

export type GddMapArtifactView = {
  artifactId: string;
  title: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'blocked';
  phase: 'planning' | 'submitting' | 'polling' | 'validating' | 'ready' | 'failed' | 'blocked';
  mapProjectId: string | null;
  mapRevisionId: string | null;
  mapAssetId: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

const ARTIFACT_COLUMNS = 'id,title,status,phase,map_project_id,map_revision_id,map_asset_id,error';
const ASSET_COLUMNS = 'id,map_revision_id,status,storage_path,width,height';

export async function resolveGddMapArtifact(
  supabase: SupabaseClient,
  projectId: string,
  artifactId: string,
): Promise<GddMapArtifactView | null> {
  const { data: artifact, error } = await supabase.from('gdd_map_artifacts')
    .select(ARTIFACT_COLUMNS).eq('id', artifactId).eq('project_id', projectId).maybeSingle();
  if (error) throw error;
  if (!artifact) return null;
  let imageUrl: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  // The provider can finish the private map asset before the child artifact
  // lease is settled. Terminal artifact states are therefore not authoritative
  // for whether an already-linked asset can be displayed.
  if (artifact.map_asset_id && artifact.status !== 'queued' && artifact.status !== 'running') {
    const { data: asset, error: assetError } = await supabase.from('map_assets')
      .select(ASSET_COLUMNS).eq('id', artifact.map_asset_id).eq('map_revision_id', artifact.map_revision_id).maybeSingle();
    if (assetError) throw assetError;
    if (asset?.status === 'ready' && typeof asset.storage_path === 'string') {
      const signed = await supabase.storage.from('map-assets').createSignedUrl(asset.storage_path, 300);
      if (!signed.error && signed.data?.signedUrl) imageUrl = signed.data.signedUrl;
      width = typeof asset.width === 'number' ? asset.width : null;
      height = typeof asset.height === 'number' ? asset.height : null;
    }
  }
  const assetDisplayed = imageUrl !== null;
  return {
    artifactId: artifact.id,
    title: artifact.title,
    status: assetDisplayed ? 'ready' : artifact.status,
    phase: assetDisplayed ? 'ready' : artifact.phase,
    mapProjectId: artifact.map_project_id,
    mapRevisionId: artifact.map_revision_id,
    mapAssetId: artifact.map_asset_id,
    imageUrl,
    width,
    height,
    error: assetDisplayed ? null : artifact.error,
  };
}

export async function resolveGddMapArtifacts(
  supabase: SupabaseClient,
  projectId: string,
  artifactIds: readonly string[],
): Promise<Map<string, GddMapArtifactView>> {
  const results = await Promise.all(artifactIds.map((id) => resolveGddMapArtifact(supabase, projectId, id)));
  return new Map(results.filter((value): value is GddMapArtifactView => Boolean(value)).map((value) => [value.artifactId, value]));
}
