import type { SupabaseClient } from '@supabase/supabase-js';
import { listDocuments } from '@/lib/services/documentService';
import { listProjects } from '@/lib/services/projectService';
import { MapPlanSchema, MapPlanV2Schema, validateMapPlanV2, type MapPlan, type MapPlanV2 } from '../model/mapPlanSchema';
import {
  MapPlanV3Schema,
  validateMapPlanV3,
  validateMapSceneV3,
  type MapPlanV3,
  type MapReferenceV3,
  type MapSceneV3,
} from '../model/directMapSchema';
import {
  MapSceneSchema,
  MapSceneV2Schema,
  validateMapSceneV2,
  type MapAssetKind,
  type MapScene,
  type MapSceneV2,
} from '../model/mapSceneSchema';

export type MapSourceToken = {
  documentId: string;
  documentUpdatedAt: string;
  epoch: number;
  revision: number;
};

export type DirectMapPlanSelectionInput = {
  references: Array<Pick<MapReferenceV3, 'assetId' | 'role' | 'usage'>>;
  styleReference: Pick<NonNullable<MapPlanV3['styleReference']>, 'assetId' | 'copy'> | null;
};

export type MapDraftIdentity = {
  mapId: string;
  revisionId: string;
  revisionNumber: number;
  saveVersion: number;
};

export type MapAssetRecord = {
  id: string;
  map_revision_id: string;
  asset_key: string;
  kind: 'terrain' | 'road' | 'object' | 'inpaint' | 'path' | 'obstacle' | 'background' | 'map_image';
  status: 'planned' | 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';
  requested_capability: string | null;
  prompt: string;
  generation_params: Record<string, unknown>;
  metadata: Record<string, unknown>;
  storage_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  has_transparency: boolean | null;
  last_error_code: string | null;
  attempt_count: number;
  generation_id?: string | null;
  plan_fingerprint?: string | null;
  provider_operation?: string | null;
  provider_job_id?: string | null;
};

export type MapReferenceRecord = {
  id: string;
  projectId: string;
  name: string;
  storagePath: string;
  sha256: string;
  width: number;
  height: number;
  contentType: 'image/png';
  byteSize: number;
  previewUrl: string | null;
};

export type MapRevisionRowV2 = {
  id: string;
  map_project_id: string;
  revision_number: number;
  save_version: number;
  parent_revision_id: string | null;
  source_document_id: string | null;
  source_document_updated_at: string | null;
  source_epoch: number | null;
  source_revision: number | null;
  schema_version: 2;
  plan: unknown;
  scene: unknown;
  status: 'draft' | 'generating' | 'partial' | 'ready' | 'failed';
};

export type MapRevisionRowV3 = Omit<MapRevisionRowV2, 'schema_version'> & {
  schema_version: 3;
};

export type SavedMapSummary = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  currentRevisionId: string;
  updatedAt: string;
  schemaVersion: 3;
};

export type SavedMapWorkspace = {
  identity: MapDraftIdentity;
  plan: MapPlan;
  scene: MapScene;
  projectId: string;
  sourceDocumentId: string;
  assetRevisionId: string | null;
  assets: MapAssetRecord[];
};

export type SavedMapWorkspaceV2 = {
  identity: MapDraftIdentity;
  plan: MapPlanV2;
  scene: MapSceneV2;
  projectId: string;
  sourceDocumentId: string | null;
  assetRevisionId: string | null;
  assets: MapAssetRecord[];
};

export type SavedMapWorkspaceV3 = {
  identity: MapDraftIdentity;
  plan: MapPlanV3;
  scene: MapSceneV3;
  projectId: string;
  sourceDocumentId: string | null;
  generationPlan: MapPlanV3 | null;
  assetRevisionId: string | null;
  imageAsset: MapAssetRecord | null;
  imageUrl: string | null;
  boundImageAsset: MapAssetRecord | null;
  boundImageUrl: string | null;
};

export type CreateMapAssetPlanV2Input = {
  revisionId: string;
  generationId: string;
  assetKey: string;
  kind: MapAssetKind;
  prompt: string;
  requestedCapability: string | null;
  generationParams: Record<string, unknown>;
  referenceAssetIds: string[];
  referenceHashes: string[];
  planFingerprint: string;
  metadata: Record<string, unknown>;
};

export class CreateMapServiceError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'CreateMapServiceError';
  }
}

function firstRow<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new CreateMapServiceError('invalid_response');
  return row as T;
}

