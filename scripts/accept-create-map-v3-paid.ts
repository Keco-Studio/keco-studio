import { createHash } from 'node:crypto';
import process from 'node:process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import sharp from 'sharp';
import {
  createEmptyMapSceneV3,
  validateMapPlanV3,
  validateMapSceneV3,
  type MapPlanV3,
  type MapSceneV3,
} from '../src/features/create-map/model/directMapSchema';

dotenv.config({ path: '.env.local', override: false, quiet: true });

const EMAIL = process.env.KECO_ACCEPTANCE_EMAIL ?? '';
const PASSWORD = process.env.KECO_ACCEPTANCE_PASSWORD ?? '';
const REQUESTED_MAP_ID = process.env.KECO_ACCEPTANCE_V3_MAP_ID ?? '';
const REQUESTED_REVISION_ID = process.env.KECO_ACCEPTANCE_V3_REVISION_ID ?? '';
const CREATE_V3 = process.env.KECO_ACCEPTANCE_CREATE_V3 === 'true';
const CONFIRM_PAID = process.env.KECO_ACCEPTANCE_CONFIRM_PAID === 'true';
const PROJECT_ID = process.env.KECO_ACCEPTANCE_PROJECT_ID ?? '';
const APP_URL = (process.env.KECO_ACCEPTANCE_APP_URL ?? '').trim();
const POLL_INTERVAL_MS = Number(process.env.KECO_ACCEPTANCE_POLL_MS ?? 5_000);
const MAX_POLL_CYCLES = Number(process.env.KECO_ACCEPTANCE_MAX_POLLS ?? 180);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

type JsonRecord = Record<string, unknown>;

type MapRow = {
  id: string;
  project_id: string;
  name: string;
  current_revision_id: string;
  projects: { owner_id: string };
};

type RevisionRow = {
  id: string;
  map_project_id: string;
  revision_number: number;
  save_version: number;
  schema_version: number;
  status: 'draft' | 'generating' | 'ready' | 'failed' | 'partial';
  plan: unknown;
  scene: unknown;
};

type AssetRow = {
  id: string;
  map_revision_id: string;
  generation_id: string | null;
  plan_fingerprint: string | null;
  asset_key: string;
  kind: string;
  status: 'planned' | 'queued' | 'generating' | 'ready' | 'failed' | 'blocked';
  requested_capability: string | null;
  provider_operation: string | null;
  provider_job_id: string | null;
  prompt: string;
  generation_params: JsonRecord;
  reference_asset_ids: string[];
  reference_hashes: string[];
  metadata: JsonRecord;
  storage_path: string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  has_transparency: boolean | null;
  last_error_code: string | null;
  attempt_count: number;
};

class AcceptanceError extends Error {
  constructor(readonly code: string, message = code) {
    super(message);
    this.name = 'AcceptanceError';
  }
}

function log(event: string, details: JsonRecord = {}): void {
  process.stdout.write(`${JSON.stringify({ event, ...details })}\n`);
}

function firstRow<T>(value: unknown, code: string): T {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') throw new AcceptanceError(code);
  return row as T;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function planFingerprint(plan: MapPlanV3): string {
  return createHash('sha256').update(canonical(plan)).digest('hex');
}

function assertDurableJsonSafe(value: unknown): void {
  const visit = (entry: unknown, key = ''): void => {
    if (/authorization|credential|password|token|secret|signed.?url|temporary.?url|provider.?(?:body|response)|base64/i.test(key)) {
      throw new AcceptanceError('durable_metadata_sensitive_key');
    }
    if (typeof entry === 'string' && (
      /https?:\/\/|bearer\s+|data:image\//i.test(entry)
      || /^[A-Za-z0-9+/]{256,}={0,2}$/.test(entry)
    )) {
      throw new AcceptanceError('durable_metadata_sensitive_value');
    }
    if (Array.isArray(entry)) entry.forEach((item) => visit(item, key));
    else if (entry && typeof entry === 'object') {
      Object.entries(entry as JsonRecord).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value);
}

async function callCreateMapApi(
  body: JsonRecord,
  accessToken: string,
): Promise<JsonRecord> {
  let app: URL;
  try {
    app = new URL(APP_URL);
  } catch {
    throw new AcceptanceError('acceptance_app_url_invalid');
  }
  const localHttp = app.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname);
  if ((app.protocol !== 'https:' && !localHttp) || app.username || app.password) {
    throw new AcceptanceError('acceptance_app_url_invalid');
  }
  const response = await fetch(new URL('/api/mcp/create-map', app), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok || !payload) {
    throw new AcceptanceError(
      typeof payload?.code === 'string' ? payload.code : 'create_map_api_error',
      typeof payload?.error === 'string' ? payload.error : `Create Map API returned HTTP ${response.status}`,
    );
  }
  return payload;
}

async function readRevision(supabase: SupabaseClient, revisionId: string): Promise<RevisionRow> {
  const { data, error } = await supabase.from('map_revisions')
    .select('id,map_project_id,revision_number,save_version,schema_version,status,plan,scene')
    .eq('id', revisionId).eq('schema_version', 3).single();
  if (error || !data) throw new AcceptanceError(error?.code ?? 'approved_v3_revision_not_found');
  return data as RevisionRow;
}

async function listAssets(supabase: SupabaseClient, revisionId: string): Promise<AssetRow[]> {
  const { data, error } = await supabase.from('map_assets').select('*')
    .eq('map_revision_id', revisionId).order('asset_key');
  if (error) throw new AcceptanceError(error.code ?? 'asset_read_failed', error.message);
  return (data ?? []) as AssetRow[];
}

async function authenticate(supabaseUrl: string, anonKey: string) {
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  if (!EMAIL) throw new AcceptanceError('acceptance_email_required');
  if (PASSWORD) {
    const result = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    return { supabase, ...result };
  }
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!serviceRoleKey) throw new AcceptanceError('acceptance_credentials_required');
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) throw new AcceptanceError('acceptance_session_link_failed');
  const result = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  return { supabase, ...result };
}

