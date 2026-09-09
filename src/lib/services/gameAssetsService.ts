import type { SupabaseClient } from '@supabase/supabase-js';

export type GameAssetCategory =
  | 'character'
  | 'icon'
  | 'ui'
  | 'map'
  | 'prop'
  | 'vfx'
  | 'spritesheet'
  | 'media';
export type GameAssetStatus = 'ready' | 'queued' | 'generating' | 'failed' | 'blocked' | 'planned';
export type GameAssetSource = 'manual' | 'gdd' | 'map-generation' | 'character-generation' | 'animation-generation';

/** Sidebar / page category filter keys (includes "all"). */
export type GameAssetNavCategory = 'all' | GameAssetCategory;

export const GAME_ASSET_NAV_CATEGORIES: Array<{ key: GameAssetNavCategory; label: string }> = [
  { key: 'all', label: 'All assets' },
  { key: 'character', label: 'Characters' },
  { key: 'icon', label: 'Icons' },
  { key: 'ui', label: 'UI' },
  { key: 'map', label: 'Maps' },
  { key: 'prop', label: 'Props' },
  { key: 'vfx', label: 'VFX' },
  { key: 'spritesheet', label: 'SpriteSheets' },
  { key: 'media', label: 'Media' },
];

export const GAME_ASSETS_TREE_KEY = 'game-assets';

export function gameAssetsCategoryTreeKey(category: GameAssetNavCategory): string {
  return `game-assets-cat-${category}`;
}

export function parseGameAssetsCategoryParam(value: string | null | undefined): GameAssetNavCategory {
  if (
    value === 'character'
    || value === 'icon'
    || value === 'ui'
    || value === 'map'
    || value === 'prop'
    || value === 'vfx'
    || value === 'spritesheet'
    || value === 'media'
  ) {
    return value;
  }
  return 'all';
}

export type ProjectGameAsset = {
  id: string;
  projectId: string;
  name: string;
  category: GameAssetCategory;
  format: string;
  mimeType: string | null;
  status: GameAssetStatus;
  source: GameAssetSource;
  storagePath: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  fileSize: number | null;
  previewUrl: string | null;
  previewExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceRef: { kind: string; id: string };
};

export type GameAssetWarnings = Array<{ source: string; message: string }>;

const SHA256 = /^[a-f0-9]{64}$/i;

function asDate(value: unknown): string {
  return typeof value === 'string' && value ? value : new Date(0).toISOString();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extension(name: string, mimeType: string | null): string {
  const match = name.match(/\.([a-z0-9]{1,12})$/i);
  if (match) return match[1].toLowerCase();
  return mimeType?.split('/')[1]?.toLowerCase() ?? 'bin';
}

function status(value: unknown): GameAssetStatus {
  if (value === 'ready' || value === 'queued' || value === 'generating' || value === 'failed' || value === 'blocked' || value === 'planned') return value;
  if (value === 'draft') return 'planned';
  return 'planned';
}

function mapCategory(kind: unknown): GameAssetCategory {
  if (
    kind === 'terrain'
    || kind === 'road'
    || kind === 'object'
    || kind === 'inpaint'
    || kind === 'map_image'
    || kind === 'path'
    || kind === 'obstacle'
    || kind === 'background'
  ) {
    return 'map';
  }
  return 'map';
}

function normalizeCategory(value: unknown): GameAssetCategory {
  if (
    value === 'character'
    || value === 'icon'
    || value === 'ui'
    || value === 'map'
    || value === 'prop'
    || value === 'vfx'
    || value === 'spritesheet'
    || value === 'media'
  ) {
    return value;
  }
  // Legacy values from the first Game assets slice.
  if (value === 'animation') return 'spritesheet';
  if (value === 'effect') return 'vfx';
  if (value === 'other') return 'media';
  return 'media';
}

function mapDisplayName(mapName: string, assetKey: string): string {
  // Prefer the human map title; hide internal keys like "map-image".
  const cleaned = mapName.trim();
  if (cleaned) return cleaned;
  return assetKey.replace(/-/g, ' ');
}

function sourceForCharacter(kind: unknown): GameAssetSource {
  return kind === 'animation' ? 'animation-generation' : 'character-generation';
}

function baseAsset(input: Partial<ProjectGameAsset> & Pick<ProjectGameAsset, 'id' | 'projectId' | 'name' | 'category' | 'source' | 'sourceRef'>): ProjectGameAsset {
  const name = input.name || 'Untitled asset';
  return {
    id: input.id,
    projectId: input.projectId,
    name,
    category: input.category,
    format: input.format ?? extension(name, input.mimeType ?? null),
    mimeType: input.mimeType ?? null,
    status: input.status ?? 'planned',
    source: input.source,
    storagePath: input.storagePath ?? null,
    sha256: input.sha256 && SHA256.test(input.sha256) ? input.sha256.toLowerCase() : null,
    width: input.width ?? null,
    height: input.height ?? null,
    hasTransparency: input.hasTransparency ?? null,
    fileSize: input.fileSize ?? null,
    previewUrl: null,
    previewExpiresAt: null,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
    updatedAt: input.updatedAt ?? input.createdAt ?? new Date(0).toISOString(),
    sourceRef: input.sourceRef,
  };
}

export function normalizeManualImage(row: Record<string, unknown>): ProjectGameAsset {
  const name = String(row.name ?? row.file_name ?? 'Untitled image');
  return baseAsset({
    id: `manual:${String(row.id)}`,
    projectId: String(row.project_id),
    name,
    category: normalizeCategory(row.category),
    source: 'manual',
    sourceRef: { kind: 'project_game_assets', id: String(row.id) },
    format: extension(name, typeof row.mime_type === 'string' ? row.mime_type : null),
    mimeType: typeof row.mime_type === 'string' ? row.mime_type : null,
    status: status(row.status ?? 'ready'),
    storagePath: typeof row.storage_path === 'string' ? row.storage_path : null,
    sha256: typeof row.sha256 === 'string' ? row.sha256 : null,
    width: asNumber(row.width),
    height: asNumber(row.height),
    hasTransparency: typeof row.has_transparency === 'boolean' ? row.has_transparency : null,
    fileSize: asNumber(row.file_size),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at ?? row.created_at),
  });
}