function parseMapSourceToken(value: unknown): MapSourceToken | null {
  if (value == null) return null;
  if (!value || typeof value !== 'object') throw new CreateMapServiceError('invalid_response');
  const token = value as Record<string, unknown>;
  if (
    typeof token.documentId !== 'string' ||
    typeof token.documentUpdatedAt !== 'string' ||
    !Number.isInteger(token.epoch) ||
    !Number.isInteger(token.revision)
  ) {
    throw new CreateMapServiceError('invalid_response');
  }
  return {
    documentId: token.documentId,
    documentUpdatedAt: token.documentUpdatedAt,
    epoch: token.epoch as number,
    revision: token.revision as number,
  };
}

function projectName(value: unknown): string {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === 'object' && typeof (relation as { name?: unknown }).name === 'string'
    ? (relation as { name: string }).name
    : 'Unknown project';
}

function relationSchemaVersion(value: unknown): 3 | null {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== 'object') return null;
  const version = Number((relation as { schema_version?: unknown }).schema_version);
  return version === 3 ? version : null;
}

function parseMapV2(planInput: unknown, sceneInput: unknown): { plan: MapPlanV2; scene: MapSceneV2 } {
  const plan = MapPlanV2Schema.safeParse(planInput);
  const scene = MapSceneV2Schema.safeParse(sceneInput);
  if (!plan.success || !scene.success) {
    throw new CreateMapServiceError('invalid_saved_map', 'Saved map Plan or Scene is invalid');
  }
  const validation = validateMapSceneV2(plan.data, scene.data);
  if (validation.success === false) {
    throw new CreateMapServiceError('invalid_saved_map', validation.issues.map((issue) => issue.message).join('; '));
  }
  return { plan: plan.data, scene: validation.data };
}

function parseMapV3(planInput: unknown, sceneInput: unknown): { plan: MapPlanV3; scene: MapSceneV3 } {
  const plan = validateMapPlanV3(planInput);
  if (plan.success === false) {
    throw new CreateMapServiceError('invalid_saved_map', plan.issues.map((issue) => issue.message).join('; '));
  }
  const scene = validateMapSceneV3(plan.data, sceneInput);
  if (scene.success === false) {
    throw new CreateMapServiceError('invalid_saved_map', scene.issues.map((issue) => issue.message).join('; '));
  }
  return { plan: plan.data, scene: scene.data };
}

async function listMapAssets(supabase: SupabaseClient, revisionId: string): Promise<MapAssetRecord[]> {
  const { data, error } = await supabase.from('map_assets')
    .select('*').eq('map_revision_id', revisionId).order('asset_key');
  if (error) throw new CreateMapServiceError(error.code ?? 'asset_load_failed', error.message);
  return (data ?? []) as unknown as MapAssetRecord[];
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new CreateMapServiceError(
      typeof payload.code === 'string' ? payload.code : `http_${response.status}`,
      typeof payload.error === 'string' ? payload.error : 'Create Map request failed'
    );
  }
  return payload;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function parseReferenceRecord(value: unknown): MapReferenceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CreateMapServiceError('invalid_response');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' || !UUID_PATTERN.test(record.id) ||
    typeof record.projectId !== 'string' || !UUID_PATTERN.test(record.projectId) ||
    typeof record.name !== 'string' || !record.name.trim() || record.name.length > 160 ||
    typeof record.storagePath !== 'string' ||
    typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256) ||
    typeof record.width !== 'number' || !Number.isInteger(record.width) || record.width < 1 || record.width > 2048 ||
    typeof record.height !== 'number' || !Number.isInteger(record.height) || record.height < 1 || record.height > 2048 ||
    record.contentType !== 'image/png' ||
    typeof record.byteSize !== 'number' || !Number.isInteger(record.byteSize) || record.byteSize < 1 || record.byteSize > 5 * 1024 * 1024 ||
    (record.previewUrl !== null && typeof record.previewUrl !== 'string')
  ) {
    throw new CreateMapServiceError('invalid_response');
  }
  if (record.storagePath !== `references/${record.projectId}/${record.id}/${record.sha256}.png`) {
    throw new CreateMapServiceError('invalid_response');
  }
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    storagePath: record.storagePath,
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    contentType: 'image/png',
    byteSize: record.byteSize,
    previewUrl: record.previewUrl as string | null,
  };
}

function parseReferenceList(payload: Record<string, unknown>): MapReferenceRecord[] {
  if (!Array.isArray(payload.references)) throw new CreateMapServiceError('invalid_response');
  return payload.references.map(parseReferenceRecord);
}

