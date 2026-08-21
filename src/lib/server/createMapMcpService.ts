import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  type MapPlanV3,
  type MapSceneV3,
} from '@/features/create-map/model/directMapSchema';
import {
  createMapService,
  type MapAssetRecord,
  type MapDraftIdentity,
  type SavedMapSummary,
  type SavedMapWorkspaceV3,
} from '@/features/create-map/services/createMapService';
import { fingerprintMapPlanV3 } from '@/lib/gdd-generation/maps/plan';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { readCreateMapDocumentSource } from './createMapDocumentSource';
import { createMapPlanV3, type DirectMapReferenceSelection } from './createMapPlanner';
import {
  signMapGenerationConfirmation,
  verifyMapGenerationConfirmation,
  type MapGenerationConfirmationBinding,
} from './createMapGenerationConfirmation';

type ProjectRole = 'admin' | 'editor' | 'viewer';
type ProviderOperation = 'submit' | 'retry' | 'poll' | 'validate' | 'resolve_unknown';
type GenerationStatus = MapAssetRecord['status'];

export type CreateMapDraftInput = {
  projectId: string;
  description: string;
  documentId: string | null;
  referenceIds: string[];
  styleReferenceId: string | null;
  referenceRoles: Record<string, 'content' | 'layout'>;
  referenceUsage: Record<string, string>;
  styleCopy: Array<'color_palette' | 'outline' | 'detail' | 'shading'>;
  idempotencyKey: string;
};

export type PublicMapGenerationAsset = {
  id: string;
  status: GenerationStatus;
  generationId: string;
  planFingerprint: string;
  lastErrorCode: string | null;
  providerJobId: string | null;
  storagePath: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  hasTransparency: boolean | null;
  imageUrl: string | null;
};

export type PublicMapWorkspace = {
  projectId: string;
  identity: MapDraftIdentity;
  plan: MapPlanV3;
  scene: MapSceneV3;
  sourceDocumentId: string | null;
  generation: PublicMapGenerationAsset | null;
};

export type MapGenerationState = {
  projectId: string;
  mapId: string;
  revisionId: string;
  saveVersion: number;
  plan: MapPlanV3;
  asset: PublicMapGenerationAsset;
};

export type CreateMapMcpBackend = {
  getProjectRole(projectId: string, userId: string): Promise<ProjectRole>;
  listMaps(projectId?: string): Promise<SavedMapSummary[]>;
  readMap(mapId: string): Promise<PublicMapWorkspace>;
  createDraft(input: CreateMapDraftInput): Promise<PublicMapWorkspace>;
  updateDraft(input: {
    projectId: string;
    mapId: string;
    revisionId: string;
    saveVersion: number;
    plan: MapPlanV3;
    scene: MapSceneV3;
  }): Promise<number>;
  freezeDraft(input: {
    mapId: string;
    revisionId: string;
    saveVersion: number;
  }): Promise<{ publishedRevisionId: string; nextDraftRevisionId: string }>;
  createAssetPlan(input: {
    revisionId: string;
    generationId: string;
    planFingerprint: string;
  }): Promise<{ assetId: string; status: GenerationStatus }>;
  findGeneration(input: {
    projectId: string;
    mapId: string;
    revisionId: string;
  }): Promise<MapGenerationState | null>;
  readGeneration(input: {
    projectId: string;
    mapId: string;
    revisionId: string;
    assetId: string;
  }): Promise<MapGenerationState>;
  invokeProvider(
    operation: ProviderOperation,
    input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      assetId: string;
      generationId: string;
      planFingerprint: string;
      acknowledgeDuplicateBilling?: boolean;
    },
  ): Promise<unknown>;
};

export type CreateMapMcpErrorCode =
  | 'PROJECT_WRITE_FORBIDDEN'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MAP_NOT_FOUND'
  | 'MAP_REVISION_STALE'
  | 'MAP_CONFIRMATION_REQUIRED'
  | 'MAP_CONFIRMATION_EXPIRED'
  | 'MAP_CONFIRMATION_MISMATCH'
  | 'MAP_GENERATION_BLOCKED'
  | 'MAP_GENERATION_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'FIELD_VALIDATION_FAILED'
  | 'UPSTREAM_UNAVAILABLE';