export function normalizeMapAsset(row: Record<string, unknown>): ProjectGameAsset {
  const mapName = typeof row.map_name === 'string' ? row.map_name : 'Map';
  const key = String(row.asset_key ?? row.id);
  const plan = row.plan && typeof row.plan === 'object' ? row.plan as Record<string, unknown> : null;
  const planMap = plan?.map && typeof plan.map === 'object' ? plan.map as Record<string, unknown> : null;
  return baseAsset({
    id: `map:${String(row.id)}`,
    projectId: String(row.project_id),
    name: mapDisplayName(mapName, key),
    category: mapCategory(row.kind),
    source: row.source === 'gdd' ? 'gdd' : 'map-generation',
    sourceRef: { kind: row.source === 'gdd' ? 'gdd_map_artifacts' : 'map_assets', id: String(row.id) },
    format: 'png',
    mimeType: 'image/png',
    status: status(row.status),
    storagePath: typeof row.storage_path === 'string' ? row.storage_path : null,
    sha256: typeof row.sha256 === 'string' ? row.sha256 : null,
    // Prefer rendered asset pixels; fall back to plan output size for planned/empty previews.
    width: asNumber(row.width) ?? asNumber(planMap?.width) ?? asNumber(row.plan_width),
    height: asNumber(row.height) ?? asNumber(planMap?.height) ?? asNumber(row.plan_height),
    hasTransparency: typeof row.has_transparency === 'boolean' ? row.has_transparency : null,
    fileSize: asNumber((row.metadata as Record<string, unknown> | null)?.fileSize),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at ?? row.created_at),
  });
}

export function normalizeCharacterAsset(row: Record<string, unknown>): ProjectGameAsset {
  const generation = row.generation && typeof row.generation === 'object' ? row.generation as Record<string, unknown> : {};
  const isAnimation = row.kind === 'animation';
  const category: GameAssetCategory = isAnimation ? 'spritesheet' : 'character';
  const name = String(row.name ?? (isAnimation ? 'Sprite sheet' : 'Character'));
  return baseAsset({
    id: `character:${String(row.id)}`,
    projectId: String(row.project_id),
    name,
    category,
    source: sourceForCharacter(row.kind),
    sourceRef: { kind: 'character_assets', id: String(row.id) },
    format: 'png',
    mimeType: 'image/png',
    status: status(generation.status ?? row.status),
    storagePath: typeof generation.storage_path === 'string' ? generation.storage_path : null,
    sha256: typeof generation.sha256 === 'string' ? generation.sha256 : null,
    width: asNumber(generation.width),
    height: asNumber(generation.height),
    hasTransparency: typeof generation.has_transparency === 'boolean' ? generation.has_transparency : null,
    fileSize: asNumber((generation.metadata as Record<string, unknown> | null)?.fileSize),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at ?? row.created_at),
  });
}

export function countAssetCategories(assets: ProjectGameAsset[]): Record<'all' | GameAssetCategory, number> {
  const counts: Record<'all' | GameAssetCategory, number> = {
    all: assets.length,
    character: 0,
    icon: 0,
    ui: 0,
    map: 0,
    prop: 0,
    vfx: 0,
    spritesheet: 0,
    media: 0,
  };
  for (const asset of assets) counts[asset.category] += 1;
  return counts;
}