async function pixelLabFunctionError(error: unknown): Promise<CreateMapServiceError> {
  const objectMessage = error && typeof error === 'object' && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message
    : null;
  const fallbackMessage = error instanceof Error ? error.message : objectMessage ?? 'PixelLab function request failed';
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null;
  if (context && typeof context === 'object' && 'json' in context && typeof context.json === 'function') {
    const payload = await (context.json as () => Promise<unknown>)().catch(() => null);
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      const code = typeof record.code === 'string' && /^[a-z0-9_]{1,80}$/.test(record.code)
        ? record.code
        : 'pixellab_function_error';
      const message = typeof record.error === 'string'
        && record.error.length <= 240
        && !/https?:\/\/|bearer\s|token|secret|api.?key/i.test(record.error)
        ? record.error
        : fallbackMessage;
      return new CreateMapServiceError(code, message);
    }
  }
  return new CreateMapServiceError('pixellab_function_error', fallbackMessage);
}

export function createSceneFromPlan(plan: MapPlan): MapScene {
  const objectPlans = new Map(plan.objects.map((object) => [object.assetKey, object]));
  const columns = Math.ceil(plan.map.width / plan.map.tileSize);
  const rows = Math.ceil(plan.map.height / plan.map.tileSize);
  const primaryTerrain = plan.terrains[0]?.assetKey ?? '';
  const distanceToSegment = (point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
  };
  const tiles: MapScene['tiles'] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const center = { x: x * plan.map.tileSize + plan.map.tileSize / 2, y: y * plan.map.tileSize + plan.map.tileSize / 2 };
      const road = plan.roads.find((candidate) => candidate.points.some((point, index) => {
        const start = candidate.points[index - 1];
        return Boolean(start && distanceToSegment(
          center,
          { x: start.x ?? 0, y: start.y ?? 0 },
          { x: point.x ?? 0, y: point.y ?? 0 },
        ) <= candidate.width / 2);
      }));
      tiles.push({ id: `tile-${x}-${y}`, layerId: 'terrain', terrainKey: road?.assetKey ?? primaryTerrain, x, y, wangIndex: road ? 1 : 0 });
    }
  }
  return {
    schemaVersion: 1,
    size: { width: plan.map.width, height: plan.map.height, tileSize: plan.map.tileSize },
    layers: [
      { id: 'terrain', name: 'Terrain and roads', kind: 'terrain', visible: true, locked: false },
      { id: 'objects', name: 'Movable objects', kind: 'objects', visible: true, locked: false },
      { id: 'overlay', name: 'Obstacles', kind: 'overlay', visible: true, locked: false },
    ],
    tiles,
    objects: plan.objectInstances.flatMap((instance) => {
      const definition = objectPlans.get(instance.assetKey);
      if (!definition) return [];
      return [{
        ...instance,
        layerId: 'objects',
        groundAnchor: definition.groundAnchor,
        movable: definition.movable,
      }];
    }),
    obstacles: plan.obstacles,
    canvas: { zoom: 1, panX: 24, panY: 24, snapToGrid: true },
  };
}