const PUBLIC_MESSAGES: Record<CreateMapMcpErrorCode, string> = {
  PROJECT_WRITE_FORBIDDEN: 'This project requires admin or editor access.',
  IDEMPOTENCY_CONFLICT: 'The idempotency key was already used with different map input.',
  MAP_NOT_FOUND: 'The requested V3 map was not found.',
  MAP_REVISION_STALE: 'The map revision or save version is stale.',
  MAP_CONFIRMATION_REQUIRED: 'Explicit paid map generation confirmation is required.',
  MAP_CONFIRMATION_EXPIRED: 'The map generation confirmation has expired.',
  MAP_CONFIRMATION_MISMATCH: 'The map generation confirmation does not match the current map state.',
  MAP_GENERATION_BLOCKED: 'Map generation is blocked and cannot be retried safely.',
  MAP_GENERATION_FAILED: 'Map generation failed.',
  PROVIDER_RATE_LIMITED: 'The map provider is temporarily rate limited.',
  PROVIDER_QUOTA_EXCEEDED: 'The map provider quota is exhausted.',
  FIELD_VALIDATION_FAILED: 'The Create Map request is invalid.',
  UPSTREAM_UNAVAILABLE: 'The Create Map service is temporarily unavailable.',
};

export class CreateMapMcpError extends Error {
  constructor(readonly code: CreateMapMcpErrorCode, message = PUBLIC_MESSAGES[code]) {
    super(message);
    this.name = 'CreateMapMcpError';
  }
}

type Dependencies = {
  backend?: CreateMapMcpBackend;
  fingerprintPlan?: (plan: MapPlanV3) => string;
  randomUUID?: () => string;
  signConfirmation?: (binding: MapGenerationConfirmationBinding) => string;
  verifyConfirmation?: (
    token: string,
    binding: MapGenerationConfirmationBinding,
  ) => unknown;
  now?: () => number;
};

const FEE_NOTICE = 'PixelLab map generation is a paid operation and may consume provider credits. Confirm only after reviewing this exact map plan.';
const SAFE_RETRY_BLOCKS = new Set(['pixellab_rate_limited', 'pixellab_quota_exceeded']);

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

function inputHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function firstRow<T>(value: unknown): T {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') throw new CreateMapMcpError('UPSTREAM_UNAVAILABLE');
  return row as T;
}

function publicAsset(record: MapAssetRecord, imageUrl: string | null): PublicMapGenerationAsset {
  if (
    typeof record.generation_id !== 'string'
    || typeof record.plan_fingerprint !== 'string'
  ) throw new CreateMapMcpError('MAP_GENERATION_FAILED');
  return {
    id: record.id,
    status: record.status,
    generationId: record.generation_id,
    planFingerprint: record.plan_fingerprint,
    lastErrorCode: record.last_error_code,
    providerJobId: record.provider_job_id ?? null,
    storagePath: record.storage_path,
    sha256: record.sha256,
    width: record.width,
    height: record.height,
    hasTransparency: record.has_transparency,
    imageUrl,
  };
}

function publicWorkspace(workspace: SavedMapWorkspaceV3): PublicMapWorkspace {
  return {
    projectId: workspace.projectId,
    identity: workspace.identity,
    plan: workspace.plan,
    scene: workspace.scene,
    sourceDocumentId: workspace.sourceDocumentId,
    generation: workspace.imageAsset
      ? publicAsset(workspace.imageAsset, workspace.imageUrl)
      : null,
  };
}

function assertProject(actual: string, expected: string): void {
  if (actual !== expected) throw new CreateMapMcpError('MAP_NOT_FOUND');
}

function assertWriter(role: ProjectRole): void {
  if (role === 'viewer') throw new CreateMapMcpError('PROJECT_WRITE_FORBIDDEN');
}

function assertGenerationIdentity(
  state: MapGenerationState,
  input: {
    projectId: string;
    mapId: string;
    revisionId: string;
    assetId: string;
    generationId: string;
    planFingerprint: string;
  },
  fingerprintPlan: (plan: MapPlanV3) => string,
): void {
  if (
    state.projectId !== input.projectId
    || state.mapId !== input.mapId
    || state.revisionId !== input.revisionId
    || state.asset.id !== input.assetId
    || state.asset.generationId !== input.generationId
    || state.asset.planFingerprint !== input.planFingerprint
    || fingerprintPlan(state.plan) !== input.planFingerprint
  ) throw new CreateMapMcpError('MAP_CONFIRMATION_MISMATCH');
}

function providerInput(state: MapGenerationState) {
  return {
    projectId: state.projectId,
    mapId: state.mapId,
    revisionId: state.revisionId,
    assetId: state.asset.id,
    generationId: state.asset.generationId,
    planFingerprint: state.asset.planFingerprint,
  };
}