type Signer = (bucket: string, path: string) => Promise<{ url: string; expiresAt: string } | null>;

async function defaultSigner(supabase: SupabaseClient, bucket: string, path: string): Promise<{ url: string; expiresAt: string } | null> {
  const expiresIn = 300;
  const signed = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (signed.error || !signed.data?.signedUrl) return null;
  return { url: signed.data.signedUrl, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function aggregateProjectGameAssets(
  supabase: SupabaseClient,
  projectId: string,
  options: { sign?: Signer } = {},
): Promise<{ assets: ProjectGameAsset[]; warnings: GameAssetWarnings }> {
  const warnings: GameAssetWarnings = [];
  const assets: ProjectGameAsset[] = [];
  const sign = options.sign ?? ((bucket, path) => defaultSigner(supabase, bucket, path));

  const add = async (asset: ProjectGameAsset, bucket: string) => {
    if (asset.status === 'ready' && asset.storagePath) {
      try {
        const signed = await sign(bucket, asset.storagePath);
        if (signed) { asset.previewUrl = signed.url; asset.previewExpiresAt = signed.expiresAt; }
      } catch { /* preview is optional; keep the authoritative record */ }
    }
    assets.push(asset);
  };

  const manual = await supabase.from('project_game_assets').select('*').eq('project_id', projectId).order('created_at', { ascending: false });
  if (manual.error) warnings.push({ source: 'manual', message: 'Manual uploads are temporarily unavailable.' });
  for (const row of (manual.data ?? []) as Record<string, unknown>[]) await add(normalizeManualImage(row), 'library-media-files');

  const maps = await supabase.from('map_projects').select('id,name,project_id').eq('project_id', projectId);
  if (maps.error) warnings.push({ source: 'maps', message: 'Map generation assets are temporarily unavailable.' });
  const mapProjects = (maps.data ?? []) as Record<string, unknown>[];
  const gddArtifacts = await supabase.from('gdd_map_artifacts').select('map_asset_id,title').eq('project_id', projectId).not('map_asset_id', 'is', null);
  if (gddArtifacts.error) warnings.push({ source: 'gdd', message: 'GDD map provenance is temporarily unavailable.' });
  const gddByAsset = new Map(((gddArtifacts.data ?? []) as Record<string, unknown>[]).map((row) => [String(row.map_asset_id), row]));
  const mapProjectIds = mapProjects.map((row) => String(row.id));
  if (mapProjectIds.length) {
    const revisions = await supabase.from('map_revisions').select('id,map_project_id,plan').in('map_project_id', mapProjectIds);
    const revisionRows = (revisions.data ?? []) as Record<string, unknown>[];
    const revisionIds = revisionRows.map((row) => String(row.id));
    if (revisionIds.length) {
      const mapAssets = await supabase.from('map_assets').select('*').in('map_revision_id', revisionIds);
      if (mapAssets.error) warnings.push({ source: 'maps', message: 'Some map assets could not be read.' });
      const projectByMap = new Map(mapProjects.map((row) => [String(row.id), row]));
      const revisionById = new Map(revisionRows.map((row) => [String(row.id), row]));
      for (const row of (mapAssets.data ?? []) as Record<string, unknown>[]) {
        const revision = revisionById.get(String(row.map_revision_id));
        if (!revision) continue;
        const map = projectByMap.get(String(revision.map_project_id));
        if (!map) continue;
        const artifact = gddByAsset.get(String(row.id));
        await add(normalizeMapAsset({
          ...row,
          project_id: projectId,
          map_project_id: map.id,
          map_name: artifact?.title ?? map.name,
          source: artifact ? 'gdd' : 'map-generation',
          plan: revision.plan ?? null,
        }), 'map-assets');
      }
    }
  }

  const characters = await supabase.from('character_assets').select('*').eq('project_id', projectId).order('updated_at', { ascending: false });
  if (characters.error) warnings.push({ source: 'characters', message: 'Character assets are temporarily unavailable.' });
  for (const row of (characters.data ?? []) as Record<string, unknown>[]) {
    const attempts = await supabase.from('character_generation_attempts').select('*').eq('character_asset_id', String(row.id)).order('created_at', { ascending: false }).limit(1);
    const generation = (attempts.data?.[0] ?? null) as Record<string, unknown> | null;
    await add(normalizeCharacterAsset({ ...row, generation }), 'character-assets');
  }

  assets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { assets, warnings: warnings.slice(0, 8) };
}