export function createMapService(supabase: SupabaseClient) {
  return {
    listProjects: (userId?: string) => listProjects(supabase, userId),
    listDocuments: (projectId: string) => listDocuments(supabase, projectId),

    async listSavedMaps(): Promise<SavedMapSummary[]> {
      const { data, error } = await supabase
        .from('map_projects')
        .select('id, project_id, name, current_revision_id, updated_at, current_revision:map_revisions!map_projects_current_revision_fk!inner(schema_version), projects!map_projects_project_id_fkey(name)')
        .eq('current_revision.schema_version', 3)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw new CreateMapServiceError(error.code ?? 'map_list_failed', error.message);
      return (data ?? []).flatMap((row) => {
        const schemaVersion = relationSchemaVersion(row.current_revision);
        if (!row.current_revision_id || !schemaVersion) return [];
        return [{
          id: String(row.id), projectId: String(row.project_id), projectName: projectName(row.projects),
          name: String(row.name), currentRevisionId: String(row.current_revision_id),
          updatedAt: String(row.updated_at), schemaVersion,
        }];
      });
    },

    async loadSavedMap(mapId: string): Promise<SavedMapWorkspace> {
      const { data: map, error: mapError } = await supabase
        .from('map_projects').select('project_id, current_revision_id').eq('id', mapId).single();
      if (mapError || !map?.current_revision_id) {
        throw new CreateMapServiceError(mapError?.code ?? 'map_load_failed', mapError?.message ?? 'Map has no current revision');
      }
      const { data: revision, error: revisionError } = await supabase
        .from('map_revisions')
        .select('id, revision_number, save_version, source_document_id, plan, scene')
        .eq('id', map.current_revision_id).single();
      if (revisionError || !revision) {
        throw new CreateMapServiceError(revisionError?.code ?? 'map_load_failed', revisionError?.message);
      }
      const parsedPlan = MapPlanSchema.safeParse(revision.plan);
      const parsedScene = MapSceneSchema.safeParse(revision.scene);
      if (!parsedPlan.success || !parsedScene.success) {
        throw new CreateMapServiceError('invalid_saved_map', 'Saved map Plan or Scene is invalid');
      }
      const { data: assetOwner, error: ownerError } = await supabase
        .from('map_revisions')
        .select('id, revision_number, map_assets!inner(id)')
        .eq('map_project_id', mapId)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ownerError) throw new CreateMapServiceError(ownerError.code ?? 'asset_load_failed', ownerError.message);
      const assetRevisionId = assetOwner?.id ? String(assetOwner.id) : null;
      const assets = assetRevisionId ? await listMapAssets(supabase, assetRevisionId) : [];
      return {
        identity: {
          mapId, revisionId: String(revision.id), revisionNumber: Number(revision.revision_number),
          saveVersion: Number(revision.save_version),
        },
        plan: parsedPlan.data, scene: parsedScene.data, projectId: String(map.project_id),
        sourceDocumentId: String(revision.source_document_id), assetRevisionId, assets,
      };
    },

    async loadSavedMapV2(mapId: string): Promise<SavedMapWorkspaceV2> {
      const { data: map, error: mapError } = await supabase
        .from('map_projects').select('project_id, current_revision_id').eq('id', mapId).single();
      if (mapError || !map?.current_revision_id) {
        throw new CreateMapServiceError(mapError?.code ?? 'map_load_failed', mapError?.message ?? 'Map has no current revision');
      }
      const { data: revision, error: revisionError } = await supabase
        .from('map_revisions')
        .select('id, revision_number, save_version, source_document_id, schema_version, plan, scene')
        .eq('id', map.current_revision_id)
        .eq('schema_version', 2)
        .single();
      if (revisionError || !revision) {
        throw new CreateMapServiceError(revisionError?.code ?? 'map_load_failed', revisionError?.message);
      }
      const parsed = parseMapV2(revision.plan, revision.scene);
      const assetRevisionId = parsed.scene.background?.sourceRevisionId ?? null;
      const assets = assetRevisionId ? await listMapAssets(supabase, assetRevisionId) : [];
      return {
        identity: {
          mapId,
          revisionId: String(revision.id),
          revisionNumber: Number(revision.revision_number),
          saveVersion: Number(revision.save_version),
        },
        plan: parsed.plan,
        scene: parsed.scene,
        projectId: String(map.project_id),
        sourceDocumentId: revision.source_document_id == null ? null : String(revision.source_document_id),
        assetRevisionId,
        assets,
      };
    },

    async loadSavedMapV3(mapId: string): Promise<SavedMapWorkspaceV3> {
      const { data: map, error: mapError } = await supabase
        .from('map_projects').select('project_id, current_revision_id').eq('id', mapId).single();
      if (mapError || !map?.current_revision_id) {
        throw new CreateMapServiceError(mapError?.code ?? 'map_load_failed', mapError?.message ?? 'Map has no current revision');
      }
      const { data: revision, error: revisionError } = await supabase
        .from('map_revisions')
        .select('id, revision_number, save_version, parent_revision_id, source_document_id, schema_version, plan, scene')
        .eq('id', map.current_revision_id)
        .eq('schema_version', 3)
        .single();
      if (revisionError || !revision) {
        throw new CreateMapServiceError(revisionError?.code ?? 'map_load_failed', revisionError?.message);
      }
      const parsed = parseMapV3(revision.plan, revision.scene);
      const base = {
        identity: {
          mapId,
          revisionId: String(revision.id),
          revisionNumber: Number(revision.revision_number),
          saveVersion: Number(revision.save_version),
        },
        plan: parsed.plan,
        scene: parsed.scene,
        projectId: String(map.project_id),
        sourceDocumentId: revision.source_document_id == null ? null : String(revision.source_document_id),
      };
      const binding = parsed.scene.mapImage;
      const parentRevisionId = typeof revision.parent_revision_id === 'string' ? revision.parent_revision_id : null;
      const generationRevisionId = parentRevisionId ?? binding?.sourceRevisionId ?? null;
      let generationPlan: MapPlanV3 | null = generationRevisionId ? parsed.plan : null;
      if (parentRevisionId) {
        const { data: generationRevision, error: generationRevisionError } = await supabase
          .from('map_revisions')
          .select('schema_version, plan')
          .eq('id', parentRevisionId)
          .eq('schema_version', 3)
          .single();
        const validatedGenerationPlan = validateMapPlanV3(generationRevision?.plan);
        if (generationRevisionError || validatedGenerationPlan.success === false) {
          throw new CreateMapServiceError(
            generationRevisionError?.code ?? 'invalid_saved_map',
            generationRevisionError?.message ?? 'Generation Plan is invalid',
          );
        }
        generationPlan = validatedGenerationPlan.data;
      }
      const assetCache = new Map<string, MapAssetRecord | null>();
      const loadDirectAsset = async (revisionId: string): Promise<MapAssetRecord | null> => {
        if (assetCache.has(revisionId)) return assetCache.get(revisionId) ?? null;
        const { data: assets, error: assetError } = await supabase.from('map_assets')
          .select('*')
          .eq('map_revision_id', revisionId)
          .eq('asset_key', 'map-image')
          .eq('kind', 'map_image')
          .limit(2);
        if (assetError) throw new CreateMapServiceError(assetError.code ?? 'asset_load_failed', assetError.message);
        if (!Array.isArray(assets) || assets.length > 1) {
          throw new CreateMapServiceError('invalid_saved_map', 'Direct map image is ambiguous');
        }
        const found = assets.length === 1 ? assets[0] as unknown as MapAssetRecord : null;
        assetCache.set(revisionId, found);
        return found;
      };
      const validateDirectAsset = (
        imageAsset: MapAssetRecord,
        revisionId: string,
        expectedMap: MapPlanV3['map'],
      ) => {
        if (
          imageAsset.map_revision_id !== revisionId
          || imageAsset.asset_key !== 'map-image'
          || imageAsset.kind !== 'map_image'
          || imageAsset.requested_capability !== 'direct_map_image'
          || typeof imageAsset.generation_id !== 'string'
          || !UUID_PATTERN.test(imageAsset.generation_id)
          || typeof imageAsset.plan_fingerprint !== 'string'
          || !SHA256_PATTERN.test(imageAsset.plan_fingerprint)
          || ((imageAsset.status === 'generating' || imageAsset.status === 'ready')
            && (imageAsset.provider_operation !== 'create_image_pro'
              || typeof imageAsset.provider_job_id !== 'string'
              || imageAsset.provider_job_id.length === 0))
        ) {
          throw new CreateMapServiceError('invalid_saved_map', 'Direct map generation identity is invalid');
        }
        if (imageAsset.status !== 'ready') return;
        const expectedStoragePath = `${map.project_id}/${mapId}/${revisionId}/map-image/${imageAsset.sha256}.png`;
        if (
          imageAsset.width !== expectedMap.width
          || imageAsset.height !== expectedMap.height
          || imageAsset.has_transparency !== false
          || typeof imageAsset.storage_path !== 'string'
          || typeof imageAsset.sha256 !== 'string'
          || !SHA256_PATTERN.test(imageAsset.sha256)
          || imageAsset.storage_path !== expectedStoragePath
        ) {
          throw new CreateMapServiceError('invalid_saved_map', 'Ready map image does not match the V3 Scene');
        }
      };
      const generationAsset = generationRevisionId ? await loadDirectAsset(generationRevisionId) : null;
      if (generationAsset && generationPlan) {
        validateDirectAsset(generationAsset, generationRevisionId!, generationPlan.map);
      }
      const boundImageAsset = binding ? await loadDirectAsset(binding.sourceRevisionId) : null;
      if (binding && (!boundImageAsset || boundImageAsset.status !== 'ready')) {
        throw new CreateMapServiceError('invalid_saved_map', 'Bound map image is missing or not ready');
      }
      if (boundImageAsset) validateDirectAsset(boundImageAsset, binding!.sourceRevisionId, parsed.plan.map);
      const signedUrls = new Map<string, string | null>();
      const signReadyAsset = async (imageAsset: MapAssetRecord | null): Promise<string | null> => {
        if (!imageAsset || imageAsset.status !== 'ready' || !imageAsset.storage_path) return null;
        if (signedUrls.has(imageAsset.id)) return signedUrls.get(imageAsset.id) ?? null;
        const { data: signed, error: signedError } = await supabase.storage.from('map-assets')
          .createSignedUrl(imageAsset.storage_path, 300);
        const url = !signedError && typeof signed?.signedUrl === 'string' ? signed.signedUrl : null;
        signedUrls.set(imageAsset.id, url);
        return url;
      };
      const imageUrl = await signReadyAsset(generationAsset);
      const boundImageUrl = await signReadyAsset(boundImageAsset);
      return {
        ...base,
        generationPlan,
        assetRevisionId: generationRevisionId,
        imageAsset: generationAsset,
        imageUrl,
        boundImageAsset,
        boundImageUrl,
      };
    },

    async createPlan(projectId: string, documentId: string): Promise<{ plan: MapPlan; sourceToken: MapSourceToken }> {
      const payload = await responseJson(await fetch('/api/create-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 2, projectId, documentId }),
      }));
      return payload as unknown as { plan: MapPlan; sourceToken: MapSourceToken };
    },

    async createPlanV2(
      description: string,
      projectId?: string,
      documentId?: string
    ): Promise<{ plan: MapPlanV2; sourceToken: MapSourceToken | null }> {
      const payload = await responseJson(await fetch('/api/create-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 2,
          description,
          ...(projectId ? { projectId } : {}),
          ...(documentId ? { documentId } : {}),
        }),
      }));
      const parsed = validateMapPlanV2(payload.plan);
      if (parsed.success === false) throw new CreateMapServiceError('invalid_response', 'Planner returned an invalid MapPlan V2');
      return { plan: parsed.data, sourceToken: parseMapSourceToken(payload.sourceToken) };
    },

    async createPlanV3(
      description: string,
      projectId?: string,
      documentId?: string,
      selection?: DirectMapPlanSelectionInput,
    ): Promise<{ plan: MapPlanV3; sourceToken: MapSourceToken | null }> {
      const payload = await responseJson(await fetch('/api/create-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 3,
          description,
          ...(projectId ? { projectId } : {}),
          ...(documentId ? { documentId } : {}),
          ...(selection ? {
            referenceIds: selection.references.map((reference) => reference.assetId),
            styleReferenceId: selection.styleReference?.assetId ?? null,
            referenceRoles: Object.fromEntries(selection.references.map((reference) => [reference.assetId, reference.role])),
            referenceUsage: Object.fromEntries(selection.references.map((reference) => [reference.assetId, reference.usage])),
            styleCopy: selection.styleReference?.copy ?? [],
          } : {}),
        }),
      }));
      const parsed = MapPlanV3Schema.safeParse(payload.plan);
      if (!parsed.success) throw new CreateMapServiceError('invalid_response', 'Planner returned an invalid MapPlan V3');
      return { plan: parsed.data, sourceToken: parseMapSourceToken(payload.sourceToken) };
    },

    async listReferences(projectId: string): Promise<MapReferenceRecord[]> {
      return responseJson(await fetch(`/api/create-map/references?projectId=${encodeURIComponent(projectId)}`))
        .then(parseReferenceList);
    },

    async uploadReference(projectId: string, file: File): Promise<MapReferenceRecord> {
      const body = new FormData();
      body.set('projectId', projectId);
      body.set('file', file);
      const payload = await responseJson(await fetch('/api/create-map/references', { method: 'POST', body }));
      return parseReferenceRecord(payload.reference);
    },

    async createProject(projectId: string, plan: MapPlan, scene: MapScene, source: MapSourceToken): Promise<MapDraftIdentity> {
      const { data, error } = await supabase.rpc('create_map_project', {
        p_project_id: projectId,
        p_name: plan.name,
        p_source_document_id: source.documentId,
        p_source_document_updated_at: source.documentUpdatedAt,
        p_source_epoch: source.epoch,
        p_source_revision: source.revision,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'create_failed', error.message);
      const row = firstRow<{ map_id: string; draft_revision_id: string; revision_number: number; save_version: number }>(data);
      return { mapId: row.map_id, revisionId: row.draft_revision_id, revisionNumber: row.revision_number, saveVersion: row.save_version };
    },

    async createProjectV2(
      projectId: string,
      planInput: MapPlanV2,
      sceneInput: MapSceneV2,
      source: MapSourceToken | null
    ): Promise<MapDraftIdentity> {
      const { plan, scene } = parseMapV2(planInput, sceneInput);
      const { data, error } = await supabase.rpc('create_map_project_v2', {
        p_project_id: projectId,
        p_name: plan.name,
        p_source_document_id: source?.documentId ?? null,
        p_source_document_updated_at: source?.documentUpdatedAt ?? null,
        p_source_epoch: source?.epoch ?? null,
        p_source_revision: source?.revision ?? null,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'create_failed', error.message);
      const row = firstRow<{ map_id: string; draft_revision_id: string; revision_number: number; save_version: number }>(data);
      return { mapId: row.map_id, revisionId: row.draft_revision_id, revisionNumber: row.revision_number, saveVersion: row.save_version };
    },

    async createProjectV3(
      projectId: string,
      planInput: MapPlanV3,
      sceneInput: MapSceneV3,
      source: MapSourceToken | null,
    ): Promise<MapDraftIdentity> {
      const { plan, scene } = parseMapV3(planInput, sceneInput);
      const { data, error } = await supabase.rpc('create_map_project_v3', {
        p_project_id: projectId,
        p_name: plan.name,
        p_source_document_id: source?.documentId ?? null,
        p_source_document_updated_at: source?.documentUpdatedAt ?? null,
        p_source_epoch: source?.epoch ?? null,
        p_source_revision: source?.revision ?? null,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'create_failed', error.message);
      const row = firstRow<{ map_id: string; draft_revision_id: string; revision_number: number; save_version: number }>(data);
      return { mapId: row.map_id, revisionId: row.draft_revision_id, revisionNumber: row.revision_number, saveVersion: row.save_version };
    },

    async saveDraft(identity: MapDraftIdentity, plan: MapPlan, scene: MapScene): Promise<number> {
      const { data, error } = await supabase.rpc('save_map_draft', {
        p_map_id: identity.mapId,
        p_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'save_failed', error.message);
      const row = firstRow<{ status: string; save_version: number | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (row.status !== 'saved' || row.save_version == null) throw new CreateMapServiceError('invalid_response');
      return row.save_version;
    },

    async saveDraftV2(identity: MapDraftIdentity, planInput: MapPlanV2, sceneInput: MapSceneV2): Promise<number> {
      const { plan, scene } = parseMapV2(planInput, sceneInput);
      const { data, error } = await supabase.rpc('save_map_draft_v2', {
        p_map_id: identity.mapId,
        p_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'save_failed', error.message);
      const row = firstRow<{ status: string; save_version: number | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (row.status !== 'saved' || row.save_version == null) throw new CreateMapServiceError('invalid_response');
      return row.save_version;
    },

    async saveDraftV3(identity: MapDraftIdentity, planInput: MapPlanV3, sceneInput: MapSceneV3): Promise<number> {
      const { plan, scene } = parseMapV3(planInput, sceneInput);
      const { data, error } = await supabase.rpc('save_map_draft_v3', {
        p_map_id: identity.mapId,
        p_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'save_failed', error.message);
      const row = firstRow<{ status: string; save_version: number | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (row.status !== 'saved' || row.save_version == null) throw new CreateMapServiceError('invalid_response');
      return row.save_version;
    },

    async forkDraft(identity: MapDraftIdentity, plan: MapPlan, scene: MapScene): Promise<MapDraftIdentity> {
      const { data: map, error: mapError } = await supabase
        .from('map_projects')
        .select('current_revision_id')
        .eq('id', identity.mapId)
        .single();
      if (mapError || !map?.current_revision_id) {
        throw new CreateMapServiceError(mapError?.code ?? 'load_failed', mapError?.message);
      }
      const { data, error } = await supabase.rpc('fork_map_draft', {
        p_map_id: identity.mapId,
        p_parent_revision_id: identity.revisionId,
        p_expected_current_revision_id: map.current_revision_id,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'fork_failed', error.message);
      const row = firstRow<{ status: string; draft_revision_id: string | null; revision_number: number | null; save_version: number | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (!row.draft_revision_id || row.revision_number == null || row.save_version == null) throw new CreateMapServiceError('invalid_response');
      return { mapId: identity.mapId, revisionId: row.draft_revision_id, revisionNumber: row.revision_number, saveVersion: row.save_version };
    },

    async loadRevision(revisionId: string): Promise<{ plan: MapPlan; scene: MapScene; saveVersion: number }> {
      const { data, error } = await supabase.from('map_revisions').select('plan, scene, save_version').eq('id', revisionId).single();
      if (error || !data) throw new CreateMapServiceError(error?.code ?? 'load_failed', error?.message);
      return { plan: data.plan as MapPlan, scene: data.scene as MapScene, saveVersion: Number(data.save_version) };
    },

    async loadCurrentDraft(mapId: string): Promise<{ identity: MapDraftIdentity; plan: MapPlan; scene: MapScene }> {
      const { data: map, error: mapError } = await supabase
        .from('map_projects')
        .select('current_revision_id')
        .eq('id', mapId)
        .single();
      if (mapError || !map?.current_revision_id) {
        throw new CreateMapServiceError(mapError?.code ?? 'load_failed', mapError?.message);
      }
      const { data, error } = await supabase
        .from('map_revisions')
        .select('plan, scene, save_version, revision_number')
        .eq('id', map.current_revision_id)
        .single();
      if (error || !data) throw new CreateMapServiceError(error?.code ?? 'load_failed', error?.message);
      const parsedPlan = MapPlanSchema.safeParse(data.plan);
      const parsedScene = MapSceneSchema.safeParse(data.scene);
      if (!parsedPlan.success || !parsedScene.success) {
        throw new CreateMapServiceError('invalid_saved_map', 'Saved map Plan or Scene is invalid');
      }
      return {
        identity: {
          mapId,
          revisionId: map.current_revision_id as string,
          revisionNumber: Number(data.revision_number),
          saveVersion: Number(data.save_version),
        },
        plan: parsedPlan.data,
        scene: parsedScene.data,
      };
    },

    async publish(identity: MapDraftIdentity) {
      const { data, error } = await supabase.rpc('publish_map_revision', {
        p_map_id: identity.mapId,
        p_draft_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'publish_failed', error.message);
      return firstRow<{ status: string; published_revision_id: string; next_draft_revision_id: string }>(data);
    },

    async publishV2(identity: MapDraftIdentity) {
      const { data, error } = await supabase.rpc('publish_map_revision_v2', {
        p_map_id: identity.mapId,
        p_draft_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'publish_failed', error.message);
      const row = firstRow<{ status: string; published_revision_id: string | null; next_draft_revision_id: string | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (row.status !== 'published' || !row.published_revision_id || !row.next_draft_revision_id) {
        throw new CreateMapServiceError('invalid_response');
      }
      return row as { status: 'published'; published_revision_id: string; next_draft_revision_id: string };
    },

    async publishV3(identity: MapDraftIdentity) {
      const { data, error } = await supabase.rpc('publish_map_revision_v3', {
        p_map_id: identity.mapId,
        p_draft_revision_id: identity.revisionId,
        p_expected_save_version: identity.saveVersion,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'publish_failed', error.message);
      const row = firstRow<{ status: string; published_revision_id: string | null; next_draft_revision_id: string | null }>(data);
      if (row.status === 'conflict') throw new CreateMapServiceError('save_conflict');
      if (row.status !== 'published' || !row.published_revision_id || !row.next_draft_revision_id) {
        throw new CreateMapServiceError('invalid_response');
      }
      return row as { status: 'published'; published_revision_id: string; next_draft_revision_id: string };
    },

    async readAssetPlan(assetId: string): Promise<MapAssetRecord> {
      const { data, error } = await supabase.from('map_assets').select('*').eq('id', assetId).single();
      if (error || !data) throw new CreateMapServiceError(error?.code ?? 'asset_load_failed', error?.message);
      return data as unknown as MapAssetRecord;
    },

    async listAssets(revisionId: string): Promise<MapAssetRecord[]> {
      return listMapAssets(supabase, revisionId);
    },

    async createSignedAssetUrl(storagePath: string): Promise<string> {
      const { data, error } = await supabase.storage.from('map-assets').createSignedUrl(storagePath, 300);
      if (error || !data?.signedUrl) throw new CreateMapServiceError(error?.message ?? 'asset_url_failed', error?.message);
      return data.signedUrl;
    },

    async createAssetPlan(input: Record<string, unknown>) {
      const { data, error } = await supabase.rpc('create_map_asset_plan', input);
      if (error) throw new CreateMapServiceError(error.code ?? 'asset_plan_failed', error.message);
      return firstRow<{ asset_id: string; status: string }>(data);
    },

    async createAssetPlanV2(input: CreateMapAssetPlanV2Input) {
      const { data, error } = await supabase.rpc('create_map_asset_plan_v2', {
        p_revision_id: input.revisionId,
        p_generation_id: input.generationId,
        p_asset_key: input.assetKey,
        p_kind: input.kind,
        p_prompt: input.prompt,
        p_requested_capability: input.requestedCapability,
        p_generation_params: input.generationParams,
        p_reference_asset_ids: input.referenceAssetIds,
        p_reference_hashes: input.referenceHashes,
        p_plan_fingerprint: input.planFingerprint,
        p_metadata: input.metadata,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'asset_plan_failed', error.message);
      return firstRow<{ asset_id: string; status: string }>(data);
    },

    async createAssetPlanV3(revisionId: string, generationId: string, planFingerprint: string) {
      const { data, error } = await supabase.rpc('create_map_asset_plan_v3', {
        p_revision_id: revisionId,
        p_generation_id: generationId,
        p_plan_fingerprint: planFingerprint,
      });
      if (error) throw new CreateMapServiceError(error.code ?? 'asset_plan_failed', error.message);
      return firstRow<{ asset_id: string; status: string }>(data);
    },

    async invokePixelLab(body: Record<string, unknown>) {
      const { data, error } = await supabase.functions.invoke('pixellab-map', { body });
      if (error) throw await pixelLabFunctionError(error);
      return data;
    },
  };
}
