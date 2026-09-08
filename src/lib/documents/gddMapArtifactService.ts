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

export type GddMapDevelopmentRecord = {
  artifactId: string;
  title: string;
  status: GddMapArtifactView['status'];
  mapProjectId: string | null;
  mapRevisionId: string | null;
  mapAssetId: string | null;
  asset: null | {
    id: string;
    mapRevisionId: string;
    status: string;
    storagePath: string | null;
    sha256: string | null;
    width: number | null;
    height: number | null;
    hasTransparency: boolean | null;
  };
};

export async function resolveGddMapDevelopmentRecords(
  supabase: SupabaseClient,
  projectId: string,
  documentId: string,
  artifactIds: readonly string[],
): Promise<Map<string, GddMapDevelopmentRecord>> {
  const ids = [...new Set(artifactIds)].slice(0, 200);
  if (ids.length === 0) return new Map();
  const { data: artifacts, error } = await supabase.from('gdd_map_artifacts')
    .select('id,title,status,map_project_id,map_revision_id,map_asset_id')
    .eq('project_id', projectId).eq('gdd_document_id', documentId).in('id', ids);
  if (error) throw error;
  const revisionIds = (artifacts ?? []).flatMap((artifact) => typeof artifact.map_revision_id === 'string' ? [artifact.map_revision_id] : []);
  const revisionsById = new Map<string, Record<string, unknown>>();
  if (revisionIds.length > 0) {
    const { data: revisions, error: revisionError } = await supabase.from('map_revisions')
      .select('id,map_project_id').in('id', revisionIds);
    if (revisionError) throw revisionError;
    for (const revision of revisions ?? []) revisionsById.set(String(revision.id), revision as Record<string, unknown>);
  }
  const mapProjectIds = (artifacts ?? []).flatMap((artifact) => typeof artifact.map_project_id === 'string' ? [artifact.map_project_id] : []);
  const validMapProjectIds = new Set<string>();
  if (mapProjectIds.length > 0) {
    const { data: projects, error: projectError } = await supabase.from('map_projects')
      .select('id').eq('project_id', projectId).in('id', mapProjectIds);
    if (projectError) throw projectError;
    for (const project of projects ?? []) validMapProjectIds.add(String(project.id));
  }
  const assetIds = (artifacts ?? []).flatMap((artifact) => typeof artifact.map_asset_id === 'string' ? [artifact.map_asset_id] : []);
  const assetsById = new Map<string, Record<string, unknown>>();
  if (assetIds.length > 0) {
    const { data: assets, error: assetError } = await supabase.from('map_assets')
      .select('id,map_revision_id,status,storage_path,sha256,width,height,has_transparency')
      .in('id', assetIds);
    if (assetError) throw assetError;
    for (const asset of assets ?? []) assetsById.set(String(asset.id), asset as Record<string, unknown>);
  }
  return new Map((artifacts ?? []).map((artifact) => {
    const asset = typeof artifact.map_asset_id === 'string' ? assetsById.get(artifact.map_asset_id) : undefined;
    const revision = typeof artifact.map_revision_id === 'string' ? revisionsById.get(artifact.map_revision_id) : undefined;
    const exactAsset = asset
      && typeof artifact.map_project_id === 'string'
      && validMapProjectIds.has(artifact.map_project_id)
      && revision?.map_project_id === artifact.map_project_id
      && asset.map_revision_id === artifact.map_revision_id
      ? asset
      : undefined;
    return [String(artifact.id), {
      artifactId: String(artifact.id),
      title: String(artifact.title),
      status: artifact.status as GddMapArtifactView['status'],
      mapProjectId: typeof artifact.map_project_id === 'string' ? artifact.map_project_id : null,
      mapRevisionId: typeof artifact.map_revision_id === 'string' ? artifact.map_revision_id : null,
      mapAssetId: typeof artifact.map_asset_id === 'string' ? artifact.map_asset_id : null,
      asset: exactAsset ? {
        id: String(exactAsset.id),
        mapRevisionId: String(exactAsset.map_revision_id),
        status: String(exactAsset.status),
        storagePath: typeof exactAsset.storage_path === 'string' ? exactAsset.storage_path : null,
        sha256: typeof exactAsset.sha256 === 'string' ? exactAsset.sha256 : null,
        width: typeof exactAsset.width === 'number' ? exactAsset.width : null,
        height: typeof exactAsset.height === 'number' ? exactAsset.height : null,
        hasTransparency: typeof exactAsset.has_transparency === 'boolean' ? exactAsset.has_transparency : null,
      } : null,
    }];
  }));
}

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