function generationResult(asset: PublicMapGenerationAsset) {
  const { id, ...rest } = asset;
  return { assetId: id, ...rest };
}

function confirmationBinding(
  userId: string,
  state: MapGenerationState,
  purpose: MapGenerationConfirmationBinding['purpose'] = 'submit',
): MapGenerationConfirmationBinding {
  return {
    purpose,
    userId,
    projectId: state.projectId,
    mapId: state.mapId,
    revisionId: state.revisionId,
    assetId: state.asset.id,
    generationId: state.asset.generationId,
    planFingerprint: state.asset.planFingerprint,
  };
}

function mapProviderError(error: unknown): never {
  if (error instanceof CreateMapMcpError) throw error;
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (code === 'MAP_CONFIRMATION_EXPIRED') throw new CreateMapMcpError('MAP_CONFIRMATION_EXPIRED');
  if (code === 'MAP_CONFIRMATION_MISMATCH') throw new CreateMapMcpError('MAP_CONFIRMATION_MISMATCH');
  if (code === 'pixellab_rate_limited') throw new CreateMapMcpError('PROVIDER_RATE_LIMITED');
  if (code === 'pixellab_quota_exceeded') throw new CreateMapMcpError('PROVIDER_QUOTA_EXCEEDED');
  if (code === 'KM409') throw new CreateMapMcpError('IDEMPOTENCY_CONFLICT');
  if (code === '42501') throw new CreateMapMcpError('PROJECT_WRITE_FORBIDDEN');
  if (code === 'save_conflict') throw new CreateMapMcpError('MAP_REVISION_STALE');
  throw new CreateMapMcpError('UPSTREAM_UNAVAILABLE');
}

async function loadReferenceSelection(
  supabase: SupabaseClient,
  input: CreateMapDraftInput,
): Promise<DirectMapReferenceSelection> {
  const ids = [...input.referenceIds, ...(input.styleReferenceId ? [input.styleReferenceId] : [])];
  if (new Set(ids).size !== ids.length) throw new CreateMapMcpError('FIELD_VALIDATION_FAILED');
  if (ids.length === 0) return { references: [], styleReference: null };
  const { data, error } = await supabase.from('map_reference_images')
    .select('id,project_id,sha256')
    .eq('project_id', input.projectId)
    .in('id', ids);
  if (error || !Array.isArray(data) || data.length !== ids.length) {
    throw new CreateMapMcpError('FIELD_VALIDATION_FAILED');
  }
  const byId = new Map(data.map((row) => [String(row.id), row]));
  if (byId.size !== ids.length) throw new CreateMapMcpError('FIELD_VALIDATION_FAILED');
  return {
    references: input.referenceIds.map((assetId) => {
      const row = byId.get(assetId);
      const role = input.referenceRoles[assetId];
      const usage = input.referenceUsage[assetId];
      if (!row || row.project_id !== input.projectId || !role || !usage) {
        throw new CreateMapMcpError('FIELD_VALIDATION_FAILED');
      }
      return { assetId, sha256: String(row.sha256), role, usage };
    }),
    styleReference: input.styleReferenceId
      ? (() => {
          const row = byId.get(input.styleReferenceId!);
          if (!row || row.project_id !== input.projectId || input.styleCopy.length === 0) {
            throw new CreateMapMcpError('FIELD_VALIDATION_FAILED');
          }
          return {
            assetId: input.styleReferenceId!,
            sha256: String(row.sha256),
            copy: input.styleCopy,
          };
        })()
      : null,
  };
}