async function main(): Promise<void> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!supabaseUrl || !anonKey || !APP_URL) throw new AcceptanceError('acceptance_environment_not_configured');
  if (Boolean(REQUESTED_MAP_ID) !== Boolean(REQUESTED_REVISION_ID)) {
    throw new AcceptanceError('authoritative_v3_map_and_revision_required');
  }

  const authenticated = await authenticate(supabaseUrl, anonKey);
  const { supabase, data: auth, error: authError } = authenticated;
  if (authError || !auth.session || !auth.user) throw new AcceptanceError('authentication_failed');
  log('authenticated', { userId: auth.user.id });

  let mapId = REQUESTED_MAP_ID;
  let approvedRevisionId = REQUESTED_REVISION_ID;
  let createdDedicatedDraft = false;
  if (!mapId && !approvedRevisionId) {
    if (!CREATE_V3 || !UUID.test(PROJECT_ID)) {
      throw new AcceptanceError('authoritative_v3_map_and_revision_required');
    }
    const candidatePlan: MapPlanV3 = {
      schemaVersion: 3,
      name: 'PixelLab direct map acceptance',
      summary: 'A dedicated V3 map used to verify the paid direct-image workflow.',
      map: { width: 512, height: 512 },
      description: 'An opaque top-down pixel art acceptance map with a river crossing, clear roads, compact buildings, varied green terrain, visible landmarks, natural lighting, and no interface text.',
      references: [],
      styleReference: null,
      generation: {
        provider: 'pixellab',
        operation: 'create_image_pro',
        noBackground: false,
        seed: 20260811,
      },
    };
    const parsedCandidate = validateMapPlanV3(candidatePlan);
    if (parsedCandidate.success === false) throw new AcceptanceError('acceptance_plan_invalid');
    const candidateScene = createEmptyMapSceneV3(parsedCandidate.data);
    const { data: createdData, error: createdError } = await supabase.rpc('create_map_project_v3', {
      p_project_id: PROJECT_ID,
      p_name: parsedCandidate.data.name,
      p_source_document_id: null,
      p_source_document_updated_at: null,
      p_source_epoch: null,
      p_source_revision: null,
      p_plan: parsedCandidate.data,
      p_scene: candidateScene,
    });
    if (createdError) throw new AcceptanceError(createdError.code ?? 'acceptance_map_create_failed', createdError.message);
    const created = firstRow<{ map_id: string; draft_revision_id: string }>(
      createdData,
      'acceptance_map_create_invalid_response',
    );
    if (!UUID.test(created.map_id) || !UUID.test(created.draft_revision_id)) {
      throw new AcceptanceError('acceptance_map_create_invalid_response');
    }
    mapId = created.map_id;
    approvedRevisionId = created.draft_revision_id;
    createdDedicatedDraft = true;
    log('authoritative_v3_draft_created', { mapId, approvedRevisionId, projectId: PROJECT_ID });
  }
  if (!UUID.test(mapId) || !UUID.test(approvedRevisionId)) {
    throw new AcceptanceError('authoritative_v3_map_and_revision_required');
  }

  const { data: mapData, error: mapError } = await supabase.from('map_projects')
    .select('id,project_id,name,current_revision_id,projects(owner_id)').eq('id', mapId).single();
  if (mapError || !mapData) throw new AcceptanceError(mapError?.code ?? 'approved_map_not_found');
  const map = mapData as unknown as MapRow;
  const { data: membership, error: membershipError } = await supabase.from('project_collaborators')
    .select('role,accepted_at').eq('project_id', map.project_id).eq('user_id', auth.user.id).maybeSingle();
  const ownerAuthorized = map.projects.owner_id === auth.user.id;
  const editorAuthorized = !membershipError && Boolean(membership?.accepted_at)
    && ['admin', 'editor'].includes(String(membership?.role));
  if (!ownerAuthorized && !editorAuthorized) {
    throw new AcceptanceError('authenticated_editor_required');
  }

  const revision = await readRevision(supabase, approvedRevisionId);
  if (revision.map_project_id !== mapId) throw new AcceptanceError('approved_revision_map_mismatch');
  const parsedPlan = validateMapPlanV3(revision.plan);
  if (parsedPlan.success === false) throw new AcceptanceError('approved_plan_invalid');
  const plan = parsedPlan.data;
  const fingerprint = planFingerprint(plan);
  let generationRevisionId = revision.id;
  let nextDraftRevisionId = String(map.current_revision_id);
  let assets = await listAssets(supabase, generationRevisionId);
  const existingAsset = assets.length === 1 ? assets[0] : null;
  const unknownBlocked = existingAsset?.status === 'blocked'
    && existingAsset.last_error_code === 'pixellab_submit_outcome_unknown';
  const shouldPrepare = revision.status === 'draft' || existingAsset?.status === 'planned' || unknownBlocked;
  let prepared: JsonRecord | null = null;
  if (shouldPrepare) {
    prepared = await callCreateMapApi({
      action: 'prepare_map_generation',
      projectId: map.project_id,
      mapId,
      revisionId: revision.id,
      saveVersion: revision.save_version,
    }, auth.session.access_token);
    if (
      typeof prepared.feeNotice !== 'string'
      || typeof prepared.confirmationToken !== 'string'
      || !UUID.test(String(prepared.revisionId))
      || !UUID.test(String(prepared.assetId))
      || !UUID.test(String(prepared.generationId))
      || !SHA256.test(String(prepared.planFingerprint))
    ) throw new AcceptanceError('map_generation_prepare_invalid');
    generationRevisionId = String(prepared.revisionId);
    if (typeof prepared.nextDraftRevisionId === 'string') {
      nextDraftRevisionId = prepared.nextDraftRevisionId;
    }
    assets = await listAssets(supabase, generationRevisionId);
    log('generation_prepared', {
      mapId,
      revisionId: generationRevisionId,
      assetId: String(prepared.assetId),
      status: String(prepared.status),
    });
  }

  if (assets.length !== 1) throw new AcceptanceError('expected_exactly_one_map_image');
  let asset = assets[0];
  if (
    asset.kind !== 'map_image' || asset.asset_key !== 'map-image'
    || asset.requested_capability !== 'direct_map_image'
    || asset.prompt !== plan.description
    || asset.plan_fingerprint !== fingerprint
    || !UUID.test(asset.generation_id ?? '')
  ) {
    throw new AcceptanceError('map_image_identity_invalid');
  }
  const identity = {
    projectId: map.project_id,
    mapId,
    revisionId: generationRevisionId,
    generationId: asset.generation_id as string,
    assetId: asset.id,
    planFingerprint: fingerprint,
  };

  let paidRequestSubmitted = false;
  const retryableBlocked = asset.status === 'blocked'
    && ['pixellab_rate_limited', 'pixellab_quota_exceeded'].includes(asset.last_error_code ?? '');
  const retryableFailed = asset.status === 'failed' && Boolean(asset.provider_job_id);
  if (
    (asset.status === 'blocked' || asset.status === 'failed')
    && !unknownBlocked
    && !retryableBlocked
    && !retryableFailed
  ) {
    throw new AcceptanceError('generation_not_safe_to_retry');
  }
  if (prepared) {
    if (!CONFIRM_PAID) {
      throw new AcceptanceError('explicit_paid_confirmation_required');
    }
    await callCreateMapApi({
      action: 'start_map_generation',
      ...identity,
      confirmationToken: prepared.confirmationToken,
      confirmPaidGeneration: true,
    }, auth.session.access_token);
    paidRequestSubmitted = true;
    assets = await listAssets(supabase, generationRevisionId);
    asset = assets[0];
  } else if (retryableFailed || retryableBlocked) {
    await callCreateMapApi({
      action: 'retry_map_generation',
      ...identity,
    }, auth.session.access_token);
    paidRequestSubmitted = true;
    assets = await listAssets(supabase, generationRevisionId);
    asset = assets[0];
  }
  if (!['queued', 'generating', 'ready'].includes(asset.status)) {
    throw new AcceptanceError(asset.last_error_code ?? `generation_not_resumable:${asset.status}`);
  }

  const terminalStatuses = ['ready', 'failed', 'blocked'];
  for (let cycle = 0; !terminalStatuses.includes(asset.status) && cycle < MAX_POLL_CYCLES; cycle += 1) {
    const polled = await callCreateMapApi({
      action: 'get_map_generation',
      ...identity,
    }, auth.session.access_token);
    assets = await listAssets(supabase, generationRevisionId);
    if (assets.length !== 1) throw new AcceptanceError('map_image_count_changed');
    asset = assets[0];
    const status = typeof polled.status === 'string' ? polled.status : asset.status;
    log('generation_polled', { cycle: cycle + 1, status });
    if (!terminalStatuses.includes(status)) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  if (asset.status !== 'ready') throw new AcceptanceError(asset.last_error_code ?? 'generation_poll_timeout');

  assertDurableJsonSafe(asset.metadata);
  assertDurableJsonSafe(asset.generation_params);
  assertDurableJsonSafe(asset.reference_asset_ids);
  assertDurableJsonSafe(asset.reference_hashes);
  const expectedStoragePath = `${map.project_id}/${mapId}/${generationRevisionId}/map-image/${asset.sha256}.png`;
  if (
    asset.provider_operation !== 'create_image_pro' || !asset.provider_job_id
    || asset.width !== plan.map.width || asset.height !== plan.map.height
    || asset.has_transparency !== false || !SHA256.test(asset.sha256 ?? '')
    || asset.storage_path !== expectedStoragePath
  ) {
    throw new AcceptanceError('ready_map_image_invalid');
  }
  const { data: stored, error: storedError } = await supabase.storage.from('map-assets').download(asset.storage_path);
  if (storedError || !stored) throw new AcceptanceError('private_storage_readback_failed');
  const bytes = Buffer.from(await stored.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  const image = sharp(bytes);
  const metadata = await image.metadata();
  if (digest !== asset.sha256 || metadata.width !== plan.map.width || metadata.height !== plan.map.height) {
    throw new AcceptanceError('private_storage_readback_mismatch');
  }
  const rgba = await sharp(bytes).ensureAlpha().raw().toBuffer();
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] !== 255) throw new AcceptanceError('private_storage_image_not_opaque');
  }
  const stats = await sharp(bytes).stats();
  if (stats.channels.slice(0, 3).every((channel) => channel.stdev < 1)) {
    throw new AcceptanceError('private_storage_image_blank');
  }

  const draft = await readRevision(supabase, nextDraftRevisionId);
  const draftPlan = validateMapPlanV3(draft.plan);
  if (draftPlan.success === false || canonical(draftPlan.data) !== canonical(plan)) {
    throw new AcceptanceError('next_draft_plan_mismatch');
  }
  const nextScene: MapSceneV3 = {
    ...(draft.scene as MapSceneV3),
    schemaVersion: 3,
    size: { ...plan.map },
    mapImage: {
      assetKey: 'map-image',
      sourceRevisionId: generationRevisionId,
      width: plan.map.width,
      height: plan.map.height,
      locked: true,
    },
  };
  const sceneValidation = validateMapSceneV3(plan, nextScene);
  if (sceneValidation.success === false) throw new AcceptanceError('materialized_scene_invalid');
  const { data: saveData, error: saveError } = await supabase.rpc('save_map_draft_v3', {
    p_map_id: mapId,
    p_revision_id: nextDraftRevisionId,
    p_expected_save_version: draft.save_version,
    p_plan: plan,
    p_scene: sceneValidation.data,
  });
  if (saveError) throw new AcceptanceError(saveError.code ?? 'scene_save_failed', saveError.message);
  const saved = firstRow<{ status: string; save_version: number }>(saveData, 'scene_save_invalid_response');
  if (saved.status !== 'saved') throw new AcceptanceError('scene_save_conflict');

  log('acceptance_complete', {
    mapId,
    approvedRevisionId,
    generationRevisionId,
    currentDraftRevisionId: nextDraftRevisionId,
    assetId: asset.id,
    status: asset.status,
    paidRequestSubmitted,
    privateReadbackVerified: true,
    createdDedicatedDraft,
  });
  await supabase.auth.signOut();
}

void main().catch((error) => {
  log('acceptance_failed', {
    code: error instanceof AcceptanceError ? error.code : 'create_map_v3_acceptance_failed',
  });
  process.exitCode = 1;
});
