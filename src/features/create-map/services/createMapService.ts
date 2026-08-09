import type { SupabaseClient } from '@supabase/supabase-js';
import { listDocuments } from '@/lib/services/documentService';
import { listProjects } from '@/lib/services/projectService';
import { MapPlanSchema, type MapPlan } from '../model/mapPlanSchema';
import { MapSceneSchema, type MapScene } from '../model/mapSceneSchema';

export type MapSourceToken = {
  documentId: string;
  documentUpdatedAt: string;
  epoch: number;
  revision: number;
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
  kind: 'terrain' | 'road' | 'object' | 'inpaint';
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
};

export type SavedMapSummary = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  currentRevisionId: string;
  updatedAt: string;
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

function projectName(value: unknown): string {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === 'object' && typeof (relation as { name?: unknown }).name === 'string'
    ? (relation as { name: string }).name
    : 'Unknown project';
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
        .select('id, project_id, name, current_revision_id, updated_at, projects!map_projects_project_id_fkey(name)')
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw new CreateMapServiceError(error.code ?? 'map_list_failed', error.message);
      return (data ?? []).flatMap((row) => {
        if (!row.current_revision_id) return [];
        return [{
          id: String(row.id), projectId: String(row.project_id), projectName: projectName(row.projects),
          name: String(row.name), currentRevisionId: String(row.current_revision_id),
          updatedAt: String(row.updated_at),
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

    async createPlan(projectId: string, documentId: string): Promise<{ plan: MapPlan; sourceToken: MapSourceToken }> {
      const payload = await responseJson(await fetch('/api/create-map/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, documentId }),
      }));
      return payload as unknown as { plan: MapPlan; sourceToken: MapSourceToken };
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

    async invokePixelLab(body: Record<string, unknown>) {
      const { data, error } = await supabase.functions.invoke('pixellab-map', { body });
      if (error) throw new CreateMapServiceError('pixellab_function_error', error.message);
      return data;
    },
  };
}