function defaultBackend(
  supabase: SupabaseClient,
  userId: string,
): CreateMapMcpBackend {
  const maps = createMapService(supabase);

  const findGeneration = async (input: {
    projectId: string;
    mapId: string;
    revisionId: string;
  }): Promise<MapGenerationState | null> => {
    const { data: map, error: mapError } = await supabase.from('map_projects')
      .select('project_id').eq('id', input.mapId).single();
    if (mapError || map?.project_id !== input.projectId) return null;
    const { data: revision, error: revisionError } = await supabase.from('map_revisions')
      .select('id,map_project_id,save_version,schema_version,plan')
      .eq('id', input.revisionId)
      .eq('map_project_id', input.mapId)
      .eq('schema_version', 3)
      .single();
    if (revisionError || !revision) return null;
    const parsedPlan = validateMapPlanV3(revision.plan);
    if (parsedPlan.success === false) throw new CreateMapMcpError('MAP_GENERATION_FAILED');
    const { data: assets, error: assetError } = await supabase.from('map_assets')
      .select('*')
      .eq('map_revision_id', input.revisionId)
      .eq('asset_key', 'map-image')
      .eq('kind', 'map_image')
      .limit(2);
    if (assetError) throw new CreateMapMcpError('UPSTREAM_UNAVAILABLE');
    if (!Array.isArray(assets) || assets.length === 0) return null;
    if (assets.length !== 1) throw new CreateMapMcpError('MAP_GENERATION_FAILED');
    const record = assets[0] as unknown as MapAssetRecord;
    let imageUrl: string | null = null;
    if (record.status === 'ready' && record.storage_path) {
      const signed = await supabase.storage.from('map-assets').createSignedUrl(record.storage_path, 300);
      imageUrl = signed.error ? null : signed.data?.signedUrl ?? null;
    }
    return {
      projectId: input.projectId,
      mapId: input.mapId,
      revisionId: input.revisionId,
      saveVersion: Number(revision.save_version),
      plan: parsedPlan.data,
      asset: publicAsset(record, imageUrl),
    };
  };

  return {
    async getProjectRole(projectId, actorId) {
      return (await getUserProjectRole(supabase, projectId, actorId)).role;
    },
    async listMaps(projectId) {
      const items = await maps.listSavedMaps();
      return projectId ? items.filter((item) => item.projectId === projectId) : items;
    },
    async readMap(mapId) {
      return publicWorkspace(await maps.loadSavedMapV3(mapId));
    },
    async createDraft(input) {
      const source = input.documentId
        ? await readCreateMapDocumentSource(supabase, userId, input.projectId, input.documentId)
        : undefined;
      const plan = await createMapPlanV3(
        input.description,
        source,
        await loadReferenceSelection(supabase, input),
      );
      const scene = createEmptyMapSceneV3(plan);
      const sourceToken = source
        ? {
            documentId: source.documentId,
            documentUpdatedAt: source.documentUpdatedAt,
            epoch: source.token.epoch,
            revision: source.token.revision,
          }
        : null;
      const hash = inputHash({
        projectId: input.projectId,
        name: plan.name,
        source: sourceToken,
        plan,
        scene,
      });
      const { data, error } = await supabase.rpc('create_map_project_v3_idempotent', {
        p_project_id: input.projectId,
        p_idempotency_key: input.idempotencyKey,
        p_input_hash: hash,
        p_name: plan.name,
        p_source_document_id: sourceToken?.documentId ?? null,
        p_source_document_updated_at: sourceToken?.documentUpdatedAt ?? null,
        p_source_epoch: sourceToken?.epoch ?? null,
        p_source_revision: sourceToken?.revision ?? null,
        p_plan: plan,
        p_scene: scene,
      });
      if (error) mapProviderError(error);
      const row = firstRow<{
        map_id: string;
        draft_revision_id: string;
        revision_number: number;
        save_version: number;
      }>(data);
      return {
        projectId: input.projectId,
        identity: {
          mapId: row.map_id,
          revisionId: row.draft_revision_id,
          revisionNumber: row.revision_number,
          saveVersion: row.save_version,
        },
        plan,
        scene,
        sourceDocumentId: sourceToken?.documentId ?? null,
        generation: null,
      };
    },
    async updateDraft(input) {
      return maps.saveDraftV3({
        mapId: input.mapId,
        revisionId: input.revisionId,
        revisionNumber: 0,
        saveVersion: input.saveVersion,
      }, input.plan, input.scene);
    },
    async freezeDraft(input) {
      const row = await maps.publishV3({
        mapId: input.mapId,
        revisionId: input.revisionId,
        revisionNumber: 0,
        saveVersion: input.saveVersion,
      });
      return {
        publishedRevisionId: row.published_revision_id,
        nextDraftRevisionId: row.next_draft_revision_id,
      };
    },
    async createAssetPlan(input) {
      const row = await maps.createAssetPlanV3(
        input.revisionId,
        input.generationId,
        input.planFingerprint,
      );
      return { assetId: row.asset_id, status: row.status as GenerationStatus };
    },
    findGeneration,
    async readGeneration(input) {
      const state = await findGeneration(input);
      if (!state || state.asset.id !== input.assetId) throw new CreateMapMcpError('MAP_NOT_FOUND');
      return state;
    },
    async invokeProvider(operation, input) {
      return maps.invokePixelLab({ operation, ...input });
    },
  };
}

export function createMapMcpService(
  context: { userId: string; supabase: SupabaseClient },
  dependencies: Dependencies = {},
) {
  const backend = dependencies.backend ?? defaultBackend(context.supabase, context.userId);
  const fingerprintPlan = dependencies.fingerprintPlan ?? fingerprintMapPlanV3;
  const makeUuid = dependencies.randomUUID ?? randomUUID;
  const sign = dependencies.signConfirmation ?? signMapGenerationConfirmation;
  const verify = dependencies.verifyConfirmation ?? verifyMapGenerationConfirmation;
  const now = dependencies.now ?? Date.now;

  const requireWriter = async (projectId: string) => {
    assertWriter(await backend.getProjectRole(projectId, context.userId));
  };

  const prepareResponse = (
    state: MapGenerationState,
    nextDraftRevisionId: string | null,
    purpose: MapGenerationConfirmationBinding['purpose'] = 'submit',
  ) => ({
    mapId: state.mapId,
    revisionId: state.revisionId,
    nextDraftRevisionId,
    assetId: state.asset.id,
    status: state.asset.status,
    generationId: state.asset.generationId,
    planFingerprint: state.asset.planFingerprint,
    feeNotice: FEE_NOTICE,
    confirmationPurpose: purpose,
    confirmationExpiresAt: new Date(now() + 10 * 60 * 1000).toISOString(),
    confirmationToken: sign(confirmationBinding(context.userId, state, purpose)),
  });

  const verifyForPurpose = (
    token: string,
    state: MapGenerationState,
    purpose: MapGenerationConfirmationBinding['purpose'],
  ) => verify(token, confirmationBinding(context.userId, state, purpose));

  const verifyReplay = (token: string, state: MapGenerationState) => {
    try {
      return verifyForPurpose(token, state, 'submit');
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
      if (code !== 'MAP_CONFIRMATION_MISMATCH') throw error;
      return verifyForPurpose(token, state, 'replace-unknown');
    }
  };

  return {
    async listMaps(input: { projectId?: string }) {
      try {
        const items = await backend.listMaps(input.projectId);
        return { items, returnedCount: items.length };
      } catch (error) {
        mapProviderError(error);
      }
    },

    async readMap(input: { projectId?: string; mapId: string }) {
      try {
        const workspace = await backend.readMap(input.mapId);
        if (input.projectId) assertProject(workspace.projectId, input.projectId);
        return { ...workspace, schemaVersion: 3 as const };
      } catch (error) {
        mapProviderError(error);
      }
    },

    async createDraft(input: CreateMapDraftInput) {
      try {
        await requireWriter(input.projectId);
        const workspace = await backend.createDraft(input);
        assertProject(workspace.projectId, input.projectId);
        return {
          ...workspace.identity,
          projectId: workspace.projectId,
          schemaVersion: 3 as const,
          plan: workspace.plan,
          scene: workspace.scene,
          sourceDocumentId: workspace.sourceDocumentId,
        };
      } catch (error) {
        mapProviderError(error);
      }
    },

    async updateDraft(input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      saveVersion: number;
      plan: MapPlanV3;
      scene: MapSceneV3;
    }) {
      try {
        await requireWriter(input.projectId);
        const workspace = await backend.readMap(input.mapId);
        assertProject(workspace.projectId, input.projectId);
        if (workspace.identity.revisionId !== input.revisionId) {
          throw new CreateMapMcpError('MAP_REVISION_STALE');
        }
        const saveVersion = await backend.updateDraft(input);
        return { mapId: input.mapId, revisionId: input.revisionId, saveVersion };
      } catch (error) {
        mapProviderError(error);
      }
    },

    async prepareGeneration(input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      saveVersion: number;
    }) {
      try {
        await requireWriter(input.projectId);
        const existing = await backend.findGeneration(input);
        if (existing) {
          if (
            existing.saveVersion !== input.saveVersion
            || existing.asset.planFingerprint !== fingerprintPlan(existing.plan)
          ) throw new CreateMapMcpError('MAP_REVISION_STALE');
          if (existing.asset.status === 'planned') return prepareResponse(existing, null);
          if (
            existing.asset.status === 'blocked'
            && existing.asset.lastErrorCode === 'pixellab_submit_outcome_unknown'
          ) return prepareResponse(existing, null, 'replace-unknown');
          throw new CreateMapMcpError('MAP_REVISION_STALE');
        }
        const workspace = await backend.readMap(input.mapId);
        assertProject(workspace.projectId, input.projectId);
        if (
          workspace.identity.revisionId !== input.revisionId
          || workspace.identity.saveVersion !== input.saveVersion
        ) throw new CreateMapMcpError('MAP_REVISION_STALE');
        const planFingerprint = fingerprintPlan(workspace.plan);
        const frozen = await backend.freezeDraft(input);
        if (frozen.publishedRevisionId !== input.revisionId) {
          throw new CreateMapMcpError('MAP_REVISION_STALE');
        }
        const generationId = makeUuid();
        const created = await backend.createAssetPlan({
          revisionId: input.revisionId,
          generationId,
          planFingerprint,
        });
        const state = await backend.readGeneration({
          projectId: input.projectId,
          mapId: input.mapId,
          revisionId: input.revisionId,
          assetId: created.assetId,
        });
        assertGenerationIdentity(state, {
          ...input,
          assetId: created.assetId,
          generationId,
          planFingerprint,
        }, fingerprintPlan);
        if (state.asset.status !== 'planned') throw new CreateMapMcpError('MAP_GENERATION_BLOCKED');
        return prepareResponse(state, frozen.nextDraftRevisionId);
      } catch (error) {
        mapProviderError(error);
      }
    },

    async startGeneration(input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      assetId: string;
      generationId: string;
      planFingerprint: string;
      confirmationToken: string;
      confirmPaidGeneration: true;
    }) {
      try {
        if (input.confirmPaidGeneration !== true || !input.confirmationToken) {
          throw new CreateMapMcpError('MAP_CONFIRMATION_REQUIRED');
        }
        await requireWriter(input.projectId);
        const state = await backend.readGeneration(input);
        assertGenerationIdentity(state, input, fingerprintPlan);
        if (state.asset.status === 'planned') {
          verifyForPurpose(input.confirmationToken, state, 'submit');
          await backend.invokeProvider('submit', providerInput(state));
          return generationResult((await backend.readGeneration(input)).asset);
        }
        if (
          state.asset.status === 'blocked'
          && state.asset.lastErrorCode === 'pixellab_submit_outcome_unknown'
        ) {
          verifyForPurpose(input.confirmationToken, state, 'replace-unknown');
          await backend.invokeProvider('retry', {
            ...providerInput(state),
            acknowledgeDuplicateBilling: true,
          });
          return generationResult((await backend.readGeneration(input)).asset);
        }
        if (state.asset.status === 'queued' || state.asset.status === 'generating' || state.asset.status === 'ready') {
          verifyReplay(input.confirmationToken, state);
          return generationResult(state.asset);
        }
        throw new CreateMapMcpError('MAP_GENERATION_BLOCKED');
      } catch (error) {
        mapProviderError(error);
      }
    },

    async getGeneration(input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      assetId: string;
      generationId: string;
      planFingerprint: string;
    }) {
      try {
        let state = await backend.readGeneration(input);
        assertGenerationIdentity(state, input, fingerprintPlan);
        if (state.asset.status === 'generating') {
          const result = await backend.invokeProvider('poll', providerInput(state));
          if (result && typeof result === 'object' && (result as { status?: unknown }).status === 'completed') {
            await backend.invokeProvider('validate', providerInput(state));
          }
          state = await backend.readGeneration(input);
        }
        return generationResult(state.asset);
      } catch (error) {
        mapProviderError(error);
      }
    },

    async retryGeneration(input: {
      projectId: string;
      mapId: string;
      revisionId: string;
      assetId: string;
      generationId: string;
      planFingerprint: string;
    }) {
      try {
        await requireWriter(input.projectId);
        const state = await backend.readGeneration(input);
        assertGenerationIdentity(state, input, fingerprintPlan);
        const safe = (state.asset.status === 'failed' && Boolean(state.asset.providerJobId))
          || (state.asset.status === 'blocked'
            && state.asset.lastErrorCode !== null
            && SAFE_RETRY_BLOCKS.has(state.asset.lastErrorCode));
        if (!safe) throw new CreateMapMcpError('MAP_GENERATION_BLOCKED');
        await backend.invokeProvider('retry', providerInput(state));
        return generationResult((await backend.readGeneration(input)).asset);
      } catch (error) {
        mapProviderError(error);
      }
    },
  };
}
